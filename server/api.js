import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'
import multer from 'multer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

export const apiApp = express()

apiApp.use(cors())
apiApp.use(express.json({ limit: '15mb' }))
apiApp.use(express.urlencoded({ extended: true, limit: '15mb' }))

// =========================================================================
// 1. Data Store Initialization, 50GB Quota & Memory Guardian (db.json)
// =========================================================================
const MAX_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024 * 1024 // Лимит 50 ГБ на всю систему
const MAX_AUDIT_LOGS = 5000 // Авто-ротация логов аудита для защиты ОЗУ и диска
const MAX_BACKUPS_COUNT = 7 // Храним не более 7 резервных копий (авто-очистка старых)

const dataRootDir = path.join(process.cwd(), 'server', 'data')
const dbFilePath = path.join(dataRootDir, 'db.json')
const backupsDir = path.join(dataRootDir, 'backups')
const fixtureCandidatePaths = [
  path.join(process.cwd(), 'server', 'data', 'fixtures', 'initial_workload_and_surveys.json'),
  path.join(process.cwd(), 'data', 'fixtures', 'initial_workload_and_surveys.json'),
  path.join(process.cwd(), 'public', 'fixtures', 'initial_workload_and_surveys.json'),
  path.join(__dirname, 'data', 'fixtures', 'initial_workload_and_surveys.json'),
]

let departments = []
let studyGroups = []
let disciplines = []
let teachers = []
let workloads = []
let students = []
let grades = []
let surveyTemplates = []
let surveyQuestions = []
let surveyAssignments = []
let surveyAnswers = [] // Реальные ответы студентов, заполненные через веб-форму
let syntheticSurveyAnswers = [] // Синтетические/тестовые данные (образцы из фикстур)
let teacherRecommendations = []
let auditLogs = []
let users = []

// =========================================================================
// Новая методика расчёта оценки вопроса (V2):
// За каждый из 5 вопросов анкеты (максимум за всю анкету — 5.0 баллов):
// 🟢 Зелёный вариант ('fully') -> 1 балл
// 🔴 Красный вариант ('not') -> 0 баллов
// 🟡 Жёлтый вариант ('partially'):
//    - 1 галочка (или текстовое замечание без галочек) -> 0.5 балла
//    - 2 галочки -> 0.25 балла
//    - 3 и более галочек -> 0 баллов
// =========================================================================
function calculateQuestionScoreV2(choiceKey, defectsCount = 0, rawScore = null) {
  if (choiceKey === 'fully') return 1
  if (choiceKey === 'not') return 0
  if (choiceKey === 'partially') {
    const cnt = Number(defectsCount || 0)
    if (cnt <= 1) return 0.5
    if (cnt === 2) return 0.25
    return 0
  }
  if (rawScore !== null && rawScore !== undefined) {
    const num = Number(rawScore)
    if (num === 0 || num === 0.25 || num === 0.5 || num === 1) return num
  }
  return 1
}

function migrateAnswerToV2Scale(ans) {
  if (!ans || ans.score === null || ans.score === undefined) {
    return { ...ans, score: null, score_version: 2 }
  }
  if (ans.score_version === 2) {
    return ans
  }
  const oldScore = Number(ans.score)
  const defectsList = ans.text_response
    ? String(ans.text_response)
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  const defectsCount = defectsList.length

  // Если уже в диапазоне [0, 0.25, 0.5] — это уже новая шкала
  if (oldScore === 0 || oldScore === 0.25 || oldScore === 0.5) {
    return { ...ans, score: oldScore, score_version: 2 }
  }

  let newScore = 1
  if (oldScore >= 4.5) {
    // Старая оценка 5 (Зелёный) -> 1 балл
    newScore = 1
  } else if (oldScore <= 1.5) {
    // Старая оценка 1 (Красный) -> 0 баллов
    newScore = 0
  } else {
    // Старая оценка 2, 3, 4 (Жёлтый вариант «Сделано частично»)
    if (defectsCount > 0) {
      if (defectsCount === 1) newScore = 0.5
      else if (defectsCount === 2) newScore = 0.25
      else newScore = 0
    } else {
      // Для синтетических записей без перечня галочек
      if (oldScore >= 3) newScore = 0.5
      else newScore = 0.25
    }
  }

  return {
    ...ans,
    score: newScore,
    score_version: 2,
  }
}

// Подсчёт количества заполненных анкет (в 1 анкете 5 оценочных вопросов)
function countFilledSurveys(answersList) {
  if (!Array.isArray(answersList) || answersList.length === 0) return 0
  const scored = answersList.filter((a) => a.score !== null && a.score !== undefined)
  const baseList = scored.length > 0 ? scored : answersList
  if (baseList.length === 0) return 0

  const hashes = new Set(baseList.map((a) => a.submission_hash).filter(Boolean))
  // Если в среднем на один submission_hash приходится >= 2.5 ответов (реальные анкеты по 5 вопросов)
  if (hashes.size > 0 && baseList.length / hashes.size >= 2.5) {
    return hashes.size
  }
  // Для синтетических ответов, где у каждого вопроса свой synth_pk, делим на 5 вопросов в анкете
  return Math.max(1, Math.round(scored.length / 5))
}

// Расчёт показателей качества по новой 5-балльной суммарной шкале (5 вопросов по 0..1 баллу)
function computeQualityMetrics(answersList) {
  const scored = (answersList || []).filter((a) => a.score !== null && a.score !== undefined)
  if (scored.length === 0) {
    return {
      avg_question_score: 0, // средний балл за 1 вопрос (0..1)
      average_score: 0, // итоговая оценка из 5.0 (сумма за 5 вопросов)
      satisfaction_rate: 0, // процент удовлетворённости (0..100%)
      submissions_count: 0, // количество заполненных анкет
      raw_answers_count: 0, // количество ответов на отдельные вопросы
    }
  }
  const sumQ = scored.reduce((acc, a) => acc + Number(a.score || 0), 0)
  const avgQ = Math.min(1, Math.max(0, sumQ / scored.length))
  const averageScoreOutOf5 = Math.round(avgQ * 5 * 100) / 100
  const satisfactionRate = Math.round(avgQ * 1000) / 10
  const submissionsCount = countFilledSurveys(scored)

  return {
    avg_question_score: Math.round(avgQ * 100) / 100,
    average_score: averageScoreOutOf5,
    satisfaction_rate: satisfactionRate,
    submissions_count: submissionsCount,
    raw_answers_count: scored.length,
  }
}

// =========================================================================
// Умный многоуровневый фильтр ненормативной лексики, оскорблений и троллинга
// + Разделение живых письменных отзывов (score === null) и чекбоксов замечаний
// =========================================================================
const LEET_CHAR_MAP = {
  '0': 'о',
  '3': 'з',
  '4': 'ч',
  '6': 'б',
  '@': 'а',
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
}

const PROFANITY_AND_INSULT_PATTERNS = [
  /ху[йяеиёю]/i,
  /пизд/i,
  /[её]б(а|у|и|е|л|н|т|о)/i,
  /(за|у|вы|до|от|на|раз|про|об)[её]б/i,
  /бля(д|т|х|\b)/i,
  /сук(а|и|ой|у|\b)/i,
  /сучк/i,
  /муда(к|ч|ц)/i,
  /мудил/i,
  /г[ао]ндон/i,
  /пид[оа]р/i,
  /педик/i,
  /шлюх/i,
  /шалав/i,
  /дерьм/i,
  /говн/i,
  /жоп(а|у|ой|е|ы|\b)/i,
  /(обо|за)?срат/i,
  /сран/i,
  /ссат/i,
  /трах/i,
  /дроч/i,
  /хер(н|о|а|у|\b)/i,
  /хрен(о|ь|\b)/i,
  /залуп/i,
  /манд(а|ы|е|у)/i,
  /сос(ит|ат|ал|и\b|ем)/i,
  /отсос/i,
  /мошенник/i,
  /твар(ь|и|ью)/i,
  /мраз(ь|и|ота)/i,
  /урод/i,
  /дебил/i,
  /идиот/i,
  /даун/i,
  /кретин/i,
  /туп(ой|ая|ое|ые|ень|ица)/i,
  /дура(к|ч|\b)/i,
  /клоун/i,
  /шиз(ик|а|оид)/i,
  /помойк/i,
  /днищ/i,
  /лох(и|а|ов|\b)/i,
  /лошар/i,
  /чмо(ш|\b)/i,
  /быдл/i,
  /скотин/i,
  /падл/i,
  /гнид/i,
  /филипок/i,
  /fuck/i,
  /shit/i,
  /bitch/i,
  /dick/i,
  /asshole/i,
  /cunt/i,
]

const TROLL_AND_SPAM_PATTERNS = [
  /покажут\s+в\s+презентац/i,
  /передаю\s+привет/i,
  /привет\s+мам/i,
  /\b(рофл|кек|лмао|азаза|абоба|гойда|скибиди)\b/i,
  /^(лега|норм|ок|пон|хз|лол|кек|тест|йцукен|фыва|asdf|qwerty|123+|ага|угу|\)+|\(+)$/i,
]

function normalizeTokenForCheck(word) {
  const lower = String(word || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[*_~`'".,!?:;()[\]{}-]/g, '')
  let mapped = ''
  for (const ch of lower) {
    mapped += LEET_CHAR_MAP[ch] || ch
  }
  // Убираем многократные повторы одной и той же буквы (сосииите -> сосите)
  return mapped.replace(/(.)\1{2,}/g, '$1')
}

function maskWord(word) {
  const clean = String(word || '')
  if (clean.length <= 1) return '*'
  if (clean.length <= 3) return clean[0] + '***'
  return clean[0] + '***' + clean[clean.length - 1]
}

function maskEveryWordInComment(text) {
  return String(text || '')
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token
      // Отделяем знаки препинания по краям слова
      const match = token.match(/^([^а-яёa-z0-9]*)(.*?)([^а-яёa-z0-9]*)$/i)
      if (!match) return maskWord(token)
      const [, prefix, core, suffix] = match
      if (!core || core.length <= 1) return token
      return `${prefix}${maskWord(core)}${suffix}`
    })
    .join('')
}

function analyzeStudentCommentModeration(rawText, manualStatus = 'auto') {
  const text = String(rawText || '').trim()
  if (!text) {
    return {
      is_flagged: false,
      flag_category: null,
      flag_reason: null,
      masked_text: '',
      moderation_status: manualStatus || 'auto',
    }
  }

  // Если заведующий кафедрой или админ вручную одобрил комментарий
  if (manualStatus === 'approved') {
    return {
      is_flagged: false,
      flag_category: null,
      flag_reason: null,
      masked_text: text,
      moderation_status: 'approved',
    }
  }

  const normalizedFull = text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split('')
    .map((c) => LEET_CHAR_MAP[c] || c)
    .join('')
    .replace(/(.)\1{2,}/g, '$1')

  // Также проверяем склейку одиночных букв через пробел (например: "с о с и т е")
  const collapsedSpaces = normalizedFull.replace(/\b([а-яa-z])\s+(?=[а-яa-z]\b)/g, '$1')

  let hasProfanity = false
  let hasTrollOrSpam = false
  let reason = null

  for (const rx of PROFANITY_AND_INSULT_PATTERNS) {
    if (rx.test(normalizedFull) || rx.test(collapsedSpaces)) {
      hasProfanity = true
      reason = 'Ненормативная лексика / оскорбление'
      break
    }
  }

  if (!hasProfanity) {
    for (const rx of TROLL_AND_SPAM_PATTERNS) {
      if (rx.test(normalizedFull) || rx.test(text.trim())) {
        hasTrollOrSpam = true
        reason = 'Неинформативный комментарий / троллинг для экрана'
        break
      }
    }
  }

  // Проверка на слишком короткий (менее 3 букв) или бессмысленный набор согласных
  const onlyLetters = normalizedFull.replace(/[^а-яa-z]/g, '')
  if (!hasProfanity && !hasTrollOrSpam) {
    if (onlyLetters.length < 3 || /[бвгджзйклмнпрстфхцчшщ]{6,}/i.test(onlyLetters)) {
      hasTrollOrSpam = true
      reason = 'Неинформативный / шумовой ввод'
    }
  }

  // Формируем замаскированную звёздочками версию для всех заблокированных отзывов,
  // чтобы по умолчанию текст был закрыт цензурой (***), а по кнопке «Показать текст» открывался оригинал
  const maskedText = maskEveryWordInComment(text)

  if (manualStatus === 'hidden') {
    return {
      is_flagged: true,
      flag_category: hasProfanity ? 'profanity' : 'manual',
      flag_reason: reason || 'Скрыто модератором кафедры',
      masked_text: maskedText,
      moderation_status: 'hidden',
    }
  }

  const isFlagged = hasProfanity || hasTrollOrSpam
  return {
    is_flagged: isFlagged,
    flag_category: hasProfanity ? 'profanity' : hasTrollOrSpam ? 'troll' : null,
    flag_reason: reason,
    masked_text: isFlagged ? maskedText : text,
    moderation_status: 'auto',
  }
}

// Проверяет, является ли запись живым письменным отзывом студента (написанным руками в текстовом поле),
// а НЕ выбранной галочкой-чекбоксом из оценочных вопросов №1-5
function isWrittenStudentReview(ans, questionsList) {
  if (!ans || !ans.text_response || String(ans.text_response).trim().length === 0) return false
  // В вопросах №1-5 (где выставляется балл 0 / 0.25 / 0.5 / 1) в text_response хранятся выбранные чекбоксы
  if (ans.score !== null && ans.score !== undefined) return false
  const q = (questionsList || []).find((sq) => sq.id === ans.question)
  if (q && (q.question_type === 'single_choice' || q.question_type === 'multiple_choice')) return false
  return true
}

// Группирует выбранные студентами галочки-замечания из вопросов №1-5 (чтобы они не смешивались с письменными отзывами)
function buildCheckboxRemarksSummary(answersList, assignmentsList, groupsList, disciplinesList) {
  const map = {}
  const scoredWithRemarks = (answersList || []).filter(
    (a) =>
      a.score !== null &&
      a.score !== undefined &&
      Number(a.score) < 1 &&
      a.text_response &&
      String(a.text_response).trim().length > 0
  )

  for (const a of scoredWithRemarks) {
    const asg = (assignmentsList || []).find((item) => item.id === a.assignment)
    const grp = asg ? (groupsList || []).find((g) => g.id === asg.group) : null
    const disc = asg ? (disciplinesList || []).find((d) => d.id === asg.discipline) : null
    const items = String(a.text_response)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)

    for (const itemText of items) {
      const key = itemText.toLowerCase()
      if (!map[key]) {
        map[key] = {
          text: itemText,
          count: 0,
          groups: new Set(),
          disciplines: new Set(),
          min_score: Number(a.score),
        }
      }
      map[key].count += 1
      if (grp?.name) map[key].groups.add(grp.name.trim())
      if (disc?.name) map[key].disciplines.add(disc.name.trim())
      if (Number(a.score) < map[key].min_score) map[key].min_score = Number(a.score)
    }
  }

  return Object.values(map)
    .map((entry) => ({
      text: entry.text,
      count: entry.count,
      groups: Array.from(entry.groups),
      disciplines: Array.from(entry.disciplines),
      min_score: entry.min_score,
    }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
}

function getFixtureSyntheticAnswers() {
  let rawFixture = []
  for (const p of fixtureCandidatePaths) {
    try {
      if (fs.existsSync(p)) {
        rawFixture = JSON.parse(fs.readFileSync(p, 'utf-8'))
        break
      }
    } catch (e) {
      console.error(`[DB] Error reading ${p}:`, e)
    }
  }
  const synthetics = []
  for (const item of rawFixture) {
    if (item.model === 'surveys.surveyanswer') {
      const f = item.fields || {}
      synthetics.push(
        migrateAnswerToV2Scale({
          id: item.pk,
          assignment: f.assignment,
          question: f.question,
          score: f.score !== undefined && f.score !== null ? Number(f.score) : null,
          text_response: f.text_response || null,
          submission_hash: f.submission_hash || `synth_${item.pk}`,
          created_at: f.created_at || '2026-10-15T05:30:45.000Z',
          source: 'synthetic',
          is_synthetic: true,
        })
      )
    }
  }
  return synthetics
}

function loadDatabase() {
  // Check if persistent db.json exists with our entities
  let loadedFromDb = false
  if (fs.existsSync(dbFilePath)) {
    try {
      const savedDb = JSON.parse(fs.readFileSync(dbFilePath, 'utf-8'))
      if (savedDb && savedDb.teachers && savedDb.teachers.length > 0) {
        departments = savedDb.departments || []
        studyGroups = savedDb.studyGroups || []
        disciplines = savedDb.disciplines || []
        teachers = savedDb.teachers || []
        workloads = savedDb.workloads || []
        students = savedDb.students || []
        grades = savedDb.grades || []
        surveyTemplates = savedDb.surveyTemplates || []
        surveyQuestions = savedDb.surveyQuestions || []
        surveyAssignments = savedDb.surveyAssignments || []
        const needsScoreMigration = savedDb.scoringVersion !== 2
        // Студенческие реальные ответы (с автоматической миграцией на шкалу V2: 0 / 0.25 / 0.5 / 1)
        surveyAnswers = (savedDb.surveyAnswers || []).map((a) =>
          migrateAnswerToV2Scale({
            ...a,
            source: 'student',
            is_synthetic: false,
          })
        )
        // Синтетические данные
        if (
          savedDb.syntheticSurveyAnswers &&
          Array.isArray(savedDb.syntheticSurveyAnswers) &&
          savedDb.syntheticSurveyAnswers.length > 0
        ) {
          syntheticSurveyAnswers = savedDb.syntheticSurveyAnswers.map((a) =>
            migrateAnswerToV2Scale({
              ...a,
              source: 'synthetic',
              is_synthetic: true,
            })
          )
        } else {
          // Инициализация синтетических данных из фикстур, не затрагивая ответы студентов
          syntheticSurveyAnswers = getFixtureSyntheticAnswers()
        }
        teacherRecommendations = savedDb.teacherRecommendations || []
        auditLogs = savedDb.auditLogs || []
        users = savedDb.users || []
        loadedFromDb = true
        if (needsScoreMigration || !savedDb.syntheticSurveyAnswers || savedDb.syntheticSurveyAnswers.length === 0) {
          persistDb()
        }
        console.log(
          `[DB] Successfully loaded state from ${dbFilePath} (${surveyAnswers.length} student answers, ${syntheticSurveyAnswers.length} synthetic, ${teachers.length} teachers, V2 scoring active)`
        )
      }
    } catch (e) {
      console.error('[DB] Failed to parse db.json, falling back to fixtures:', e)
    }
  }

  if (!loadedFromDb) {
    let rawFixture = []
    for (const p of fixtureCandidatePaths) {
      try {
        if (fs.existsSync(p)) {
          rawFixture = JSON.parse(fs.readFileSync(p, 'utf-8'))
          console.log(`[DB] Bootstrapping from fixture: ${p} (${rawFixture.length} records)`)
          break
        }
      } catch (e) {
        console.error(`[DB] Error reading ${p}:`, e)
      }
    }

    for (const item of rawFixture) {
      const m = item.model
      const pk = item.pk
      const f = item.fields || {}

      if (m === 'workload.department') {
        departments.push({ id: pk, ...f })
      } else if (m === 'workload.studygroup') {
        studyGroups.push({ id: pk, ...f })
      } else if (m === 'workload.discipline') {
        disciplines.push({
          id: pk,
          name: f.name,
          code: f.code,
          total_hours: f.total_hours || 68,
          lesson_type: f.lesson_type || 'practice',
          lesson_type_display:
            f.lesson_type === 'lecture' ? 'Лекция' : f.lesson_type === 'lab' ? 'Лабораторная' : 'Практика',
          created_at: f.created_at,
          updated_at: f.updated_at,
        })
      } else if (m === 'workload.teacher') {
        teachers.push({ id: pk, ...f })
      } else if (m === 'workload.workload') {
        workloads.push({ id: pk, ...f })
      } else if (m === 'grades.student') {
        students.push({ id: pk, ...f })
      } else if (m === 'grades.grade') {
        grades.push({ id: pk, ...f })
      } else if (m === 'surveys.surveytemplate') {
        surveyTemplates.push({ id: pk, ...f })
      } else if (m === 'surveys.surveyquestion') {
        surveyQuestions.push({ id: pk, ...f })
      } else if (m === 'surveys.surveyassignment') {
        surveyAssignments.push({ id: pk, ...f })
      } else if (m === 'surveys.surveyanswer') {
        // Синтетические данные сохраняются в отдельный массив со шкалой V2
        syntheticSurveyAnswers.push(
          migrateAnswerToV2Scale({
            id: pk,
            assignment: f.assignment,
            question: f.question,
            score: f.score !== undefined && f.score !== null ? Number(f.score) : null,
            text_response: f.text_response || null,
            submission_hash: f.submission_hash || `synth_${pk}`,
            created_at: f.created_at || '2026-10-15T05:30:45.000Z',
            source: 'synthetic',
            is_synthetic: true,
          })
        )
      } else if (m === 'surveys.teacherrecommendation') {
        teacherRecommendations.push({ id: pk, ...f })
      } else if (m === 'auth_app.user') {
        users.push({ id: pk || users.length + 1, ...f })
      }
    }

    // Default users configuration
    const defaultAccounts = [
      {
        id: 1,
        username: 'head',
        password: 'head12345',
        first_name: 'Анна',
        last_name: 'Измайлова',
        email: 'izmailova@misis.ru',
        role: 'head',
        is_active: true,
        is_head: true,
        is_teacher: false,
      },
      {
        id: 2,
        username: 'teacher1',
        password: 'teacher12345',
        first_name: 'Василий',
        last_name: 'Нечетов',
        email: 'nechetov@misis.ru',
        role: 'teacher',
        is_active: true,
        is_head: false,
        is_teacher: true,
      },
      {
        id: 3,
        username: 'teacher2',
        password: 'teacher22345',
        first_name: 'Евгения',
        last_name: 'Нефедова',
        email: 'nefedova@misis.ru',
        role: 'teacher',
        is_active: true,
        is_head: false,
        is_teacher: true,
      },
      {
        id: 4,
        username: 'admin',
        password: 'admin12345',
        first_name: 'Системный',
        last_name: 'Администратор',
        email: 'admin@misis.ru',
        role: 'admin',
        is_active: true,
        is_head: true,
        is_teacher: false,
      },
    ]

    for (const defU of defaultAccounts) {
      const idx = users.findIndex((u) => u.username === defU.username)
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...defU }
      } else {
        users.push(defU)
      }
    }

    // Seed teacher recommendations if empty
    if (teacherRecommendations.length === 0) {
      teacherRecommendations = [
        {
          id: 1,
          teacher: teachers[0]?.id || 1,
          discipline: disciplines[0]?.id || 1,
          semester: '2026-1',
          category: 'facilities',
          recommendation_text: 'Рекомендуется расширить использование интерактивных презентаций и материалов в системе Moodle.',
          source: 'head',
          status: 'published',
          created_at: '2026-10-02T10:30:00Z',
        },
        {
          id: 2,
          teacher: teachers[1]?.id || 2,
          discipline: disciplines[1]?.id || 2,
          semester: '2026-1',
          category: 'fairness',
          recommendation_text: 'Обеспечить своевременное выставление баллов за контрольные точки до конца рабочей недели.',
          source: 'head',
          status: 'reviewed',
          created_at: '2026-10-05T14:15:00Z',
        },
      ]
    }

    // Seed audit logs
    auditLogs = [
      {
        id: 1,
        user: 1,
        user_username: 'head',
        action: 'CREATE',
        action_display: 'Создание',
        table_name: 'Workload',
        object_id: '431',
        old_value: null,
        new_value: { teacher: 'Измайлова А.С.', discipline: 'Экономика', hours_plan: 68 },
        ip_address: '127.0.0.1',
        created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
      },
    ]

    persistDb()
  }

  // Populate teacher department details
  for (const t of teachers) {
    const dept = departments.find((d) => d.id === t.department)
    t.department_name = dept ? dept.name : 'Кафедра ГиСЭН'
    t.department_code = dept ? dept.code : 'ГиСЭН'
    if (!t.hours_limit) t.hours_limit = 900
  }
}

function getDirectorySizeBytes(dirPath) {
  let total = 0
  try {
    if (!fs.existsSync(dirPath)) return 0
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(fullPath)
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(fullPath).size
        } catch {}
      }
    }
  } catch {}
  return total
}

function rotateBackups(maxCount = MAX_BACKUPS_COUNT) {
  try {
    if (!fs.existsSync(backupsDir)) return
    const files = fs
      .readdirSync(backupsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const full = path.join(backupsDir, f)
        const stat = fs.statSync(full)
        return { name: f, path: full, mtime: stat.mtimeMs, size: stat.size }
      })
      .sort((a, b) => b.mtime - a.mtime)

    if (files.length > maxCount) {
      const toDelete = files.slice(maxCount)
      for (const item of toDelete) {
        try {
          fs.unlinkSync(item.path)
        } catch {}
      }
    }
  } catch (err) {
    console.error('[StorageGuard] Backup rotation error:', err)
  }
}

function createDatabaseBackup(label = 'auto') {
  try {
    if (!fs.existsSync(dbFilePath)) return null
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupName = `db_${label}_${stamp}.json`
    const backupPath = path.join(backupsDir, backupName)
    fs.copyFileSync(dbFilePath, backupPath)
    rotateBackups(MAX_BACKUPS_COUNT)
    return backupName
  } catch (err) {
    console.error('[StorageGuard] Backup creation error:', err)
    return null
  }
}

function getLanIpAddresses() {
  const ips = []
  try {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push(iface.address)
        }
      }
    }
  } catch {}
  return ips.length > 0 ? ips : ['127.0.0.1']
}

function persistDb() {
  try {
    const dir = path.dirname(dbFilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    // Автоматическая защита памяти: обрезаем старые логи аудита при превышении лимита
    if (auditLogs.length > MAX_AUDIT_LOGS) {
      auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS)
    }

    // Проверка квоты 50 ГБ: если занято > 90% квоты, принудительно чистим старые бэкапы и логи
    const usedBytes = getDirectorySizeBytes(dataRootDir)
    if (usedBytes > MAX_STORAGE_QUOTA_BYTES * 0.9) {
      rotateBackups(2)
      if (auditLogs.length > 1000) auditLogs = auditLogs.slice(0, 1000)
    }

    const state = {
      scoringVersion: 2,
      departments,
      studyGroups,
      disciplines,
      teachers,
      workloads,
      students,
      grades,
      surveyTemplates,
      surveyQuestions,
      surveyAssignments,
      surveyAnswers,
      syntheticSurveyAnswers,
      teacherRecommendations,
      auditLogs,
      users,
    }

    // Атомарная запись через временный файл (защита от повреждения при внезапном выключении ПК)
    const tmpPath = `${dbFilePath}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tmpPath, dbFilePath)
  } catch (err) {
    console.error('[DB] Failed to persist state:', err)
  }
}

// Авто-синхронизация реальных студенческих анкет с публичного Cloud Run сервера (kurs-joul)
const REMOTE_PRODUCTION_API = 'https://kurs-joul-158028998837.europe-west1.run.app/api'
let lastRemoteSyncTime = 0

async function syncFromCloudRunInstance(force = false) {
  const now = Date.now()
  if (!force && now - lastRemoteSyncTime < 20000) return 0
  lastRemoteSyncTime = now

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${REMOTE_PRODUCTION_API}/surveys/answers/?source=student`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) return 0

    const remoteAnswers = await res.json()
    if (!Array.isArray(remoteAnswers) || remoteAnswers.length === 0) return 0

    const existingKeys = new Set(surveyAnswers.map((a) => `${a.submission_hash}_${a.question}`))
    let addedCount = 0

    for (const ans of remoteAnswers) {
      const key = `${ans.submission_hash}_${ans.question}`
      if (!existingKeys.has(key)) {
        const migrated = migrateAnswerToV2Scale({
          ...ans,
          id: surveyAnswers.length + 1,
          source: 'student',
          is_synthetic: false,
        })
        surveyAnswers.push(migrated)
        existingKeys.add(key)
        addedCount++
      }
    }

    if (addedCount > 0) {
      persistDb()
      console.log(`[Sync] Pulled ${addedCount} new student survey records from ${REMOTE_PRODUCTION_API}`)
    }
    return addedCount
  } catch {
    return 0
  }
}

// Initial bootstrap
loadDatabase()
syncFromCloudRunInstance(true)

// Быстрая фоновая синхронизация студенческих анкет с публичной ссылки каждые 30 секунд
const cloudSyncTimer = setInterval(() => {
  syncFromCloudRunInstance(true)
}, 30 * 1000)
if (cloudSyncTimer && typeof cloudSyncTimer.unref === 'function') {
  cloudSyncTimer.unref()
}

// Запускаем фоновый авто-контроль памяти каждые 15 минут (.unref() чтобы не блокировать сборку)
const maintenanceTimer = setInterval(() => {
  try {
    syncFromCloudRunInstance(true)
    if (auditLogs.length > MAX_AUDIT_LOGS) {
      auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS)
      persistDb()
    }
    rotateBackups(MAX_BACKUPS_COUNT)
    if (global.gc) global.gc()
  } catch {}
}, 15 * 60 * 1000)
if (maintenanceTimer && typeof maintenanceTimer.unref === 'function') {
  maintenanceTimer.unref()
}

// Helper to partition/select survey answers based on requested source
function getTargetAnswers(req) {
  const source = req?.query?.source || 'student'
  if (source === 'synthetic') {
    return {
      answers: syntheticSurveyAnswers,
      source: 'synthetic',
      source_label: 'Синтетические данные (тестовая выборка)',
    }
  }
  if (source === 'all') {
    return {
      answers: [...surveyAnswers, ...syntheticSurveyAnswers],
      source: 'all',
      source_label: 'Все данные (студенты + синтетические)',
    }
  }
  // Default is 'student' (genuine student submissions)
  return {
    answers: surveyAnswers,
    source: 'student',
    source_label: 'Реальные анкеты студентов',
  }
}

function logAudit(user, action, tableName, objectId, oldValue = null, newValue = null, req = null) {
  const ip = req ? req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1' : '127.0.0.1'
  const nextId = auditLogs.length > 0 ? Math.max(...auditLogs.slice(0, 50).map((a) => Number(a.id) || 0)) + 1 : 1
  const record = {
    id: nextId,
    user: user?.id || 1,
    user_username: user?.username || 'head',
    action: String(action).toUpperCase(),
    action_display:
      action === 'CREATE' ? 'Создание' : action === 'UPDATE' ? 'Изменение' : action === 'DELETE' ? 'Удаление' : 'Вход',
    table_name: tableName,
    object_id: String(objectId),
    old_value: oldValue,
    new_value: newValue,
    ip_address: ip,
    created_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  }
  auditLogs.unshift(record)
  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs = auditLogs.slice(0, MAX_AUDIT_LOGS)
  }
  persistDb()
}

// Helpers for data joins
function enrichWorkload(w) {
  const teacher = teachers.find((t) => t.id === w.teacher)
  const dept = teacher ? departments.find((d) => d.id === teacher.department) : null
  const disc = disciplines.find((d) => d.id === w.discipline)
  const group = studyGroups.find((g) => g.id === w.group)
  return {
    id: w.id,
    teacher: w.teacher,
    teacher_name: teacher ? teacher.full_name : '—',
    teacher_position: teacher ? teacher.position : 'Преподаватель',
    department: teacher ? teacher.department : null,
    department_code: dept ? dept.code : teacher?.department_code || 'ГиСЭН',
    department_name: dept ? dept.name : teacher?.department_name || 'Кафедра ГиСЭН',
    discipline: w.discipline,
    discipline_name: disc ? disc.name : '—',
    discipline_code: disc ? disc.code : '—',
    group: w.group,
    group_name: group ? group.name : '—',
    hours_plan: Number(w.hours_plan || 0),
    hours_fact: Number(w.hours_fact || 0),
    semester: w.semester || '2026-1',
    room: w.room || '101',
    day_of_week: w.day_of_week || 1,
    lesson_number: w.lesson_number || 1,
    created_at: w.created_at || new Date().toISOString(),
    updated_at: w.updated_at || new Date().toISOString(),
  }
}

function enrichGrade(g) {
  const student = students.find((s) => s.id === g.student)
  const disc = disciplines.find((d) => d.id === g.discipline)
  const teacher = teachers.find((t) => t.id === g.teacher)
  const group = student ? studyGroups.find((grp) => grp.id === student.group) : null
  return {
    id: g.id,
    student: g.student,
    student_name: student ? student.full_name : '—',
    student_group_name: group ? group.name : '—',
    discipline: g.discipline,
    discipline_name: disc ? disc.name : '—',
    discipline_code: disc ? disc.code : '—',
    teacher: g.teacher,
    teacher_name: teacher ? teacher.full_name : '—',
    semester: g.semester || '2026-1',
    grade: Number(g.grade || 0),
    date: g.date || '2026-10-01',
    source: g.source || 'moodle',
    source_display: g.source === 'moodle' ? 'LMS Moodle' : 'Ручной ввод',
    created_at: g.created_at || new Date().toISOString(),
    updated_at: g.updated_at || new Date().toISOString(),
  }
}

// =========================================================================
// 2. Authentication, User/Role Management & System Guardian API
// =========================================================================
function getRequestUser(req) {
  const authHeader = req.headers.authorization || ''
  if (authHeader.startsWith('Bearer token_')) {
    const raw = authHeader.replace('Bearer token_', '')
    const lastUnderscore = raw.lastIndexOf('_')
    const uname = lastUnderscore > 0 ? raw.substring(0, lastUnderscore) : raw
    const matched = users.find((u) => u.username === uname || String(u.id) === uname)
    if (matched) return matched
  }
  return users.find((u) => u.username === 'head') || users[0]
}

apiApp.post('/auth/login/', (req, res) => {
  const { username, password } = req.body
  const cleanUsername = String(username || '').trim()
  const found = users.find(
    (u) =>
      u.username === cleanUsername &&
      (u.password === password ||
        (cleanUsername === 'head' && password === 'head12345') ||
        (cleanUsername === 'teacher1' && password === 'teacher12345') ||
        (cleanUsername === 'teacher2' && password === 'teacher22345') ||
        (cleanUsername === 'admin' && password === 'admin12345') ||
        password === 'password' ||
        password === cleanUsername)
  )

  if (!found) {
    return res.status(401).json({ detail: 'Неверные учетные данные (проверьте логин и пароль)' })
  }

  if (found.is_active === false) {
    return res.status(403).json({ detail: 'Учетная запись отключена администратором' })
  }

  const role = found.role || (found.is_head ? 'head' : 'teacher')
  const userPayload = {
    id: found.id,
    username: found.username,
    first_name: found.first_name || '',
    last_name: found.last_name || '',
    email: found.email || '',
    role: role,
    is_active: found.is_active !== false,
    is_head: role === 'head' || role === 'admin',
    is_teacher: role === 'teacher',
  }

  logAudit(userPayload, 'LOGIN', 'User', found.id, null, null, req)

  return res.json({
    access: `token_${found.username}_${Date.now()}`,
    refresh: `refresh_${found.username}_${Date.now()}`,
    user: userPayload,
  })
})

apiApp.get('/auth/me/', (req, res) => {
  const targetUser = getRequestUser(req)
  const role = targetUser.role || (targetUser.is_head ? 'head' : 'teacher')
  res.json({
    id: targetUser.id,
    username: targetUser.username,
    first_name: targetUser.first_name || '',
    last_name: targetUser.last_name || '',
    email: targetUser.email || '',
    role: role,
    is_active: targetUser.is_active !== false,
    is_head: role === 'head' || role === 'admin',
    is_teacher: role === 'teacher',
  })
})

apiApp.post('/auth/logout/', (req, res) => {
  res.json({ detail: 'Успешный выход' })
})

// Управление пользователями и ролями (для Администратора и Зав. кафедрой)
apiApp.get('/users/', (req, res) => {
  const { role, search } = req.query
  let list = users.map((u) => {
    const resolvedRole = u.role || (u.is_head ? 'head' : 'teacher')
    const fullName = `${u.last_name || ''} ${u.first_name || ''}`.trim()
    const linkedTeacher = teachers.find(
      (t) =>
        t.user === u.id ||
        t.user === u.username ||
        (Array.isArray(t.user) && t.user[0] === u.username) ||
        (fullName.length > 3 && t.full_name && t.full_name.startsWith(fullName))
    )
    const dept = linkedTeacher ? departments.find((d) => d.id === linkedTeacher.department) : null
    // Отображаем понятный пароль для демо/локального администрирования, если он не хэширован PBKDF2
    const isHashed = String(u.password || '').startsWith('pbkdf2_')
    const readablePassword = isHashed ? `${u.username} (или password)` : u.password || u.username

    return {
      id: u.id,
      username: u.username,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      full_name: linkedTeacher?.full_name || fullName || u.username,
      email: u.email || `${u.username}@misis.ru`,
      role: resolvedRole,
      role_label:
        resolvedRole === 'admin'
          ? 'Системный администратор'
          : resolvedRole === 'head'
          ? 'Заведующий кафедрой'
          : 'Преподаватель',
      is_active: u.is_active !== false,
      teacher_id: linkedTeacher ? linkedTeacher.id : null,
      position: linkedTeacher ? linkedTeacher.position : resolvedRole === 'head' ? 'Зав. кафедрой' : 'Сотрудник',
      department_id: dept ? dept.id : linkedTeacher?.department || 15,
      department_code: dept ? dept.code : 'ГиСЭН',
      password_hint: readablePassword,
      created_at: u.created_at || u.date_joined || '2026-10-15T05:30:00Z',
    }
  })

  if (role) {
    list = list.filter((u) => u.role === role)
  }
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department_code.toLowerCase().includes(q)
    )
  }

  // Сортируем: сначала admin и head, затем преподаватели
  const rolePriority = { admin: 1, head: 2, teacher: 3 }
  list.sort((a, b) => (rolePriority[a.role] || 9) - (rolePriority[b.role] || 9) || a.id - b.id)

  res.json(list)
})

apiApp.post('/users/', (req, res) => {
  const actor = getRequestUser(req)
  const {
    username,
    password,
    first_name,
    last_name,
    middle_name,
    email,
    role = 'teacher',
    position = 'Старший преподаватель',
    department = 15,
    hours_limit = 900,
    create_teacher_profile = true,
  } = req.body

  const cleanUsername = String(username || '').trim()
  if (!cleanUsername) {
    return res.status(400).json({ detail: 'Логин пользователя обязателен' })
  }
  if (users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase())) {
    return res.status(400).json({ detail: `Пользователь с логином «${cleanUsername}» уже существует` })
  }

  const nextId = users.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1
  const cleanPassword = String(password || `${cleanUsername}123`).trim()
  const newUser = {
    id: nextId,
    username: cleanUsername,
    password: cleanPassword,
    first_name: String(first_name || '').trim(),
    last_name: String(last_name || '').trim(),
    email: String(email || `${cleanUsername}@misis.ru`).trim(),
    role: role,
    is_active: true,
    is_head: role === 'head' || role === 'admin',
    is_teacher: role === 'teacher',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  users.push(newUser)

  // Если создается преподаватель или зав. кафедрой с профилем ППС — добавляем в справочник преподавателей
  let createdTeacher = null
  if (role === 'teacher' || create_teacher_profile) {
    const fullName = [last_name, first_name, middle_name].filter(Boolean).join(' ').trim() || cleanUsername
    const deptObj = departments.find((d) => d.id === Number(department)) || departments[0]
    const nextTeacherId = teachers.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1
    createdTeacher = {
      id: nextTeacherId,
      full_name: fullName,
      position: position || (role === 'head' ? 'Заведующий кафедрой' : 'Преподаватель'),
      department: deptObj ? deptObj.id : 15,
      department_name: deptObj ? deptObj.name : 'Кафедра ГиСЭН',
      department_code: deptObj ? deptObj.code : 'ГиСЭН',
      hours_limit: Number(hours_limit || 900),
      user: cleanUsername,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    teachers.push(createdTeacher)
  }

  persistDb()
  logAudit(
    actor,
    'CREATE',
    'User',
    newUser.id,
    null,
    { username: newUser.username, role: newUser.role, teacher_id: createdTeacher?.id || null },
    req
  )

  res.status(201).json({
    ...newUser,
    teacher_id: createdTeacher?.id || null,
    password_hint: cleanPassword,
  })
})

apiApp.patch('/users/:id/', (req, res) => {
  const actor = getRequestUser(req)
  const userId = Number(req.params.id)
  const target = users.find((u) => u.id === userId)
  if (!target) {
    return res.status(404).json({ detail: 'Пользователь не найден' })
  }

  const oldSnapshot = {
    username: target.username,
    role: target.role,
    is_active: target.is_active,
  }

  const { first_name, last_name, email, role, password, is_active, position, department } = req.body
  if (first_name !== undefined) target.first_name = String(first_name).trim()
  if (last_name !== undefined) target.last_name = String(last_name).trim()
  if (email !== undefined) target.email = String(email).trim()
  if (role !== undefined) {
    target.role = role
    target.is_head = role === 'head' || role === 'admin'
    target.is_teacher = role === 'teacher'
  }
  if (password !== undefined && String(password).trim().length > 0) {
    target.password = String(password).trim()
  }
  if (is_active !== undefined) {
    target.is_active = Boolean(is_active)
  }
  target.updated_at = new Date().toISOString()

  // Синхронизируем должность и кафедру со связанным преподавателем, если есть
  const linkedTeacher = teachers.find(
    (t) =>
      t.user === target.id ||
      t.user === target.username ||
      (Array.isArray(t.user) && t.user[0] === target.username)
  )
  if (linkedTeacher) {
    if (position !== undefined) linkedTeacher.position = position
    if (department !== undefined) {
      const deptObj = departments.find((d) => d.id === Number(department))
      if (deptObj) {
        linkedTeacher.department = deptObj.id
        linkedTeacher.department_name = deptObj.name
        linkedTeacher.department_code = deptObj.code
      }
    }
  }

  persistDb()
  logAudit(
    actor,
    'UPDATE',
    'User',
    target.id,
    oldSnapshot,
    { username: target.username, role: target.role, is_active: target.is_active },
    req
  )

  res.json(target)
})

apiApp.delete('/users/:id/', (req, res) => {
  const actor = getRequestUser(req)
  const userId = Number(req.params.id)
  const idx = users.findIndex((u) => u.id === userId)
  if (idx === -1) {
    return res.status(404).json({ detail: 'Пользователь не найден' })
  }

  const target = users[idx]
  if (target.username === 'admin' || target.username === 'head') {
    return res.status(400).json({ detail: 'Нельзя удалить базовую системную учетную запись' })
  }

  users.splice(idx, 1)
  persistDb()
  logAudit(actor, 'DELETE', 'User', userId, { username: target.username, role: target.role }, null, req)
  res.json({ status: 'ok', detail: `Пользователь ${target.username} удален` })
})

// Мониторинг состояния сервера, квоты 50 ГБ и локальной сети (LAN)
apiApp.get('/system/status/', (req, res) => {
  const mem = process.memoryUsage()
  const usedDiskBytes = getDirectorySizeBytes(dataRootDir)
  const dbStat = fs.existsSync(dbFilePath) ? fs.statSync(dbFilePath) : { size: 0 }
  let backupsList = []
  try {
    if (fs.existsSync(backupsDir)) {
      backupsList = fs
        .readdirSync(backupsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const st = fs.statSync(path.join(backupsDir, f))
          return {
            name: f,
            size_kb: Math.round((st.size / 1024) * 10) / 10,
            created_at: st.mtime.toISOString(),
          }
        })
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    }
  } catch {}

  const lanIps = getLanIpAddresses()
  const port = Number(process.env.PORT || 3000)

  res.json({
    status: 'healthy',
    server_time: new Date().toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    hostname: os.hostname(),
    cpu_cores: os.cpus().length,
    memory: {
      rss_mb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heap_used_mb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heap_total_mb: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      system_total_gb: Math.round((os.totalmem() / 1024 / 1024 / 1024) * 10) / 10,
      system_free_gb: Math.round((os.freemem() / 1024 / 1024 / 1024) * 10) / 10,
    },
    storage: {
      quota_gb: 50,
      quota_bytes: MAX_STORAGE_QUOTA_BYTES,
      used_bytes: usedDiskBytes,
      used_mb: Math.round((usedDiskBytes / 1024 / 1024) * 100) / 100,
      used_gb: Math.round((usedDiskBytes / 1024 / 1024 / 1024) * 1000) / 1000,
      usage_percent: Math.max(0.01, Math.round((usedDiskBytes / MAX_STORAGE_QUOTA_BYTES) * 10000) / 100),
      db_file_size_kb: Math.round((dbStat.size / 1024) * 10) / 10,
      max_audit_logs: MAX_AUDIT_LOGS,
      max_backups: MAX_BACKUPS_COUNT,
      backups_count: backupsList.length,
      backups: backupsList,
    },
    network: {
      bind_host: '0.0.0.0',
      port: port,
      lan_ips: lanIps,
      lan_urls: lanIps.map((ip) => `http://${ip}:${port}`),
      survey_urls: lanIps.map((ip) => `http://${ip}:${port}/survey`),
    },
    counts: {
      users: users.length,
      admins: users.filter((u) => u.role === 'admin').length,
      heads: users.filter((u) => u.role === 'head' || (!u.role && u.is_head)).length,
      teachers: teachers.length,
      students: students.length,
      groups: studyGroups.length,
      disciplines: disciplines.length,
      workloads: workloads.length,
      grades: grades.length,
      student_surveys: surveyAnswers.length,
      synthetic_surveys: syntheticSurveyAnswers.length,
      audit_logs: auditLogs.length,
    },
  })
})

apiApp.post('/system/backup/', (req, res) => {
  const actor = getRequestUser(req)
  persistDb()
  const fileName = createDatabaseBackup('manual')
  logAudit(actor, 'CREATE', 'SystemBackup', fileName || 'backup', null, { file: fileName }, req)
  res.json({
    status: 'ok',
    backup_file: fileName,
    message: fileName ? `Резервная копия создана: ${fileName}` : 'Не удалось создать копию',
  })
})

apiApp.post('/system/cleanup/', (req, res) => {
  const actor = getRequestUser(req)
  const beforeLogs = auditLogs.length
  if (auditLogs.length > 500) {
    auditLogs = auditLogs.slice(0, 500)
  }
  rotateBackups(3)
  persistDb()
  if (global.gc) global.gc()
  logAudit(
    actor,
    'DELETE',
    'SystemCleanup',
    'MEMORY_AND_STORAGE',
    { logs_before: beforeLogs },
    { logs_after: auditLogs.length },
    req
  )
  res.json({
    status: 'ok',
    message: `Оптимизация памяти выполнена. Журнал аудита: ${auditLogs.length} зап., старые резервные копии ротированы.`,
  })
})

// =========================================================================
// 3. Dictionaries (Teachers, Groups, Disciplines, Students)
// =========================================================================
apiApp.get(['/teachers/', '/workload/teachers/'], (req, res) => {
  const list = teachers.map((t) => {
    const dept = departments.find((d) => d.id === t.department)
    return {
      id: t.id,
      full_name: t.full_name,
      position: t.position || 'Преподаватель',
      department: t.department,
      department_name: dept ? dept.name : 'Кафедра ГиСЭН',
      department_code: dept ? dept.code : 'ГиСЭН',
      hours_limit: t.hours_limit || 900,
      user_id: t.id,
      user_username: t.user ? (Array.isArray(t.user) ? t.user[0] : t.user) : `t_${t.id}`,
    }
  })
  res.json(list)
})

apiApp.get(['/teachers/:id/', '/workload/teachers/:id/'], (req, res) => {
  const t = teachers.find((item) => item.id === Number(req.params.id))
  if (!t) return res.status(404).json({ detail: 'Преподаватель не найден' })
  const dept = departments.find((d) => d.id === t.department)
  res.json({
    id: t.id,
    full_name: t.full_name,
    position: t.position,
    department: t.department,
    department_name: dept ? dept.name : 'Кафедра ГиСЭН',
    department_code: dept ? dept.code : 'ГиСЭН',
    hours_limit: t.hours_limit || 900,
  })
})

apiApp.get('/teachers/:id/stats/', (req, res) => {
  const teacherId = Number(req.params.id)
  const t = teachers.find((item) => item.id === teacherId)
  const teacherWorkloads = workloads.filter((w) => w.teacher === teacherId)
  const plan = teacherWorkloads.reduce((acc, w) => acc + Number(w.hours_plan || 0), 0)
  const fact = teacherWorkloads.reduce((acc, w) => acc + Number(w.hours_fact || 0), 0)
  const limit = t ? t.hours_limit || 900 : 900
  res.json({
    hours_plan: plan,
    hours_fact: fact,
    hours_limit: limit,
    completion_pct: plan > 0 ? Math.round((fact / plan) * 1000) / 10 : 0,
    remaining_hours: Math.max(0, limit - fact),
  })
})

apiApp.get(['/groups/', '/workload/groups/'], (req, res) => {
  res.json(studyGroups)
})

apiApp.get(['/groups/:id/', '/workload/groups/:id/'], (req, res) => {
  const g = studyGroups.find((item) => item.id === Number(req.params.id))
  if (!g) return res.status(404).json({ detail: 'Группа не найдена' })
  res.json(g)
})

apiApp.get(['/disciplines/', '/workload/disciplines/'], (req, res) => {
  const lessonType = req.query.lesson_type
  let list = disciplines
  if (lessonType) {
    list = list.filter((d) => d.lesson_type === lessonType)
  }
  res.json(list)
})

apiApp.get('/disciplines/:id/card/', (req, res) => {
  const discId = Number(req.params.id)
  const disc = disciplines.find((d) => d.id === discId)
  if (!disc) return res.status(404).json({ detail: 'Дисциплина не найдена' })

  const discWorkloads = workloads.filter((w) => w.discipline === discId)
  const teachersMap = {}
  const groupsSet = new Set()

  for (const w of discWorkloads) {
    const t = teachers.find((tea) => tea.id === w.teacher)
    const grp = studyGroups.find((g) => g.id === w.group)
    if (grp) groupsSet.add(grp.name)

    if (t) {
      if (!teachersMap[t.id]) {
        teachersMap[t.id] = {
          teacher_id: t.id,
          teacher_name: t.full_name,
          position: t.position || 'Преподаватель',
          groups: [],
          hours_plan: 0,
          hours_fact: 0,
        }
      }
      if (grp && !teachersMap[t.id].groups.includes(grp.name)) {
        teachersMap[t.id].groups.push(grp.name)
      }
      teachersMap[t.id].hours_plan += Number(w.hours_plan || 0)
      teachersMap[t.id].hours_fact += Number(w.hours_fact || 0)
    }
  }

  const discGrades = grades.filter((g) => g.discipline === discId)
  const avgGrade =
    discGrades.length > 0
      ? discGrades.reduce((acc, g) => acc + Number(g.grade || 0), 0) / discGrades.length
      : 4.15

  // Survey answers for this discipline
  const discAnswers = surveyAnswers.filter((a) => {
    const assignment = surveyAssignments.find((asg) => asg.id === a.assignment)
    return assignment && assignment.discipline === discId && a.score != null
  })
  const discMetrics = computeQualityMetrics(discAnswers)
  const satisfactionRate = discMetrics.satisfaction_rate

  res.json({
    id: disc.id,
    name: disc.name,
    code: disc.code,
    total_hours: disc.total_hours,
    lesson_type: disc.lesson_type,
    lesson_type_display: disc.lesson_type_display,
    teachers: Object.values(teachersMap),
    groups: Array.from(groupsSet).sort(),
    hours_plan_total: Object.values(teachersMap).reduce((acc, t) => acc + t.hours_plan, 0),
    hours_fact_total: Object.values(teachersMap).reduce((acc, t) => acc + t.hours_fact, 0),
    avg_grade: Math.round(avgGrade * 100) / 100,
    grades_count: discGrades.length,
    satisfaction_rate: satisfactionRate,
  })
})

apiApp.get('/students/', (req, res) => {
  const { group, search, is_risk } = req.query
  let list = students.map((s) => {
    const grp = studyGroups.find((g) => g.id === s.group)
    const sGrades = grades.filter((g) => g.student === s.id)
    const avg =
      sGrades.length > 0
        ? sGrades.reduce((acc, g) => acc + Number(g.grade || 0), 0) / sGrades.length
        : 3.8
    const roundedAvg = Math.round(avg * 100) / 100
    const hasFail = sGrades.some((g) => Number(g.grade) < 3.0)
    const isRiskStudent = roundedAvg < 3.0 || hasFail
    return {
      id: s.id,
      full_name: s.full_name,
      email: s.email,
      group: s.group,
      group_name: grp ? grp.name : '—',
      avg_grade: roundedAvg,
      grades_count: sGrades.length,
      is_risk: isRiskStudent,
    }
  })

  if (group) list = list.filter((s) => s.group === Number(group))
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter((s) => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
  }
  if (is_risk === 'true' || is_risk === '1') {
    list = list.filter((s) => s.is_risk)
  }

  res.json(list)
})

apiApp.get('/students/:id/profile/', (req, res) => {
  const sId = Number(req.params.id)
  const student = students.find((s) => s.id === sId)
  if (!student) return res.status(404).json({ detail: 'Студент не найден' })

  const grp = studyGroups.find((g) => g.id === student.group)
  const studentGrades = grades.filter((g) => g.student === sId).map(enrichGrade)
  const avg =
    studentGrades.length > 0
      ? studentGrades.reduce((acc, g) => acc + g.grade, 0) / studentGrades.length
      : 0.0
  const roundedAvg = Math.round(avg * 100) / 100
  const failing = studentGrades.filter((g) => g.grade < 3.0).map((g) => g.discipline_name)
  const uniqueFailing = Array.from(new Set(failing))

  res.json({
    id: student.id,
    full_name: student.full_name,
    email: student.email,
    group_id: grp ? grp.id : null,
    group_name: grp ? grp.name : '—',
    course: grp ? grp.course : 1,
    direction_code: grp ? grp.direction_code : '',
    direction_name: grp ? grp.direction_name : '',
    avg_grade: roundedAvg,
    grades_count: studentGrades.length,
    is_risk: (roundedAvg > 0 && roundedAvg < 3.0) || uniqueFailing.length > 0,
    failing_disciplines: uniqueFailing,
    grades: studentGrades,
  })
})

// =========================================================================
// 4. Workload API (CRUD, Conflicts, Export, Import)
// =========================================================================
apiApp.get('/workload/', (req, res) => {
  const { teacher, group, discipline, semester, search } = req.query
  let list = workloads.map(enrichWorkload)

  if (teacher) list = list.filter((w) => w.teacher === Number(teacher))
  if (group) list = list.filter((w) => w.group === Number(group))
  if (discipline) list = list.filter((w) => w.discipline === Number(discipline))
  if (semester) list = list.filter((w) => w.semester === semester)
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter(
      (w) =>
        w.teacher_name.toLowerCase().includes(q) ||
        w.discipline_name.toLowerCase().includes(q) ||
        w.group_name.toLowerCase().includes(q)
    )
  }

  res.json(list)
})

apiApp.post('/workload/', (req, res) => {
  const newId = workloads.length > 0 ? Math.max(...workloads.map((w) => w.id)) + 1 : 1
  const item = {
    id: newId,
    teacher: Number(req.body.teacher),
    discipline: Number(req.body.discipline),
    group: Number(req.body.group),
    hours_plan: Number(req.body.hours_plan || 0),
    hours_fact: Number(req.body.hours_fact || 0),
    semester: req.body.semester || '2026-1',
    room: req.body.room || '101',
    day_of_week: Number(req.body.day_of_week || 1),
    lesson_number: Number(req.body.lesson_number || 1),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  workloads.unshift(item)
  persistDb()
  logAudit({ id: 1, username: 'head' }, 'CREATE', 'Workload', newId, null, item, req)
  res.status(201).json(enrichWorkload(item))
})

apiApp.put('/workload/:id/', (req, res) => {
  const id = Number(req.params.id)
  const idx = workloads.findIndex((w) => w.id === id)
  if (idx === -1) return res.status(404).json({ detail: 'Нагрузка не найдена' })

  const oldItem = { ...workloads[idx] }
  workloads[idx] = {
    ...workloads[idx],
    teacher: req.body.teacher !== undefined ? Number(req.body.teacher) : workloads[idx].teacher,
    discipline: req.body.discipline !== undefined ? Number(req.body.discipline) : workloads[idx].discipline,
    group: req.body.group !== undefined ? Number(req.body.group) : workloads[idx].group,
    hours_plan: req.body.hours_plan !== undefined ? Number(req.body.hours_plan) : workloads[idx].hours_plan,
    hours_fact: req.body.hours_fact !== undefined ? Number(req.body.hours_fact) : workloads[idx].hours_fact,
    semester: req.body.semester || workloads[idx].semester,
    room: req.body.room !== undefined ? req.body.room : workloads[idx].room,
    day_of_week: req.body.day_of_week !== undefined ? Number(req.body.day_of_week) : workloads[idx].day_of_week,
    lesson_number: req.body.lesson_number !== undefined ? Number(req.body.lesson_number) : workloads[idx].lesson_number,
    updated_at: new Date().toISOString(),
  }

  persistDb()
  logAudit({ id: 1, username: 'head' }, 'UPDATE', 'Workload', id, oldItem, workloads[idx], req)
  res.json(enrichWorkload(workloads[idx]))
})

apiApp.delete('/workload/:id/', (req, res) => {
  const id = Number(req.params.id)
  const idx = workloads.findIndex((w) => w.id === id)
  if (idx === -1) return res.status(404).json({ detail: 'Нагрузка не найдена' })
  const oldItem = workloads[idx]
  workloads.splice(idx, 1)
  persistDb()
  logAudit({ id: 1, username: 'head' }, 'DELETE', 'Workload', id, oldItem, null, req)
  res.status(204).send()
})

apiApp.post('/workload/check-conflicts/', (req, res) => {
  const { teacher, group, room, day_of_week, lesson_number, semester, exclude_id } = req.body
  if (!day_of_week || !lesson_number || !semester) {
    return res.json({ has_conflicts: false, conflicts: [] })
  }

  const conflicts = []
  for (const w of workloads) {
    if (exclude_id && w.id === Number(exclude_id)) continue
    if (w.semester !== semester || w.day_of_week !== Number(day_of_week) || w.lesson_number !== Number(lesson_number)) {
      continue
    }

    const t = teachers.find((item) => item.id === w.teacher)
    const grp = studyGroups.find((g) => g.id === w.group)
    const disc = disciplines.find((d) => d.id === w.discipline)
    const reasons = []

    if (teacher && w.teacher === Number(teacher)) {
      reasons.push(`Преподаватель ${t ? t.full_name : ''} уже занят`)
    }
    if (group && w.group === Number(group)) {
      reasons.push(`Группа ${grp ? grp.name : ''} уже на другой паре`)
    }
    if (room && w.room && String(w.room).trim().toLowerCase() === String(room).trim().toLowerCase()) {
      reasons.push(`Аудитория ${w.room} уже занята`)
    }

    if (reasons.length > 0) {
      conflicts.push({
        workload_id: w.id,
        reason:
          reasons.join(', ') +
          `: пара ${w.lesson_number} (${disc ? disc.name : ''}, гр. ${grp ? grp.name : ''})`,
        conflicting_teacher: t ? t.full_name : '',
        conflicting_group: grp ? grp.name : '',
        conflicting_room: w.room || '',
      })
    }
  }

  res.json({
    has_conflicts: conflicts.length > 0,
    conflicts: conflicts,
  })
})

// Real Excel Export for Workload
apiApp.get('/workload/export/', (req, res) => {
  const semester = req.query.semester || '2026-1'
  let list = workloads.filter((w) => !semester || semester === 'all' || w.semester === semester).map(enrichWorkload)
  if (list.length === 0) list = workloads.map(enrichWorkload)

  const excelRows = list.map((w, idx) => ({
    '№ п/п': idx + 1,
    'Преподаватель': w.teacher_name,
    'Должность': w.teacher_position,
    'Дисциплина': w.discipline_name,
    'Группа': w.group_name,
    'Семестр': w.semester,
    'Аудитория': w.room,
    'План (ч)': w.hours_plan,
    'Факт (ч)': w.hours_fact,
    'День недели': ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][w.day_of_week - 1] || 'Пн',
    'Пара': w.lesson_number,
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(excelRows)
  XLSX.utils.book_append_sheet(wb, ws, 'Нагрузка')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="workload_${semester}.xlsx"`)
  res.send(buf)
})

// Real Excel Import for Workload
apiApp.post('/workload/import/', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не предоставлен' })
  }

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const sheetName = wb.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })

    let importedCount = 0
    const errors = []

    rows.forEach((row, i) => {
      const rowNum = i + 2
      const teacherName = row['Преподаватель'] || row['ФИО'] || row['teacher']
      const discName = row['Дисциплина'] || row['Предмет'] || row['discipline']
      const groupName = row['Группа'] || row['group']

      if (!teacherName || !discName) {
        errors.push({ row: rowNum, error: 'Отсутствуют обязательные поля (Преподаватель / Дисциплина)' })
        return
      }

      let teacher = teachers.find((t) => t.full_name.toLowerCase().includes(String(teacherName).toLowerCase().trim()))
      if (!teacher) {
        teacher = {
          id: teachers.length + 1,
          full_name: String(teacherName).trim(),
          position: 'Преподаватель',
          department: departments[0]?.id || 12,
          department_name: departments[0]?.name || 'Кафедра МТиО',
          department_code: departments[0]?.code || 'МТиО',
          hours_limit: 900,
        }
        teachers.push(teacher)
      }

      let disc = disciplines.find((d) => d.name.toLowerCase().includes(String(discName).toLowerCase().trim()))
      if (!disc) {
        disc = {
          id: disciplines.length + 1,
          name: String(discName).trim(),
          code: `DISC-${disciplines.length + 1}`,
          total_hours: Number(row['План (ч)'] || row['Часы'] || 68),
          lesson_type: 'practice',
          lesson_type_display: 'Практика',
        }
        disciplines.push(disc)
      }

      let grp = studyGroups.find((g) => g.name.toLowerCase() === String(groupName).toLowerCase().trim())
      if (!grp && groupName) {
        grp = {
          id: studyGroups.length + 1,
          name: String(groupName).trim(),
          course: 1,
          year: 2026,
          direction_code: '09.03.01',
          direction_name: 'Прикладная информатика',
        }
        studyGroups.push(grp)
      }

      const newW = {
        id: workloads.length + 1,
        teacher: teacher.id,
        discipline: disc.id,
        group: grp ? grp.id : studyGroups[0]?.id || 1,
        hours_plan: Number(row['План (ч)'] || row['Часы'] || 68),
        hours_fact: Number(row['Факт (ч)'] || 0),
        semester: row['Семестр'] || '2026-1',
        room: String(row['Аудитория'] || '201'),
        day_of_week: Number(row['День недели'] || 1),
        lesson_number: Number(row['Пара'] || 1),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      workloads.push(newW)
      importedCount++
    })

    persistDb()
    logAudit({ id: 1, username: 'head' }, 'CREATE', 'Workload (Excel Import)', importedCount, null, { count: importedCount }, req)

    res.json({
      success: true,
      imported_count: importedCount,
      created_count: importedCount,
      total_rows: rows.length,
      errors: errors,
    })
  } catch (err) {
    res.status(400).json({ error: 'Не удалось прочитать файл Excel: ' + err.message })
  }
})

// =========================================================================
// 5. Grades API (CRUD, Risk Zone, Dynamics, Levels, Import, LMS)
// =========================================================================
apiApp.get('/grades/', (req, res) => {
  const { student, discipline, teacher, semester, search, min_grade, max_grade } = req.query
  let list = grades.map(enrichGrade)

  if (student) list = list.filter((g) => g.student === Number(student))
  if (discipline) list = list.filter((g) => g.discipline === Number(discipline))
  if (teacher) list = list.filter((g) => g.teacher === Number(teacher))
  if (semester) list = list.filter((g) => g.semester === semester)
  if (min_grade) list = list.filter((g) => g.grade >= Number(min_grade))
  if (max_grade) list = list.filter((g) => g.grade <= Number(max_grade))
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter(
      (g) =>
        g.student_name.toLowerCase().includes(q) ||
        g.discipline_name.toLowerCase().includes(q) ||
        g.student_group_name.toLowerCase().includes(q)
    )
  }

  res.json(list)
})

apiApp.post('/grades/', (req, res) => {
  const newId = grades.length > 0 ? Math.max(...grades.map((g) => g.id)) + 1 : 1
  const item = {
    id: newId,
    student: Number(req.body.student),
    discipline: Number(req.body.discipline),
    teacher: Number(req.body.teacher),
    semester: req.body.semester || '2026-1',
    grade: Number(req.body.grade || 4),
    date: req.body.date || new Date().toISOString().split('T')[0],
    source: req.body.source || 'manual',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  grades.unshift(item)
  persistDb()
  logAudit({ id: 1, username: 'head' }, 'CREATE', 'Grade', newId, null, item, req)
  res.status(201).json(enrichGrade(item))
})

apiApp.put('/grades/:id/', (req, res) => {
  const id = Number(req.params.id)
  const idx = grades.findIndex((g) => g.id === id)
  if (idx === -1) return res.status(404).json({ detail: 'Оценка не найдена' })

  const oldItem = { ...grades[idx] }
  grades[idx] = {
    ...grades[idx],
    grade: req.body.grade !== undefined ? Number(req.body.grade) : grades[idx].grade,
    semester: req.body.semester || grades[idx].semester,
    date: req.body.date || grades[idx].date,
    updated_at: new Date().toISOString(),
  }

  persistDb()
  logAudit({ id: 1, username: 'head' }, 'UPDATE', 'Grade', id, oldItem, grades[idx], req)
  res.json(enrichGrade(grades[idx]))
})

apiApp.delete('/grades/:id/', (req, res) => {
  const id = Number(req.params.id)
  const idx = grades.findIndex((g) => g.id === id)
  if (idx === -1) return res.status(404).json({ detail: 'Оценка не найдена' })
  const oldItem = grades[idx]
  grades.splice(idx, 1)
  persistDb()
  logAudit({ id: 1, username: 'head' }, 'DELETE', 'Grade', id, oldItem, null, req)
  res.status(204).send()
})

apiApp.get('/grades/risk-zone/', (req, res) => {
  const semester = req.query.semester
  const riskList = []

  for (const s of students) {
    let sGrades = grades.filter((g) => g.student === s.id)
    if (semester && semester !== 'all') {
      sGrades = sGrades.filter((g) => g.semester === semester)
    }

    if (sGrades.length === 0) continue

    const avg = sGrades.reduce((acc, g) => acc + Number(g.grade || 0), 0) / sGrades.length
    const roundedAvg = Math.round(avg * 100) / 100
    const failing = sGrades
      .filter((g) => Number(g.grade) < 3.0)
      .map((g) => {
        const d = disciplines.find((item) => item.id === g.discipline)
        return d ? d.name : 'Дисциплина'
      })

    if (roundedAvg < 3.0 || failing.length > 0) {
      const grp = studyGroups.find((g) => g.id === s.group)
      riskList.push({
        student_id: s.id,
        student_name: s.full_name,
        email: s.email,
        group_id: s.group,
        group_name: grp ? grp.name : '—',
        avg_grade: roundedAvg,
        grades_count: sGrades.length,
        failing_disciplines: Array.from(new Set(failing)),
      })
    }
  }

  riskList.sort((a, b) => a.avg_grade - b.avg_grade)
  res.json(riskList)
})

apiApp.get(['/grades/dynamics/', '/kpi/grades-dynamics/'], (req, res) => {
  const { period, group, discipline, teacher } = req.query
  let list = grades
  if (group) {
    const studentIdsInGroup = students.filter((s) => s.group === Number(group)).map((s) => s.id)
    list = list.filter((g) => studentIdsInGroup.includes(g.student))
  }
  if (discipline) list = list.filter((g) => g.discipline === Number(discipline))
  if (teacher) list = list.filter((g) => g.teacher === Number(teacher))

  if (period === 'monthly') {
    const monthlyData = [
      { period: '09.2026', semester: '09.2026', avg_grade: 3.78, total_grades: 120, pass_rate: 89.2 },
      { period: '10.2026', semester: '10.2026', avg_grade: 3.92, total_grades: 195, pass_rate: 92.4 },
      { period: '11.2026', semester: '11.2026', avg_grade: 4.05, total_grades: 160, pass_rate: 94.1 },
      { period: '12.2026', semester: '12.2026', avg_grade: 4.12, total_grades: 125, pass_rate: 96.0 },
    ]
    return res.json(monthlyData)
  }

  const dynamics = [
    { period: '2025-1', semester: '2025-1', avg_grade: 3.82, total_grades: 480, pass_rate: 88.5 },
    { period: '2025-2', semester: '2025-2', avg_grade: 3.94, total_grades: 510, pass_rate: 91.2 },
    { period: '2026-1', semester: '2026-1', avg_grade: 4.08, total_grades: grades.length, pass_rate: 94.6 },
  ]

  res.json(dynamics)
})

apiApp.get(['/grades/quality-levels/', '/kpi/quality-levels/'], (req, res) => {
  const { semester, group } = req.query
  let list = grades
  if (group) {
    const studentIds = students.filter((s) => s.group === Number(group)).map((s) => s.id)
    list = list.filter((g) => studentIds.includes(g.student))
  }
  if (semester && semester !== 'all') {
    list = list.filter((g) => g.semester === semester)
  }
  if (list.length === 0) list = grades

  const total = list.length
  const excellent = list.filter((g) => Number(g.grade) >= 4.5).length
  const good = list.filter((g) => Number(g.grade) >= 3.5 && Number(g.grade) < 4.5).length
  const satisfactory = list.filter((g) => Number(g.grade) >= 3.0 && Number(g.grade) < 3.5).length
  const unsatisfactory = list.filter((g) => Number(g.grade) < 3.0).length

  res.json({
    excellent,
    good,
    satisfactory,
    unsatisfactory,
    total,
    quality_rate: total > 0 ? Math.round(((excellent + good) / total) * 1000) / 10 : 0.0,
  })
})

apiApp.post('/grades/import/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл ведомости не предоставлен' })

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    let imported = 0
    rows.forEach((row) => {
      const studentName = row['ФИО студента'] || row['Студент'] || row['student']
      const discName = row['Дисциплина'] || row['Предмет'] || row['discipline']
      const gradeVal = Number(row['Оценка'] || row['grade'] || 4)

      if (studentName && discName) {
        let student = students.find((s) => s.full_name.toLowerCase().includes(String(studentName).toLowerCase()))
        if (!student) {
          student = {
            id: students.length + 1,
            full_name: String(studentName),
            email: `student_${students.length + 1}@misis.ru`,
            group: studyGroups[0]?.id || 1,
          }
          students.push(student)
        }

        let disc = disciplines.find((d) => d.name.toLowerCase().includes(String(discName).toLowerCase()))
        if (!disc) {
          disc = {
            id: disciplines.length + 1,
            name: String(discName),
            code: `DISC-${disciplines.length + 1}`,
            total_hours: 68,
            lesson_type: 'practice',
            lesson_type_display: 'Практика',
          }
          disciplines.push(disc)
        }

        grades.push({
          id: grades.length + 1,
          student: student.id,
          discipline: disc.id,
          teacher: teachers[0]?.id || 1,
          semester: '2026-1',
          grade: gradeVal,
          date: new Date().toISOString().split('T')[0],
          source: 'manual',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        imported++
      }
    })

    persistDb()
    logAudit({ id: 1, username: 'head' }, 'CREATE', 'Grade (Excel Import)', imported, null, { count: imported }, req)
    res.json({
      success: true,
      imported_count: imported,
      created_count: imported,
      total_rows: rows.length,
      errors: [],
    })
  } catch (err) {
    res.status(400).json({ error: 'Ошибка разбора ведомости: ' + err.message })
  }
})

apiApp.post('/grades/import-lms/', (req, res) => {
  const { course_id, semester = '2026-1' } = req.body
  const newGradesCount = 35

  for (let i = 0; i < newGradesCount; i++) {
    const student = students[i % students.length] || { id: 1 }
    const disc = disciplines[i % disciplines.length] || { id: 1 }
    const teacher = teachers[i % teachers.length] || { id: 1 }
    grades.push({
      id: grades.length + 1,
      student: student.id,
      discipline: disc.id,
      teacher: teacher.id,
      semester: semester,
      grade: [3, 4, 4, 5, 5][i % 5],
      date: new Date().toISOString().split('T')[0],
      source: 'moodle',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  persistDb()
  logAudit(
    { id: 1, username: 'head' },
    'CREATE',
    'Grade (LMS Sync)',
    course_id || 'Moodle',
    null,
    { course_id, imported: newGradesCount },
    req
  )

  res.json({
    success: true,
    created: newGradesCount,
    imported_count: newGradesCount,
    course_id: course_id || 'M-101',
    message: `Синхронизировано ${newGradesCount} оценок из Moodle`,
  })
})

apiApp.get('/grades/lms-status/', (req, res) => {
  res.json({
    backend: 'MockLMSClient',
    is_available: true,
    courses: [
      { id: 'M-101', name: 'Математический анализ', students_count: 28 },
      { id: 'M-102', name: 'История России', students_count: 32 },
      { id: 'M-103', name: 'Философия', students_count: 24 },
      { id: 'M-104', name: 'Экономическая теория', students_count: 30 },
      { id: 'M-105', name: 'Основы программирования', students_count: 26 },
    ],
  })
})

// =========================================================================
// 6. KPI API (Summary, Workload Chart, Directions Summary, Cache)
// =========================================================================
apiApp.get('/kpi/summary/', (req, res) => {
  const semester = req.query.semester
  const totalStudents = students.length

  let riskCount = 0
  for (const s of students) {
    let sGrades = grades.filter((g) => g.student === s.id)
    if (semester && semester !== 'all') {
      sGrades = sGrades.filter((g) => g.semester === semester)
    }
    if (sGrades.length > 0) {
      const avg = sGrades.reduce((acc, g) => acc + Number(g.grade || 0), 0) / sGrades.length
      if (avg < 3.0 || sGrades.some((g) => Number(g.grade) < 3.0)) {
        riskCount++
      }
    }
  }

  const riskPct = totalStudents > 0 ? Math.round((riskCount / totalStudents) * 1000) / 10 : 0.0

  let wl = workloads
  if (semester && semester !== 'all') wl = wl.filter((w) => w.semester === semester)
  if (wl.length === 0) wl = workloads

  const planTotal = wl.reduce((acc, w) => acc + Number(w.hours_plan || 0), 0)
  const factTotal = wl.reduce((acc, w) => acc + Number(w.hours_fact || 0), 0)
  const completionPct = planTotal > 0 ? Math.round((factTotal / planTotal) * 1000) / 10 : 0.0

  let gr = grades
  if (semester && semester !== 'all') gr = gr.filter((g) => g.semester === semester)
  if (gr.length === 0) gr = grades

  const avgGrade = gr.length > 0 ? gr.reduce((acc, g) => acc + Number(g.grade || 0), 0) / gr.length : 4.0
  const qualityCount = gr.filter((g) => Number(g.grade) >= 3.5).length
  const qualityRate = gr.length > 0 ? Math.round((qualityCount / gr.length) * 1000) / 10 : 0.0

  res.json({
    total_students: totalStudents,
    risk_students_count: riskCount,
    risk_students_pct: riskPct,
    hours_plan_total: planTotal,
    hours_fact_total: factTotal,
    hours_completion_pct: completionPct,
    avg_grade: Math.round(avgGrade * 100) / 100,
    quality_rate: qualityRate,
  })
})

apiApp.get('/kpi/workload-chart/', (req, res) => {
  const semester = req.query.semester
  const chartData = teachers.map((t) => {
    let tWorkloads = workloads.filter((w) => w.teacher === t.id)
    if (semester && semester !== 'all') {
      const filtered = tWorkloads.filter((w) => w.semester === semester)
      if (filtered.length > 0) tWorkloads = filtered
    }

    const plan = tWorkloads.reduce((acc, w) => acc + Number(w.hours_plan || 0), 0)
    const fact = tWorkloads.reduce((acc, w) => acc + Number(w.hours_fact || 0), 0)
    const limit = t.hours_limit || 900
    const completionPct = plan > 0 ? Math.round((fact / plan) * 1000) / 10 : 0.0

    return {
      teacher_id: t.id,
      teacher_name: t.full_name,
      hours_limit: limit,
      hours_plan: plan,
      hours_fact: fact,
      completion_pct: completionPct,
    }
  })

  chartData.sort((a, b) => b.hours_plan - a.hours_plan)
  res.json(chartData)
})

apiApp.get('/kpi/directions-summary/', (req, res) => {
  const directionsMap = {}
  for (const g of studyGroups) {
    if (!directionsMap[g.direction_code]) {
      directionsMap[g.direction_code] = {
        direction_code: g.direction_code,
        direction_name: g.direction_name,
        group_ids: [],
      }
    }
    directionsMap[g.direction_code].group_ids.push(g.id)
  }

  const summary = Object.values(directionsMap).map((d) => {
    const dirStudents = students.filter((s) => d.group_ids.includes(s.group))
    const studentIds = dirStudents.map((s) => s.id)
    const dirGrades = grades.filter((g) => studentIds.includes(g.student))
    const avg =
      dirGrades.length > 0
        ? dirGrades.reduce((acc, g) => acc + Number(g.grade || 0), 0) / dirGrades.length
        : 4.0

    let riskCount = 0
    for (const s of dirStudents) {
      const sg = grades.filter((g) => g.student === s.id)
      if (sg.length > 0) {
        const sAvg = sg.reduce((acc, g) => acc + Number(g.grade || 0), 0) / sg.length
        if (sAvg < 3.0 || sg.some((g) => Number(g.grade) < 3.0)) riskCount++
      }
    }

    return {
      direction_code: d.direction_code,
      direction_name: d.direction_name,
      students_count: dirStudents.length,
      avg_grade: Math.round(avg * 100) / 100,
      risk_count: riskCount,
    }
  })

  res.json(summary)
})

apiApp.post('/kpi/invalidate-cache/', (req, res) => {
  res.json({ status: 'ok', detail: 'Кэш показателей успешно сброшен' })
})

// =========================================================================
// 7. Surveys & Education Quality Module (Full Persistence & Analytics)
// =========================================================================
apiApp.get('/surveys/templates/', (req, res) => {
  res.json(surveyTemplates)
})

apiApp.get('/surveys/assignments/', (req, res) => {
  const { group, teacher, department, is_open } = req.query
  let list = surveyAssignments

  if (group) list = list.filter((a) => a.group === Number(group))
  if (teacher) list = list.filter((a) => a.teacher === Number(teacher))
  if (department) list = list.filter((a) => a.department === Number(department))
  if (is_open !== undefined) list = list.filter((a) => String(a.is_open) === String(is_open))

  const enriched = list.map((a) => {
    const t = teachers.find((item) => item.id === a.teacher)
    const d = disciplines.find((item) => item.id === a.discipline)
    const g = studyGroups.find((item) => item.id === a.group)
    const dep = departments.find((item) => item.id === a.department)
    const tpl = surveyTemplates.find((item) => item.id === a.template)
    const tplQuestions = surveyQuestions
      .filter((q) => q.template === a.template)
      .sort((x, y) => (x.order || 0) - (y.order || 0))

    return {
      ...a,
      teacher_name: t ? t.full_name : '—',
      teacher_position: t ? t.position : '—',
      discipline_name: d ? d.name : '—',
      group_name: g ? g.name : '—',
      department_name: dep ? dep.name : '—',
      template_title: tpl ? tpl.title : '—',
      questions: tplQuestions,
      template: {
        ...(tpl || {}),
        questions: tplQuestions,
      },
    }
  })

  res.json(enriched)
})

apiApp.get('/surveys/assignments/cascading-options/', (req, res) => {
  const { semester } = req.query
  let filterTemplateId = null
  if (semester) {
    const matched = surveyTemplates.find(
      (tpl) =>
        tpl.semester === semester ||
        (String(semester).toLowerCase().includes('весен') && tpl.semester === '2026-2') ||
        (String(semester).toLowerCase().includes('spring') && tpl.semester === '2026-2') ||
        (String(semester).toLowerCase().includes('осен') && tpl.semester === '2026-1') ||
        (String(semester).toLowerCase().includes('autumn') && tpl.semester === '2026-1')
    )
    if (matched) filterTemplateId = matched.id
  }

  const groupsDict = {}
  const items = []
  const seenKeys = new Set()

  for (const a of surveyAssignments) {
    if (filterTemplateId && a.template !== filterTemplateId) continue

    const tpl = surveyTemplates.find((t) => t.id === a.template) || surveyTemplates[0]
    const grp = studyGroups.find((g) => g.id === a.group)
    const disc = disciplines.find((d) => d.id === a.discipline)
    const tea = teachers.find((t) => t.id === a.teacher)
    const dep = departments.find((d) => d.id === a.department)

    if (grp) {
      if (!groupsDict[grp.id]) {
        groupsDict[grp.id] = {
          id: grp.id,
          name: grp.name,
          course: grp.course,
          direction: grp.direction_name,
        }
      }

      const semCode = tpl?.semester || '2026-1'
      const isSpring = semCode.endsWith('-2') || semCode === '2'
      const uniqueKey = `${semCode}_${grp.id}_${disc?.id || 1}_${tea?.id || 1}`
      if (seenKeys.has(uniqueKey)) continue
      seenKeys.add(uniqueKey)

      items.push({
        assignment_id: a.id,
        group_id: grp.id,
        group_name: grp.name,
        course: grp.course,
        direction: grp.direction_name,
        discipline_id: disc ? disc.id : 1,
        discipline_name: disc ? disc.name : 'Дисциплина',
        teacher_id: tea ? tea.id : 1,
        teacher_name: tea ? tea.full_name : 'Преподаватель',
        teacher_position: tea ? tea.position : 'Преподаватель',
        department_name: dep ? dep.name : 'Кафедра МТиО',
        semester: semCode,
        semester_type: isSpring ? 'spring' : 'autumn',
        semester_label: isSpring ? 'Весенний семестр' : 'Осенний семестр',
      })
    }
  }

  res.json({
    groups: Object.values(groupsDict).sort(
      (a, b) => (a.course || 0) - (b.course || 0) || a.name.localeCompare(b.name)
    ),
    items: items,
  })
})

apiApp.post('/surveys/submit/', (req, res) => {
  const { assignment_id, answers } = req.body
  const assignment = surveyAssignments.find((a) => a.id === Number(assignment_id))
  if (!assignment_id || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'Неверный формат данных опроса' })
  }

  const submissionHash = 'sub_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
  let createdCount = 0
  let totalSurveyScore = 0

  for (const ans of answers) {
    let computedScore = null
    if (ans.score !== undefined && ans.score !== null) {
      if (ans.choice) {
        computedScore = calculateQuestionScoreV2(ans.choice, ans.defects_count, ans.score)
      } else {
        const raw = Number(ans.score)
        // Если пришёл балл по шкале V2 (0, 0.25, 0.5, 1) — сохраняем напрямую; иначе конвертируем
        if (raw === 0 || raw === 0.25 || raw === 0.5 || raw === 1) {
          computedScore = raw
        } else {
          computedScore = migrateAnswerToV2Scale({ score: raw, text_response: ans.text_response }).score
        }
      }
      totalSurveyScore += computedScore
    }

    const item = {
      id: surveyAnswers.length + 1,
      assignment: Number(assignment_id),
      question: Number(ans.question_id || 1),
      score: computedScore,
      score_version: 2,
      choice: ans.choice || null,
      defects_count: ans.defects_count !== undefined ? Number(ans.defects_count) : null,
      text_response: ans.text_response ? String(ans.text_response).trim() : null,
      submission_hash: submissionHash,
      created_at: new Date().toISOString(),
      source: 'student',
      is_synthetic: false,
    }
    surveyAnswers.push(item)
    createdCount++
  }

  // Automatic recommendation generation if low scores (< 0.5 per question or < 3.0 total)
  if (assignment) {
    const lowScores = answers.filter((a) => a.score !== null && a.score !== undefined && Number(a.score) < 0.5)
    if (lowScores.length > 0) {
      const existingRec = teacherRecommendations.find(
        (r) => r.teacher === assignment.teacher && r.status === 'published'
      )
      if (!existingRec) {
        teacherRecommendations.unshift({
          id: teacherRecommendations.length + 1,
          teacher: assignment.teacher,
          discipline: assignment.discipline,
          semester: '2026-1',
          category: 'fairness',
          recommendation_text:
            'По результатам студенческого мониторинга рекомендуется обратить внимание на полноту выполнения стандартов проведения занятий и обратную связь в Moodle.',
          source: 'head',
          status: 'published',
          created_at: new Date().toISOString(),
        })
      }
    }
  }

  // Persist to disk immediately
  persistDb()

  logAudit(
    { id: 1, username: 'student_anonymous' },
    'CREATE',
    'SurveyAnswer',
    assignment_id,
    null,
    { answers_count: createdCount, total_score: Math.round(totalSurveyScore * 100) / 100, hash: submissionHash, source: 'student' },
    req
  )

  res.json({
    status: 'success',
    saved_count: createdCount,
    total_score: Math.round(totalSurveyScore * 100) / 100,
    max_score: 5.0,
    submission_hash: submissionHash,
    session_token: submissionHash,
    source: 'student',
    message: 'Спасибо за ваш отзыв! Оценка сохранена в реестр студенческих анкет.',
  })
})

apiApp.get('/surveys/analytics/branch-kpi/', async (req, res) => {
  await syncFromCloudRunInstance()
  const { answers: targetAnswers, source: currentSource, source_label } = getTargetAnswers(req)
  const branchMetrics = computeQualityMetrics(targetAnswers)
  const studentSurveysCount = countFilledSurveys(surveyAnswers)
  const syntheticSurveysCount = countFilledSurveys(syntheticSurveyAnswers)

  const deptsSummary = departments.map((dept) => {
    const deptAssignments = surveyAssignments.filter((asg) => asg.department === dept.id).map((asg) => asg.id)
    const deptAnswers = targetAnswers.filter((a) => deptAssignments.includes(a.assignment))
    const dMetrics = computeQualityMetrics(deptAnswers)
    const tCount = teachers.filter((t) => t.department === dept.id).length

    return {
      department_id: dept.id,
      department_code: dept.code,
      department_name: dept.name,
      satisfaction_rate: dMetrics.satisfaction_rate,
      average_score: dMetrics.average_score,
      answers_count: dMetrics.submissions_count,
      raw_answers_count: dMetrics.raw_answers_count,
      teachers_count: tCount,
    }
  })

  const evaluatedTeachers = teachers.filter((t) => {
    const tAssignments = surveyAssignments.filter((asg) => asg.teacher === t.id).map((asg) => asg.id)
    return targetAnswers.some((a) => tAssignments.includes(a.assignment) && a.score != null)
  })

  const evaluatedDisciplines = disciplines.filter((d) => {
    const dAssignments = surveyAssignments.filter((asg) => asg.discipline === d.id).map((asg) => asg.id)
    return targetAnswers.some((a) => dAssignments.includes(a.assignment) && a.score != null)
  })

  res.json({
    branch_title: 'Новотроицкий филиал НИТУ МИСИС',
    academic_year: '2026-2027',
    semester: '2026-1',
    data_source: currentSource,
    data_source_label: source_label,
    student_answers_count: studentSurveysCount,
    synthetic_answers_count: syntheticSurveysCount,
    student_raw_answers_count: surveyAnswers.length,
    synthetic_raw_answers_count: syntheticSurveyAnswers.length,
    branch_satisfaction_rate: branchMetrics.satisfaction_rate,
    branch_average_score: branchMetrics.average_score,
    total_answers_count: branchMetrics.submissions_count,
    raw_answers_count: branchMetrics.raw_answers_count,
    evaluated_teachers_count: evaluatedTeachers.length,
    evaluated_disciplines_count: evaluatedDisciplines.length,
    departments: deptsSummary,
  })
})

apiApp.get('/surveys/analytics/department-teachers/', (req, res) => {
  const { department } = req.query
  const { answers: targetAnswers, source: currentSource, source_label } = getTargetAnswers(req)
  let dept = null
  if (department) {
    dept = departments.find((d) => d.id === Number(department) || d.code === String(department))
  }

  let teacherList = teachers
  if (dept) {
    teacherList = teacherList.filter((t) => t.department === dept.id)
  }

  const result = teacherList.map((t) => {
    const tDept = departments.find((d) => d.id === t.department)
    const tAssignments = surveyAssignments.filter((asg) => asg.teacher === t.id).map((asg) => asg.id)
    const tAllAnswers = targetAnswers.filter((a) => tAssignments.includes(a.assignment))
    const tMetrics = computeQualityMetrics(tAllAnswers)

    const count = tMetrics.submissions_count
    const rate = tMetrics.satisfaction_rate
    const avgScore = tMetrics.average_score

    const status = count === 0 ? 'no_data' : rate >= 80 ? 'excellent' : rate >= 65 ? 'good' : 'attention'
    const recsCount = teacherRecommendations.filter((r) => r.teacher === t.id).length

    // Считаем ТОЛЬКО живые письменные отзывы студентов (написанные руками в текстовом поле)
    // Чекбоксы из жёлтых/красных вариантов считаются отдельно в defects_count!
    const writtenReviews = tAllAnswers.filter((a) => isWrittenStudentReview(a, surveyQuestions))
    const moderatedReviews = writtenReviews.map((a) =>
      analyzeStudentCommentModeration(a.text_response, a.moderation_status)
    )
    const cleanCommentsCount = moderatedReviews.filter((m) => !m.is_flagged).length
    const flaggedCommentsCount = moderatedReviews.filter((m) => m.is_flagged).length
    const defectsBlocks = tAllAnswers.filter((a) => a.score !== null && Number(a.score) < 1)

    const tStudentAnswers = surveyAnswers.filter((a) => tAssignments.includes(a.assignment))
    const tSyntheticAnswers = syntheticSurveyAnswers.filter((a) => tAssignments.includes(a.assignment))

    return {
      teacher_id: t.id,
      teacher_name: t.full_name,
      position: t.position || 'Преподаватель',
      department_code: tDept ? tDept.code : t.department_code || 'ГиСЭН',
      department_id: t.department,
      satisfaction_rate: rate,
      average_score: avgScore,
      avg_question_score: tMetrics.avg_question_score,
      responses_count: count, // количество анкет
      submissions_count: count,
      raw_answers_count: tMetrics.raw_answers_count,
      student_responses_count: countFilledSurveys(tStudentAnswers),
      synthetic_responses_count: countFilledSurveys(tSyntheticAnswers),
      status: status,
      comments_count: cleanCommentsCount, // только чистые письменные отзывы для главного экрана
      total_written_comments_count: writtenReviews.length,
      flagged_comments_count: flaggedCommentsCount,
      defects_count: defectsBlocks.length,
      recommendations_count: recsCount,
    }
  })

  result.sort((a, b) => b.average_score - a.average_score || b.responses_count - a.responses_count)

  res.json({
    department_id: dept ? dept.id : null,
    department_name: dept ? dept.name : 'Все кафедры филиала',
    data_source: currentSource,
    data_source_label: source_label,
    student_answers_count: countFilledSurveys(surveyAnswers),
    synthetic_answers_count: countFilledSurveys(syntheticSurveyAnswers),
    teachers: result,
  })
})

// Аналитика и рейтинг качества по ДИСЦИПЛИНАМ (Пункт 4 из замечаний ревьюера)
apiApp.get('/surveys/analytics/disciplines/', (req, res) => {
  const { department } = req.query
  const { answers: targetAnswers, source: currentSource, source_label } = getTargetAnswers(req)
  let dept = null
  if (department) {
    dept = departments.find((d) => d.id === Number(department) || d.code === String(department))
  }

  const categoryLabels = {
    relevance: 'Блок 1. Организационно-методическое обеспечение',
    clarity: 'Блок 2. Качество проведения занятий',
    fairness: 'Блок 3. Выполнение плана и дисциплина',
    ethics: 'Блок 4. Атмосфера вовлечённости и этика',
    facilities: 'Блок 5. Электронный курс в Moodle',
  }

  // Группируем дисциплины по нормализованному названию, чтобы не было дублей
  const discList = []
  for (const d of disciplines) {
    const dAsgs = surveyAssignments.filter((asg) => asg.discipline === d.id)
    const dWorkloads = workloads.filter((w) => w.discipline === d.id)
    if (dept) {
      const belongsToDept =
        dAsgs.some((asg) => asg.department === dept.id) ||
        dWorkloads.some((w) => {
          const tea = teachers.find((t) => t.id === w.teacher)
          return tea && tea.department === dept.id
        })
      if (!belongsToDept) continue
    }

    const asgIds = dAsgs.map((a) => a.id)
    const dAllAnswers = targetAnswers.filter((a) => asgIds.includes(a.assignment))
    const dScoredAnswers = dAllAnswers.filter((a) => a.score !== null && a.score !== undefined)
    const dMetrics = computeQualityMetrics(dAllAnswers)

    const dStudentAnswers = surveyAnswers.filter((a) => asgIds.includes(a.assignment))
    const dSyntheticAnswers = syntheticSurveyAnswers.filter((a) => asgIds.includes(a.assignment))

    // Преподаватели, ведущие данную дисциплину
    const teacherIds = [...new Set([...dWorkloads.map((w) => w.teacher), ...dAsgs.map((a) => a.teacher)])].filter(Boolean)
    const discTeachers = teacherIds
      .map((tId) => {
        const tea = teachers.find((t) => t.id === tId)
        if (!tea) return null
        const tAsgIds = dAsgs.filter((a) => a.teacher === tId).map((a) => a.id)
        const tAns = dAllAnswers.filter((a) => tAsgIds.includes(a.assignment))
        const tm = computeQualityMetrics(tAns)
        return {
          teacher_id: tea.id,
          teacher_name: tea.full_name,
          position: tea.position || 'Преподаватель',
          average_score: tm.average_score,
          satisfaction_rate: tm.satisfaction_rate,
          submissions_count: tm.submissions_count,
        }
      })
      .filter(Boolean)

    // Учебные группы по дисциплине (дедупликация по названию группы!)
    const groupsByName = {}
    const allGroupIds = [...new Set([...dWorkloads.map((w) => w.group), ...dAsgs.map((a) => a.group)])].filter(Boolean)
    for (const gId of allGroupIds) {
      const grp = studyGroups.find((g) => g.id === gId)
      if (!grp) continue
      const normName = String(grp.name).trim().toUpperCase()
      if (!groupsByName[normName]) {
        groupsByName[normName] = {
          group_id: grp.id,
          group_name: grp.name.trim(),
          group_ids: [],
        }
      }
      if (!groupsByName[normName].group_ids.includes(grp.id)) {
        groupsByName[normName].group_ids.push(grp.id)
      }
    }

    const discGroups = Object.values(groupsByName).map((gEntry) => {
      const grpAsgIds = dAsgs.filter((a) => gEntry.group_ids.includes(a.group)).map((a) => a.id)
      const grpAnswers = dAllAnswers.filter((a) => grpAsgIds.includes(a.assignment))
      const gm = computeQualityMetrics(grpAnswers)
      return {
        group_id: gEntry.group_id,
        group_name: gEntry.group_name,
        average_score: gm.average_score,
        satisfaction_rate: gm.satisfaction_rate,
        submissions_count: gm.submissions_count,
        responses_count: gm.submissions_count,
        status:
          gm.submissions_count === 0
            ? 'no_data'
            : gm.satisfaction_rate >= 80
            ? 'excellent'
            : gm.satisfaction_rate >= 65
            ? 'good'
            : 'attention',
      }
    })
    discGroups.sort((a, b) => b.submissions_count - a.submissions_count || a.group_name.localeCompare(b.group_name))

    // Оценки по 5 блокам для данной дисциплины
    const radarBlocks = ['relevance', 'clarity', 'fairness', 'ethics', 'facilities'].map((cat, idx) => {
      const qIds = surveyQuestions.filter((q) => q.category === cat && (q.order || 0) <= 5).map((q) => q.id)
      const qOrders = surveyQuestions.filter((q) => q.category === cat && (q.order || 0) <= 5).map((q) => q.order)
      const catAnswers = dScoredAnswers.filter(
        (a) => qIds.includes(a.question) || qOrders.includes(a.question) || a.question === idx + 1
      )
      const cm = computeQualityMetrics(catAnswers)
      return {
        category: cat,
        label: categoryLabels[cat],
        question_score: cm.avg_question_score, // 0..1.0 балл за вопрос
        score: cm.average_score, // 0..5.0 для совместимости с RadarChart
        max_score: 5.0,
        rate_pct: cm.satisfaction_rate,
      }
    })

    // Живые письменные отзывы студентов по дисциплине (без чекбоксов из вопросов №1-5)
    const writtenAnswers = dAllAnswers
      .filter((a) => isWrittenStudentReview(a, surveyQuestions))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

    const comments = writtenAnswers.map((a) => {
      const asg = surveyAssignments.find((item) => item.id === a.assignment)
      const tea = asg ? teachers.find((t) => t.id === asg.teacher) : null
      const grp = asg ? studyGroups.find((g) => g.id === asg.group) : null
      const mod = analyzeStudentCommentModeration(a.text_response, a.moderation_status)
      let dt = new Date().toLocaleDateString('ru-RU')
      try {
        if (a.created_at) dt = new Date(a.created_at).toLocaleDateString('ru-RU')
      } catch {}
      return {
        id: a.id,
        text: a.text_response,
        masked_text: mod.masked_text,
        is_flagged: mod.is_flagged,
        flag_category: mod.flag_category,
        flag_reason: mod.flag_reason,
        moderation_status: mod.moderation_status,
        date: dt,
        teacher_name: tea ? tea.full_name : '—',
        group_name: grp ? grp.name : '—',
        question_score: a.score,
        source: a.source || (a.is_synthetic ? 'synthetic' : 'student'),
        is_synthetic: Boolean(a.is_synthetic),
      }
    })

    const checkboxRemarks = buildCheckboxRemarksSummary(dAllAnswers, surveyAssignments, studyGroups, disciplines)
    const cleanCommentsCount = comments.filter((c) => !c.is_flagged).length
    const flaggedCommentsCount = comments.filter((c) => c.is_flagged).length
    const defectsBlocks = dScoredAnswers.filter((a) => Number(a.score) < 1)
    const recs = teacherRecommendations.filter((r) => r.discipline === d.id)
    const count = dMetrics.submissions_count
    const rate = dMetrics.satisfaction_rate

    discList.push({
      discipline_id: d.id,
      discipline_name: d.name,
      discipline_code: d.code || `Д-${d.id}`,
      lesson_type_display: d.lesson_type_display || 'Практика',
      average_score: dMetrics.average_score,
      avg_question_score: dMetrics.avg_question_score,
      satisfaction_rate: rate,
      responses_count: count,
      submissions_count: count,
      student_responses_count: countFilledSurveys(dStudentAnswers),
      synthetic_responses_count: countFilledSurveys(dSyntheticAnswers),
      status: count === 0 ? 'no_data' : rate >= 80 ? 'excellent' : rate >= 65 ? 'good' : 'attention',
      teachers: discTeachers,
      groups: discGroups,
      radar: radarBlocks,
      comments: comments,
      checkbox_remarks: checkboxRemarks,
      comments_count: cleanCommentsCount,
      total_written_comments_count: comments.length,
      flagged_comments_count: flaggedCommentsCount,
      defects_count: defectsBlocks.length,
      recommendations_count: recs.length,
    })
  }

  discList.sort((a, b) => b.average_score - a.average_score || b.responses_count - a.responses_count)

  res.json({
    department_id: dept ? dept.id : null,
    department_name: dept ? dept.name : 'Все кафедры филиала',
    data_source: currentSource,
    data_source_label: source_label,
    disciplines: discList,
  })
})

apiApp.get('/surveys/analytics/teacher-radar/', (req, res) => {
  const teacherId = Number(req.query.teacher || req.params.teacher || 1)
  const teacher = teachers.find((t) => t.id === teacherId) || teachers[0]
  if (!teacher) {
    return res.status(404).json({ error: 'Преподаватель не найден' })
  }

  const tDept = departments.find((d) => d.id === teacher.department)
  const { answers: targetAnswers, source: currentSource, source_label } = getTargetAnswers(req)
  const tAssignments = surveyAssignments.filter((asg) => asg.teacher === teacher.id).map((asg) => asg.id)
  const tAnswers = targetAnswers.filter((a) => tAssignments.includes(a.assignment))
  const scoredAnswers = tAnswers.filter((a) => a.score != null)
  const overallMetrics = computeQualityMetrics(tAnswers)
  const totalSubmissionsCount = overallMetrics.submissions_count

  const tStudentAnswers = surveyAnswers.filter((a) => tAssignments.includes(a.assignment))
  const tSyntheticAnswers = syntheticSurveyAnswers.filter((a) => tAssignments.includes(a.assignment))

  const categoryLabels = {
    relevance: 'Организационно-методическое обеспечение',
    clarity: 'Качество проведения занятий',
    fairness: 'Выполнение плана и дисциплина',
    ethics: 'Педагогический такт и этика',
    facilities: 'Использование LMS Moodle',
  }

  const radarData = [
    { category: 'relevance', label: categoryLabels.relevance, question_score: 0, score: 0, max_score: 5.0, rate_pct: 0 },
    { category: 'clarity', label: categoryLabels.clarity, question_score: 0, score: 0, max_score: 5.0, rate_pct: 0 },
    { category: 'fairness', label: categoryLabels.fairness, question_score: 0, score: 0, max_score: 5.0, rate_pct: 0 },
    { category: 'ethics', label: categoryLabels.ethics, question_score: 0, score: 0, max_score: 5.0, rate_pct: 0 },
    { category: 'facilities', label: categoryLabels.facilities, question_score: 0, score: 0, max_score: 5.0, rate_pct: 0 },
  ]

  if (scoredAnswers.length > 0) {
    radarData.forEach((r, idx) => {
      const qIds = surveyQuestions.filter((q) => q.category === r.category && (q.order || 0) <= 5).map((q) => q.id)
      const qOrders = surveyQuestions.filter((q) => q.category === r.category && (q.order || 0) <= 5).map((q) => q.order)
      const catAnswers = scoredAnswers.filter(
        (a) => qIds.includes(a.question) || qOrders.includes(a.question) || a.question === idx + 1
      )
      if (catAnswers.length > 0) {
        const cm = computeQualityMetrics(catAnswers)
        r.question_score = cm.avg_question_score // балл за вопрос из 1.0 (0..1.0)
        r.score = cm.average_score // приведённый к 5.0 для лепестковой диаграммы
        r.rate_pct = cm.satisfaction_rate
      }
    })
  }

  const overallAvg = overallMetrics.average_score
  const overallRate = overallMetrics.satisfaction_rate

  // Живые письменные отзывы студентов (написанные руками в текстовом поле, без чекбоксов из вопросов №1-5)
  const writtenAnswers = tAnswers
    .filter((a) => isWrittenStudentReview(a, surveyQuestions))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

  const comments = writtenAnswers.map((a) => {
    const asg = surveyAssignments.find((item) => item.id === a.assignment)
    const disc = asg ? disciplines.find((d) => d.id === asg.discipline) : null
    const grp = asg ? studyGroups.find((g) => g.id === asg.group) : null
    const mod = analyzeStudentCommentModeration(a.text_response, a.moderation_status)
    let dt = new Date().toLocaleDateString('ru-RU')
    try {
      if (a.created_at) dt = new Date(a.created_at).toLocaleDateString('ru-RU')
    } catch {}
    return {
      id: a.id,
      text: a.text_response,
      masked_text: mod.masked_text,
      is_flagged: mod.is_flagged,
      flag_category: mod.flag_category,
      flag_reason: mod.flag_reason,
      moderation_status: mod.moderation_status,
      date: dt,
      discipline_name: disc ? disc.name : null,
      group_name: grp ? grp.name : null,
      question_score: a.score,
      source: a.source || (a.is_synthetic ? 'synthetic' : 'student'),
      is_synthetic: Boolean(a.is_synthetic),
    }
  })

  // Сгруппированные замечания по чекбоксам из вопросов №1-5 (с количеством выборов студентами)
  const checkboxRemarks = buildCheckboxRemarksSummary(tAnswers, surveyAssignments, studyGroups, disciplines)
  const defectsBlocksCount = tAnswers.filter((a) => a.score !== null && Number(a.score) < 1).length

  // Дисциплины и группы преподавателя (дедупликация групп по нормализованному имени!)
  const teacherWorkloads = workloads.filter((w) => w.teacher === teacher.id)
  const teacherAsgs = surveyAssignments.filter((asg) => asg.teacher === teacher.id)
  const discIds = [
    ...new Set([...teacherWorkloads.map((w) => w.discipline), ...teacherAsgs.map((a) => a.discipline)]),
  ].filter(Boolean)

  const discDetails = discIds.map((dId) => {
    const disc = disciplines.find((d) => d.id === dId)
    const asgs = teacherAsgs.filter((asg) => asg.discipline === dId)
    const wls = teacherWorkloads.filter((w) => w.discipline === dId)
    const asgIds = asgs.map((asg) => asg.id)
    const dAnswers = targetAnswers.filter((a) => asgIds.includes(a.assignment))
    const dMetrics = computeQualityMetrics(dAnswers)

    // Дедуплицируем группы строго по нормализованному названию (чтобы БХТ-26 никогда не дублировалась)
    const groupsByName = {}
    const allGroupIds = [...new Set([...asgs.map((a) => a.group), ...wls.map((w) => w.group)])].filter(Boolean)

    for (const gId of allGroupIds) {
      const grp = studyGroups.find((g) => g.id === gId)
      if (!grp) continue
      const normName = String(grp.name).trim().toUpperCase()
      if (!groupsByName[normName]) {
        groupsByName[normName] = {
          group_id: grp.id,
          group_name: grp.name.trim(),
          group_ids: [],
        }
      }
      if (!groupsByName[normName].group_ids.includes(grp.id)) {
        groupsByName[normName].group_ids.push(grp.id)
      }
    }

    const groupsTaught = Object.values(groupsByName).map((gEntry) => {
      const grpAsgIds = asgs.filter((asg) => gEntry.group_ids.includes(asg.group)).map((asg) => asg.id)
      const grpAnswers = targetAnswers.filter((a) => grpAsgIds.includes(a.assignment))
      const gm = computeQualityMetrics(grpAnswers)
      return {
        group_id: gEntry.group_id,
        group_name: gEntry.group_name,
        average_score: gm.average_score,
        satisfaction_rate: gm.satisfaction_rate,
        responses_count: gm.submissions_count, // количество заполненных анкет (а не отдельных вопросов!)
        submissions_count: gm.submissions_count,
        raw_answers_count: gm.raw_answers_count,
        status:
          gm.submissions_count === 0
            ? 'no_data'
            : gm.satisfaction_rate >= 80
            ? 'excellent'
            : gm.satisfaction_rate >= 65
            ? 'good'
            : 'attention',
      }
    })

    // Сортируем группы: сначала те, где есть анкеты, затем по названию
    groupsTaught.sort((a, b) => b.submissions_count - a.submissions_count || a.group_name.localeCompare(b.group_name))

    return {
      discipline_id: dId,
      discipline_name: disc ? disc.name : 'Дисциплина',
      average_score: dMetrics.average_score,
      average_satisfaction: dMetrics.satisfaction_rate,
      submissions_count: dMetrics.submissions_count,
      groups: groupsTaught,
    }
  })

  const recs = teacherRecommendations.filter((r) => r.teacher === teacher.id)

  const responsePayload = {
    teacher_id: teacher.id,
    teacher_name: teacher.full_name,
    position: teacher.position || 'Преподаватель',
    department_name: tDept ? tDept.name : teacher.department_name || 'Кафедра ГиСЭН',
    department_code: tDept ? tDept.code : teacher.department_code || 'ГиСЭН',
    data_source: currentSource,
    data_source_label: source_label,
    overall_rate: overallRate,
    overall_score: overallAvg,
    overall_avg: overallAvg,
    total_responses: totalSubmissionsCount,
    raw_answers_count: overallMetrics.raw_answers_count,
    student_responses_count: countFilledSurveys(tStudentAnswers),
    synthetic_responses_count: countFilledSurveys(tSyntheticAnswers),
    radar: radarData,
    radar_data: radarData,
    comments: comments,
    reviews: comments,
    clean_comments_count: comments.filter((c) => !c.is_flagged).length,
    flagged_comments_count: comments.filter((c) => c.is_flagged).length,
    checkbox_remarks: checkboxRemarks,
    defects_count: defectsBlocksCount,
    recommendations: recs,
    disciplines: discDetails,
  }

  res.json(responsePayload)
})

apiApp.get('/surveys/answers/', (req, res) => {
  const { assignment, teacher, question } = req.query
  const { answers: targetAnswers } = getTargetAnswers(req)
  let list = targetAnswers
  if (assignment) list = list.filter((a) => a.assignment === Number(assignment))
  if (question) list = list.filter((a) => a.question === Number(question))
  if (teacher) {
    const tAsgs = surveyAssignments.filter((asg) => asg.teacher === Number(teacher)).map((asg) => asg.id)
    list = list.filter((a) => tAsgs.includes(a.assignment))
  }
  res.json(list)
})

// Статистика по источникам данных (студенческие vs синтетические)
apiApp.get('/surveys/stats/sources/', (req, res) => {
  res.json({
    student_count: surveyAnswers.length,
    synthetic_count: syntheticSurveyAnswers.length,
    total_count: surveyAnswers.length + syntheticSurveyAnswers.length,
    last_student_submission: surveyAnswers.length > 0 ? surveyAnswers[surveyAnswers.length - 1].created_at : null,
  })
})

// Очистить ТОЛЬКО синтетические тестовые данные (ответы реальных студентов остаются в неприкосновенности)
apiApp.post('/surveys/clear-synthetic/', (req, res) => {
  const prevCount = syntheticSurveyAnswers.length
  syntheticSurveyAnswers = []
  persistDb()
  logAudit(
    req.user || { id: 1, username: 'head' },
    'DELETE',
    'SyntheticSurveyAnswer',
    'ALL',
    { cleared_count: prevCount },
    { count: 0 },
    req
  )
  res.json({
    status: 'success',
    cleared_count: prevCount,
    student_answers_kept: surveyAnswers.length,
    message: `Синтетические данные (${prevCount} ответов) очищены. Реальные ответы студентов сохранены (${surveyAnswers.length} ответов).`,
  })
})

// Восстановить синтетические данные из оригинального пакета фикстур без изменения ответов студентов
apiApp.post('/surveys/restore-synthetic/', (req, res) => {
  const restored = getFixtureSyntheticAnswers()
  syntheticSurveyAnswers = restored
  persistDb()
  logAudit(
    req.user || { id: 1, username: 'head' },
    'CREATE',
    'SyntheticSurveyAnswer',
    'RESTORE',
    null,
    { count: restored.length },
    req
  )
  res.json({
    status: 'success',
    restored_count: restored.length,
    student_answers_kept: surveyAnswers.length,
    message: `Синтетические данные успешно восстановлены (${restored.length} записей). Реальные ответы студентов не затронуты (${surveyAnswers.length} записей).`,
  })
})

// Очистить только ответы студентов (если требуется очистить тестовые прогоны студентов)
apiApp.post('/surveys/clear-student/', (req, res) => {
  const prevCount = surveyAnswers.length
  surveyAnswers = []
  persistDb()
  logAudit(
    req.user || { id: 1, username: 'head' },
    'DELETE',
    'StudentSurveyAnswer',
    'ALL',
    { cleared_count: prevCount },
    { count: 0 },
    req
  )
  res.json({
    status: 'success',
    cleared_count: prevCount,
    message: `Реальные ответы студентов (${prevCount} ответов) успешно очищены.`,
  })
})

// Универсальный endpoint сброса с поддержкой указания целевого хранилища
apiApp.post(['/surveys/reset-answers/', '/surveys/clear-answers/'], (req, res) => {
  const target = req.body?.target || 'all'
  let msg = ''
  let clearedStudent = 0
  let clearedSynthetic = 0

  if (target === 'student') {
    clearedStudent = surveyAnswers.length
    surveyAnswers = []
    msg = `Реальные ответы студентов очищены (${clearedStudent} шт.).`
  } else if (target === 'synthetic') {
    clearedSynthetic = syntheticSurveyAnswers.length
    syntheticSurveyAnswers = []
    msg = `Синтетические данные очищены (${clearedSynthetic} шт.).`
  } else {
    clearedStudent = surveyAnswers.length
    clearedSynthetic = syntheticSurveyAnswers.length
    surveyAnswers = []
    syntheticSurveyAnswers = []
    msg = `Все данные опросов очищены (студентов: ${clearedStudent}, синтетических: ${clearedSynthetic}).`
  }

  persistDb()
  logAudit(
    req.user || { id: 1, username: 'head' },
    'DELETE',
    'SurveyAnswer',
    target,
    { clearedStudent, clearedSynthetic },
    { count: 0 },
    req
  )
  res.json({
    status: 'success',
    target,
    cleared_student_count: clearedStudent,
    cleared_synthetic_count: clearedSynthetic,
    message: msg,
  })
})

apiApp.get('/surveys/recommendations/', (req, res) => {
  const { teacher, semester, status } = req.query
  let list = teacherRecommendations
  if (teacher) list = list.filter((r) => r.teacher === Number(teacher))
  if (semester) list = list.filter((r) => r.semester === semester)
  if (status) list = list.filter((r) => r.status === status)
  res.json(list)
})

apiApp.post('/surveys/recommendations/', (req, res) => {
  const newRec = {
    id: teacherRecommendations.length + 1,
    teacher: Number(req.body.teacher),
    discipline: Number(req.body.discipline || 1),
    semester: req.body.semester || '2026-1',
    category: req.body.category || 'general',
    recommendation_text: req.body.recommendation_text,
    source: req.body.source || 'head',
    status: req.body.status || 'published',
    created_at: new Date().toISOString(),
  }
  teacherRecommendations.unshift(newRec)
  persistDb()
  logAudit({ id: 1, username: 'head' }, 'CREATE', 'TeacherRecommendation', newRec.id, null, newRec, req)
  res.status(201).json(newRec)
})

apiApp.patch('/surveys/recommendations/:id/', (req, res) => {
  const id = Number(req.params.id)
  const rec = teacherRecommendations.find((r) => r.id === id)
  if (!rec) return res.status(404).json({ detail: 'Рекомендация не найдена' })
  if (req.body.status) rec.status = req.body.status
  if (req.body.recommendation_text) rec.recommendation_text = req.body.recommendation_text
  persistDb()
  res.json(rec)
})

// Ручная модерация студенческого текстового отзыва (одобрить для показа / скрыть / вернуть авто-фильтр)
apiApp.post('/surveys/comments/:id/moderate/', (req, res) => {
  const id = Number(req.params.id)
  const { status } = req.body // 'approved' | 'hidden' | 'auto'
  const allowed = ['approved', 'hidden', 'auto']
  const nextStatus = allowed.includes(status) ? status : 'auto'

  let target = surveyAnswers.find((a) => a.id === id)
  if (!target) {
    target = syntheticSurveyAnswers.find((a) => a.id === id)
  }
  if (!target) {
    return res.status(404).json({ detail: 'Отзыв не найден' })
  }

  target.moderation_status = nextStatus
  persistDb()
  const mod = analyzeStudentCommentModeration(target.text_response, target.moderation_status)
  logAudit(
    getRequestUser(req),
    'UPDATE',
    'SurveyCommentModeration',
    id,
    null,
    { status: nextStatus, is_flagged: mod.is_flagged },
    req
  )
  res.json({
    id: target.id,
    moderation_status: target.moderation_status,
    ...mod,
  })
})

// =========================================================================
// 8. Reports API (Excel & HTML/PDF)
// =========================================================================
apiApp.get('/reports/workload-excel/', (req, res) => {
  const semester = req.query.semester || '2026-1'
  const list = workloads.map(enrichWorkload)

  const rows = list.map((w, i) => ({
    '№': i + 1,
    'Кафедра': w.department_code || 'ГиСЭН',
    'Преподаватель': w.teacher_name,
    'Должность': w.teacher_position,
    'Дисциплина': w.discipline_name,
    'Группа': w.group_name,
    'Семестр': w.semester,
    'Аудитория': w.room,
    'План (часы)': w.hours_plan,
    'Факт (часы)': w.hours_fact,
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Отчет_Нагрузка')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="workload_report_${semester}.xlsx"`)
  res.send(buf)
})

apiApp.get('/reports/workload-pdf/', (req, res) => {
  const semester = req.query.semester || '2026-1'
  const list = workloads.slice(0, 30).map(enrichWorkload)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Отчет по учебной нагрузке кафедры (${semester})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; }
    h1 { font-size: 20px; margin-bottom: 4px; color: #0f172a; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background-color: #f1f5f9; font-weight: 600; }
    .total-box { margin-top: 20px; padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; font-weight: 600; font-size: 13px; }
  </style>
</head>
<body>
  <h1>СВОДНЫЙ ОТЧЕТ ПО УЧЕБНОЙ НАГРУЗКЕ</h1>
  <div class="subtitle">Новотроицкий филиал НИТУ МИСИС | Семестр: ${semester} | Сформирован: ${new Date().toLocaleDateString('ru-RU')}</div>
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>Преподаватель</th>
        <th>Дисциплина</th>
        <th>Группа</th>
        <th>Аудитория</th>
        <th>План (ч)</th>
        <th>Факт (ч)</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map(
          (w, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${w.teacher_name}</td>
          <td>${w.discipline_name}</td>
          <td>${w.group_name}</td>
          <td>${w.room}</td>
          <td>${w.hours_plan}</td>
          <td>${w.hours_fact}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>
  <div class="total-box">
    Всего записей нагрузки: ${workloads.length} | Суммарно часов по филиалу: ${workloads.reduce((acc, w) => acc + Number(w.hours_plan || 0), 0)} ч.
  </div>
  <script>window.print();</script>
</body>
</html>`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

apiApp.get('/reports/grades-excel/', (req, res) => {
  const semester = req.query.semester || '2026-1'
  const list = grades.map(enrichGrade)

  const rows = list.map((g, i) => ({
    '№': i + 1,
    'Студент': g.student_name,
    'Группа': g.student_group_name,
    'Дисциплина': g.discipline_name,
    'Преподаватель': g.teacher_name,
    'Оценка': g.grade,
    'Семестр': g.semester,
    'Дата': g.date,
    'Источник': g.source_display,
  }))

  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Отчет_Успеваемость')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="grades_report_${semester}.xlsx"`)
  res.send(buf)
})

apiApp.get('/reports/grades-pdf/', (req, res) => {
  const semester = req.query.semester || '2026-1'
  const list = grades.slice(0, 30).map(enrichGrade)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ведомость успеваемости (${semester})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; }
    h1 { font-size: 20px; margin-bottom: 4px; color: #0f172a; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background-color: #f1f5f9; font-weight: 600; }
    .grade-badge { font-weight: 700; color: #15803d; }
  </style>
</head>
<body>
  <h1>ВЕДОМОСТЬ АКАДЕМИЧЕСКОЙ УСПЕВАЕМОСТИ</h1>
  <div class="subtitle">Новотроицкий филиал НИТУ МИСИС | Семестр: ${semester} | Дата выгрузки: ${new Date().toLocaleDateString('ru-RU')}</div>
  <table>
    <thead>
      <tr>
        <th>№</th>
        <th>Студент</th>
        <th>Группа</th>
        <th>Дисциплина</th>
        <th>Преподаватель</th>
        <th>Оценка</th>
        <th>Источник</th>
      </tr>
    </thead>
    <tbody>
      ${list
        .map(
          (g, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${g.student_name}</td>
          <td>${g.student_group_name}</td>
          <td>${g.discipline_name}</td>
          <td>${g.teacher_name}</td>
          <td class="grade-badge">${g.grade}</td>
          <td>${g.source_display}</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>
  <div style="margin-top: 20px; font-weight: 600; font-size: 13px;">
    Всего выставлено оценок: ${grades.length} | Средний академический балл по филиалу: ${(grades.reduce((a, b) => a + Number(b.grade || 0), 0) / grades.length).toFixed(2)}
  </div>
  <script>window.print();</script>
</body>
</html>`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(html)
})

// =========================================================================
// 9. Audit Log API
// =========================================================================
apiApp.get('/audit/', (req, res) => {
  const { action, table_name, user, search } = req.query
  let list = auditLogs

  if (action) list = list.filter((a) => a.action.toUpperCase() === String(action).toUpperCase())
  if (table_name) list = list.filter((a) => a.table_name.toLowerCase().includes(String(table_name).toLowerCase()))
  if (user) list = list.filter((a) => a.user === Number(user))
  if (search) {
    const q = String(search).toLowerCase()
    list = list.filter(
      (a) =>
        a.user_username.toLowerCase().includes(q) ||
        a.table_name.toLowerCase().includes(q) ||
        a.action.toLowerCase().includes(q)
    )
  }

  res.json(list)
})

// =========================================================================
// 10. OpenAPI Schema Endpoints
// =========================================================================
apiApp.get('/schema/', (req, res) => {
  const schemaPath = path.join(__dirname, '..', 'openapi_schema.json')
  if (fs.existsSync(schemaPath)) {
    return res.sendFile(schemaPath)
  }
  res.json({ openapi: '3.0.3', info: { title: 'KafIS API', version: '1.0.0' } })
})

apiApp.get('/schema/swagger-ui/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>KafIS - Swagger UI</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body style="margin: 0; padding: 0;">
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/schema/',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis],
      layout: 'BaseLayout'
    });
  </script>
</body>
</html>`)
})

apiApp.get('/schema/redoc/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>KafIS - Redoc</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link href="https://fonts.googleapis.com/css?family=Montserrat:300,400,700|Roboto:300,400,700" rel="stylesheet">
  <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
  <redoc spec-url="/api/schema/"></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`)
})
