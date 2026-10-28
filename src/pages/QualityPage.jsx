import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  Typography,
  Button,
  Tag,
  Table,
  Progress,
  Radio,
  Alert,
  Badge,
  Popconfirm,
  Dropdown,
  Tooltip,
  Modal,
  Tabs,
  List,
  Rate,
  Switch,
  message,
} from 'antd'
import {
  Building2,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  GraduationCap,
  FlaskConical,
  Database,
  Trash2,
  RotateCcw,
  ShieldCheck,
  MoreVertical,
  BookOpen,
  Users,
  MessageSquare,
  Sparkles,
  HelpCircle,
  Award,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getBranchKpi,
  getDepartmentTeachersQuality,
  getDisciplinesQuality,
  getTeacherRadarAnalytics,
  clearSyntheticSurveyAnswers,
  restoreSyntheticSurveyAnswers,
  clearStudentSurveyAnswers,
} from '../api/surveys'
import { TeacherQualityModal } from '../components/surveys/TeacherQualityModal'
import { TeacherRadarChart } from '../components/charts/TeacherRadarChart'

const { Title, Text, Paragraph } = Typography

export function QualityPage() {
  const navigate = useNavigate()
  const [selectedDeptId, setSelectedDeptId] = useState(null)
  const [selectedTeacherId, setSelectedTeacherId] = useState(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Режим просмотра: 'teachers' (По преподавателям) | 'disciplines' (По дисциплинам)
  const [viewMode, setViewMode] = useState('teachers')
  const [selectedDiscipline, setSelectedDiscipline] = useState(null)
  const [isDisciplineModalOpen, setIsDisciplineModalOpen] = useState(false)

  // Источник данных: 'student' (по умолчанию реальные студенты), 'synthetic' (тестовая выборка), 'all' (все)
  const [dataSource, setDataSource] = useState('student')
  // Режим презентации: скрывает нецензурные/троллинговые отзывы на главном экране (включен по умолчанию)
  const [presentationMode, setPresentationMode] = useState(true)
  const [revealedDiscIds, setRevealedDiscIds] = useState({})
  const [isActionLoading, setIsActionLoading] = useState(false)

  // 1. Сводный показатель филиала
  const {
    data: branchKpi,
    isLoading: loadingKpi,
    refetch: refetchKpi,
  } = useQuery({
    queryKey: ['surveys-branch-kpi', dataSource],
    queryFn: () => getBranchKpi({ semester: '2026-1', source: dataSource }),
  })

  // 2. Список преподавателей кафедры
  const {
    data: teachersQuality,
    isLoading: loadingTeachers,
    refetch: refetchTeachers,
  } = useQuery({
    queryKey: ['surveys-dept-teachers', selectedDeptId, dataSource],
    queryFn: () =>
      getDepartmentTeachersQuality({
        department: selectedDeptId,
        semester: '2026-1',
        source: dataSource,
      }),
  })

  // 3. Список дисциплин с оценками качества
  const {
    data: disciplinesQuality,
    isLoading: loadingDisciplines,
    refetch: refetchDisciplines,
  } = useQuery({
    queryKey: ['surveys-disciplines-quality', selectedDeptId, dataSource],
    queryFn: () =>
      getDisciplinesQuality({
        department: selectedDeptId,
        semester: '2026-1',
        source: dataSource,
      }),
  })

  // 4. Данные радара выбранного преподавателя
  const {
    data: teacherRadar,
    isLoading: loadingRadar,
    refetch: refetchRadar,
  } = useQuery({
    queryKey: ['surveys-teacher-radar', selectedTeacherId, dataSource],
    queryFn: () =>
      getTeacherRadarAnalytics({
        teacher: selectedTeacherId,
        semester: '2026-1',
        source: dataSource,
      }),
    enabled: !!selectedTeacherId,
  })

  const handleOpenTeacherModal = (teacherId) => {
    setSelectedTeacherId(teacherId)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  const handleOpenDisciplineModal = (discRecord) => {
    setSelectedDiscipline(discRecord)
    setIsDisciplineModalOpen(true)
  }

  const handleRefreshAll = () => {
    refetchKpi()
    refetchTeachers()
    refetchDisciplines()
    if (selectedTeacherId) refetchRadar()
  }

  const handleClearSynthetic = async () => {
    setIsActionLoading(true)
    try {
      const res = await clearSyntheticSurveyAnswers()
      message.success(res.message || 'Синтетические данные очищены')
      handleRefreshAll()
    } catch {
      message.error('Ошибка при очистке синтетических данных')
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleRestoreSynthetic = async () => {
    setIsActionLoading(true)
    try {
      const res = await restoreSyntheticSurveyAnswers()
      message.success(res.message || 'Синтетические данные восстановлены')
      handleRefreshAll()
    } catch {
      message.error('Ошибка при восстановлении синтетических данных')
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleClearStudent = async () => {
    setIsActionLoading(true)
    try {
      const res = await clearStudentSurveyAnswers()
      message.success(res.message || 'Ответы студентов очищены')
      handleRefreshAll()
    } catch {
      message.error('Ошибка при очистке студенческих ответов')
    } finally {
      setIsActionLoading(false)
    }
  }

  // Общий рендерер столбца «Отзывы и замечания» (разделяет живые письменные отзывы и чекбоксы замечаний)
  const renderFeedbackCell = (_, record) => {
    const cleanCommentsCnt = record.clean_comments_count ?? record.comments_count ?? 0
    const totalWrittenCnt = record.total_written_comments_count ?? record.comments_count ?? 0
    const flaggedCnt = record.flagged_comments_count || 0
    const commentsCnt = presentationMode ? cleanCommentsCnt : totalWrittenCnt
    const defectsCnt = record.defects_count || 0
    const recsCnt = record.recommendations_count || 0

    if (commentsCnt === 0 && defectsCnt === 0 && recsCnt === 0 && (presentationMode || flaggedCnt === 0)) {
      return <Text type="secondary" style={{ fontSize: 12 }}>Нет отзывов</Text>
    }

    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
        {commentsCnt > 0 && (
          <Tooltip title="Количество живых письменных отзывов, написанных студентами вручную в текстовом поле">
            <Tag color="blue" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}>
              💬 Отзывов: {commentsCnt}
            </Tag>
          </Tooltip>
        )}
        {!presentationMode && flaggedCnt > 0 && (
          <Tooltip title="Отзывы, задержанные умным фильтром ненормативной лексики и троллинга">
            <Tag color="red" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}>
              🔒 Скрыто: {flaggedCnt}
            </Tag>
          </Tooltip>
        )}
        {defectsCnt > 0 && (
          <Tooltip title="Количество отмеченных чекбоксов замечаний в вопросах №1–5 (частичное или полное несоответствие)">
            <Tag color="warning" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}>
              ⚠️ Замечаний: {defectsCnt}
            </Tag>
          </Tooltip>
        )}
        {recsCnt > 0 && (
          <Tooltip title="Методические поручения заведующего кафедрой">
            <Tag color="purple" style={{ margin: 0, fontSize: 11, cursor: 'pointer' }}>
              📋 Поручений: {recsCnt}
            </Tag>
          </Tooltip>
        )}
      </div>
    )
  }

  const teacherColumns = [
    {
      title: 'Преподаватель',
      dataIndex: 'teacher_name',
      key: 'teacher_name',
      render: (name, record) => (
        <div>
          <div
            style={{ fontWeight: 600, color: '#1a56db', cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              handleOpenTeacherModal(record.teacher_id)
            }}
            title="Открыть профиль качества, дисциплины и отзывы"
          >
            {name}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {record.position} &bull;{' '}
            <Tag
              color="blue"
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedDeptId(record.department_id)
              }}
              title="Фильтровать по этой кафедре"
            >
              {record.department_code}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: (
        <Tooltip title="Сумма баллов за 5 вопросов анкеты (максимум 1 балл за вопрос, итого максимум 5.0 баллов)">
          <span>Оценка (из 5.0)</span>
        </Tooltip>
      ),
      dataIndex: 'average_score',
      key: 'average_score',
      width: 145,
      align: 'center',
      render: (score, record) => {
        if (!record.responses_count) {
          return <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
        }
        return (
          <div>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
              {score} <span style={{ fontSize: 11, color: '#64748b' }}>/ 5.0</span>
            </span>
          </div>
        )
      },
    },
    {
      title: 'Удовлетворенность',
      dataIndex: 'satisfaction_rate',
      key: 'satisfaction_rate',
      width: 195,
      render: (rate, record) => {
        if (!record.responses_count) {
          return <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
        }
        const strokeColor = rate >= 80 ? '#15803d' : rate >= 65 ? '#1a56db' : '#d97706'
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: strokeColor }}>{rate}%</span>
            </div>
            <Progress percent={rate} showInfo={false} strokeColor={strokeColor} size="small" />
          </div>
        )
      },
    },
    {
      title: 'Заполнено анкет',
      dataIndex: 'responses_count',
      key: 'responses_count',
      width: 140,
      align: 'center',
      render: (cnt, record) => {
        if (dataSource === 'all') {
          return (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <Tag color="green" title="Реальные анкеты студентов">🎓 {record.student_responses_count || 0}</Tag>
              <Tag color="purple" title="Синтетические анкеты">🧪 {record.synthetic_responses_count || 0}</Tag>
            </div>
          )
        }
        return (
          <Tag color={dataSource === 'student' ? 'green' : 'purple'}>
            {dataSource === 'student' ? `🎓 ${cnt || 0} анкет` : `🧪 ${cnt || 0} анкет`}
          </Tag>
        )
      },
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status, record) => {
        if (!record.responses_count || status === 'no_data') {
          return <Tag color="default">Нет анкет</Tag>
        }
        if (status === 'excellent') {
          return <Tag color="success">Высокий рейтинг</Tag>
        }
        if (status === 'good') {
          return <Tag color="processing">В пределах нормы</Tag>
        }
        return <Tag color="warning">Требует внимания</Tag>
      },
    },
    {
      title: (
        <Tooltip title="Письменные отзывы студентов, отмеченные галочки замечаний и поручения заведующего кафедрой">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Отзывы и замечания <HelpCircle size={13} color="#64748b" />
          </span>
        </Tooltip>
      ),
      key: 'feedback',
      width: 210,
      align: 'center',
      render: renderFeedbackCell,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 165,
      align: 'right',
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          icon={<Eye size={14} />}
          onClick={(e) => {
            e.stopPropagation()
            handleOpenTeacherModal(record.teacher_id)
          }}
        >
          Радар и отзывы
        </Button>
      ),
    },
  ]

  const disciplineColumns = [
    {
      title: 'Дисциплина',
      dataIndex: 'discipline_name',
      key: 'discipline_name',
      render: (name, record) => (
        <div>
          <div
            style={{ fontWeight: 600, color: '#1a56db', cursor: 'pointer', fontSize: 14 }}
            onClick={(e) => {
              e.stopPropagation()
              handleOpenDisciplineModal(record)
            }}
          >
            {name}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Tag color="cyan" style={{ margin: 0 }}>{record.discipline_code}</Tag>
            <span>
              Преподаватели:{' '}
              <strong style={{ color: '#334155' }}>
                {(record.teachers || []).map((t) => t.teacher_name).join(', ') || '—'}
              </strong>
            </span>
            <span>&bull; Групп: <strong>{record.groups?.length || 0}</strong></span>
          </div>
        </div>
      ),
    },
    {
      title: (
        <Tooltip title="Средняя оценка дисциплины из 5.0 баллов (сумма по 5 блокам анкеты)">
          <span>Оценка (из 5.0)</span>
        </Tooltip>
      ),
      dataIndex: 'average_score',
      key: 'average_score',
      width: 145,
      align: 'center',
      render: (score, record) => {
        if (!record.responses_count) {
          return <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
        }
        return (
          <span style={{ fontWeight: 700, fontSize: 16, color: '#0f172a' }}>
            {score} <span style={{ fontSize: 11, color: '#64748b' }}>/ 5.0</span>
          </span>
        )
      },
    },
    {
      title: 'Удовлетворенность',
      dataIndex: 'satisfaction_rate',
      key: 'satisfaction_rate',
      width: 195,
      render: (rate, record) => {
        if (!record.responses_count) {
          return <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
        }
        const strokeColor = rate >= 80 ? '#15803d' : rate >= 65 ? '#1a56db' : '#d97706'
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ fontWeight: 600, color: strokeColor }}>{rate}%</span>
            </div>
            <Progress percent={rate} showInfo={false} strokeColor={strokeColor} size="small" />
          </div>
        )
      },
    },
    {
      title: 'Заполнено анкет',
      dataIndex: 'responses_count',
      key: 'responses_count',
      width: 140,
      align: 'center',
      render: (cnt, record) => {
        if (dataSource === 'all') {
          return (
            <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
              <Tag color="green" title="Реальные анкеты студентов">🎓 {record.student_responses_count || 0}</Tag>
              <Tag color="purple" title="Синтетические анкеты">🧪 {record.synthetic_responses_count || 0}</Tag>
            </div>
          )
        }
        return (
          <Tag color={dataSource === 'student' ? 'green' : 'purple'}>
            {dataSource === 'student' ? `🎓 ${cnt || 0} анкет` : `🧪 ${cnt || 0} анкет`}
          </Tag>
        )
      },
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (status, record) => {
        if (!record.responses_count || status === 'no_data') {
          return <Tag color="default">Нет анкет</Tag>
        }
        if (status === 'excellent') {
          return <Tag color="success">Высокий рейтинг</Tag>
        }
        if (status === 'good') {
          return <Tag color="processing">В пределах нормы</Tag>
        }
        return <Tag color="warning">Требует внимания</Tag>
      },
    },
    {
      title: (
        <Tooltip title="Отзывы и замечания студентов по данной дисциплине">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Отзывы и замечания <HelpCircle size={13} color="#64748b" />
          </span>
        </Tooltip>
      ),
      key: 'feedback',
      width: 210,
      align: 'center',
      render: renderFeedbackCell,
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 175,
      align: 'right',
      render: (_, record) => (
        <Button
          type="primary"
          size="small"
          icon={<Eye size={14} />}
          onClick={(e) => {
            e.stopPropagation()
            handleOpenDisciplineModal(record)
          }}
        >
          Детали предмета
        </Button>
      ),
    },
  ]

  const branchRate = branchKpi?.branch_satisfaction_rate || 0
  const branchAvgScore = branchKpi?.branch_average_score || 0
  const studentAnswersCount = branchKpi?.student_answers_count ?? 0
  const syntheticAnswersCount = branchKpi?.synthetic_answers_count ?? 0

  const managementMenuItems = [
    {
      key: 'clear-synth',
      label: (
        <Popconfirm
          title="Очистить синтетические данные?"
          description="Все тестовые записи из фикстур будут удалены. Реальные анкеты студентов останутся нетронутыми."
          onConfirm={handleClearSynthetic}
          okText="Очистить синтетику"
          cancelText="Отмена"
        >
          <div style={{ color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={14} />
            <span>Очистить синтетические данные ({syntheticAnswersCount} анкет)</span>
          </div>
        </Popconfirm>
      ),
    },
    {
      key: 'restore-synth',
      label: (
        <div
          onClick={handleRestoreSynthetic}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RotateCcw size={14} color="#1a56db" />
          <span>Восстановить синтетические данные из фикстур</span>
        </div>
      ),
    },
    {
      type: 'divider',
    },
    {
      key: 'clear-student',
      label: (
        <Popconfirm
          title="Сбросить ответы студентов?"
          description="Внимание! Это удалит реальные анкеты, присланные студентами. Используйте только для тестирования."
          onConfirm={handleClearStudent}
          okText="Сбросить"
          cancelText="Отмена"
          okButtonProps={{ danger: true }}
        >
          <div style={{ color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Trash2 size={14} />
            <span>Очистить ответы студентов ({studentAnswersCount} анкет)</span>
          </div>
        </Popconfirm>
      ),
    },
  ]

  return (
    <div style={{ padding: '4px 0 24px 0' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, color: '#0f172a' }}>
            Мониторинг качества образования
          </Title>
          <Paragraph style={{ margin: '4px 0 0 0', color: '#64748b' }}>
            Оценка по преподавателям и дисциплинам (5 вопросов анкеты, максимум 5.0 баллов)
          </Paragraph>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            icon={<ExternalLink size={16} />}
            onClick={() => navigate('/survey')}
            style={{ backgroundColor: '#15803d', borderColor: '#15803d' }}
          >
            Пройти опрос как студент
          </Button>

          <Dropdown menu={{ items: managementMenuItems }} trigger={['click']}>
            <Button icon={<Database size={16} />}>
              Управление данными <MoreVertical size={14} style={{ marginLeft: 4 }} />
            </Button>
          </Dropdown>

          <Button icon={<RefreshCw size={16} />} onClick={handleRefreshAll}>
            Обновить
          </Button>
        </div>
      </div>

      {/* Панель выбора источника данных + Формула расчёта */}
      <Card
        size="small"
        style={{
          borderRadius: 10,
          marginBottom: 16,
          border: '1px solid #cbd5e1',
          backgroundColor: '#f8fafc',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldCheck size={18} color="#15803d" />
            <div>
              <strong style={{ fontSize: 13, color: '#0f172a' }}>Шкала оценивания (макс. 5.0 за 5 вопросов):</strong>
              <span style={{ fontSize: 12, color: '#475569', marginLeft: 6 }}>
                🟢 Зелёный = <strong>1 балл</strong> &bull; 🟡 Жёлтый: 1 галочка = <strong>0.5</strong>, 2 галочки = <strong>0.25</strong>, 3+ галочек = <strong>0</strong> &bull; 🔴 Красный = <strong>0 баллов</strong>
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Tooltip title="В режиме презентации система автоматически скрывает нецензурную лексику, оскорбления и троллинг с главного экрана и проектора">
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 12px',
                  borderRadius: 8,
                  backgroundColor: presentationMode ? '#ecfdf5' : '#fef2f2',
                  border: `1px solid ${presentationMode ? '#6ee7b7' : '#fecaca'}`,
                }}
              >
                {presentationMode ? (
                  <ShieldCheck size={16} color="#059669" />
                ) : (
                  <EyeOff size={16} color="#dc2626" />
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: presentationMode ? '#065f46' : '#991b1b',
                  }}
                >
                  🛡️ Режим презентации (Анти-мат)
                </span>
                <Switch
                  size="small"
                  checked={presentationMode}
                  onChange={(checked) => setPresentationMode(checked)}
                />
              </div>
            </Tooltip>

            <Radio.Group
              value={dataSource}
              onChange={(e) => setDataSource(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="student">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <GraduationCap size={15} />
                  <span>Реальные анкеты студентов</span>
                  <Badge
                    count={studentAnswersCount}
                    style={{
                      backgroundColor: dataSource === 'student' ? '#ffffff' : '#15803d',
                      color: dataSource === 'student' ? '#15803d' : '#ffffff',
                    }}
                  />
                </span>
              </Radio.Button>

              <Radio.Button value="synthetic">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <FlaskConical size={15} />
                  <span>Синтетические данные</span>
                  <Badge
                    count={syntheticAnswersCount}
                    overflowCount={9999}
                    style={{
                      backgroundColor: dataSource === 'synthetic' ? '#ffffff' : '#7c3aed',
                      color: dataSource === 'synthetic' ? '#7c3aed' : '#ffffff',
                    }}
                  />
                </span>
              </Radio.Button>

              <Radio.Button value="all">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Database size={15} />
                  <span>Все данные</span>
                  <Badge
                    count={studentAnswersCount + syntheticAnswersCount}
                    overflowCount={9999}
                    style={{
                      backgroundColor: dataSource === 'all' ? '#ffffff' : '#475569',
                      color: dataSource === 'all' ? '#475569' : '#ffffff',
                    }}
                  />
                </span>
              </Radio.Button>
            </Radio.Group>
          </div>
        </div>
      </Card>

      {/* Информационная подсказка по текущему источнику */}
      {dataSource === 'student' && studentAnswersCount === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message="В базе пока нет реальных студенческих анкет"
          description={
            <div>
              В настоящее время еще никто из студентов не отправил форму обратной связи. Вы можете нажать кнопку{' '}
              <strong>«Пройти опрос как студент»</strong> выше и отправить анкету, либо переключиться на режим{' '}
              <strong>«Синтетические данные»</strong> для просмотра аналитики на демонстрационном массиве.
            </div>
          }
        />
      )}

      {dataSource === 'student' && studentAnswersCount > 0 && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message={`Отображаются реальные студенческие анкеты (заполнено анкет: ${studentAnswersCount})`}
          description="Все оценки рассчитаны по новой 5-балльной шкале (1 / 0.5 / 0.25 / 0 за каждый из 5 вопросов). Синтетическая выборка исключена."
        />
      )}

      {dataSource === 'synthetic' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message={`Режим синтетической выборки (анкет: ${syntheticAnswersCount})`}
          description="Вы просматриваете демонстрационный набор данных, пересчитанный по новой формуле (макс. 5.0 баллов за 5 вопросов). Реальные анкеты студентов хранятся отдельно."
        />
      )}

      {/* Верхнеуровневый Баннер KPI Филиала */}
      <Card
        style={{
          borderRadius: 12,
          marginBottom: 24,
          background:
            dataSource === 'student'
              ? 'linear-gradient(135deg, #065f46 0%, #059669 100%)'
              : dataSource === 'synthetic'
              ? 'linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)'
              : 'linear-gradient(135deg, #1e3a8a 0%, #1a56db 100%)',
          color: '#ffffff',
          boxShadow: '0 4px 20px -2px rgba(26, 86, 219, 0.25)',
          border: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 20,
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: '#e0e7ff',
                fontSize: 13,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              <Building2 size={16} />
              {branchKpi?.branch_title || 'Новотроицкий филиал НИТУ МИСИС'}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4, color: '#ffffff' }}>
              Индекс удовлетворенности обучением в филиале
            </div>
            <div style={{ color: '#e0e7ff', marginTop: 4, fontSize: 13 }}>
              Семестр: <strong>{branchKpi?.semester || '2026-1 (Осень)'}</strong> &bull;{' '}
              {dataSource === 'student'
                ? 'Реальные анкеты обучающихся'
                : dataSource === 'synthetic'
                ? 'Синтетический тестовый массив'
                : 'Сводный массив (студенты + синтетика)'}
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(8px)',
              padding: '14px 18px',
              borderRadius: 12,
              flexWrap: 'wrap',
              width: 'auto',
              maxWidth: '100%',
            }}
          >
            <div style={{ minWidth: 110 }}>
              <div style={{ fontSize: 12, color: '#e0e7ff' }}>Средняя оценка</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                {(branchKpi?.total_answers_count ?? 0) > 0 ? `${branchAvgScore} / 5.0` : '—'}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 16, minWidth: 110 }}>
              <div style={{ fontSize: 12, color: '#e0e7ff' }}>Удовлетворенность</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                {(branchKpi?.total_answers_count ?? 0) > 0 ? `${branchRate}%` : '—'}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: 16, minWidth: 130 }}>
              <div style={{ fontSize: 12, color: '#e0e7ff' }}>Анкет в выборке</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#ffffff' }}>
                {branchKpi?.total_answers_count ?? 0} анкет
              </div>
              <div style={{ fontSize: 11, color: '#e0e7ff' }}>
                Преподавателей: {branchKpi?.evaluated_teachers_count ?? 0} &bull; Дисциплин:{' '}
                {branchKpi?.evaluated_disciplines_count ?? 0}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Карточка таблиц: Переключатель "По преподавателям" / "По дисциплинам" */}
      <Card style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <Radio.Group
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
              buttonStyle="solid"
              size="large"
            >
              <Radio.Button value="teachers">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <Users size={16} />
                  <span>По преподавателям ({teachersQuality?.teachers?.length || 0})</span>
                </span>
              </Radio.Button>
              <Radio.Button value="disciplines">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  <BookOpen size={16} />
                  <span>По дисциплинам ({disciplinesQuality?.disciplines?.length || 0})</span>
                </span>
              </Radio.Button>
            </Radio.Group>
          </div>

          {/* Интерактивные кнопки/переключатели кафедр */}
          <Radio.Group
            value={selectedDeptId}
            onChange={(e) => setSelectedDeptId(e.target.value)}
            buttonStyle="solid"
          >
            <Radio.Button value={null}>Все кафедры филиала</Radio.Button>
            {(branchKpi?.departments || []).map((d) => (
              <Radio.Button key={d.department_id} value={d.department_id}>
                {d.department_code} {d.answers_count > 0 ? `(${d.average_score}/5.0)` : ''}
              </Radio.Button>
            ))}
          </Radio.Group>
        </div>

        {viewMode === 'teachers' ? (
          <Table
            dataSource={teachersQuality?.teachers || []}
            columns={teacherColumns}
            rowKey="teacher_id"
            loading={loadingTeachers || loadingKpi || isActionLoading}
            scroll={{ x: 920 }}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: 'Нет данных по преподавателям в выбранной выборке' }}
            onRow={(record) => ({
              onClick: () => handleOpenTeacherModal(record.teacher_id),
              style: { cursor: 'pointer' },
            })}
          />
        ) : (
          <Table
            dataSource={disciplinesQuality?.disciplines || []}
            columns={disciplineColumns}
            rowKey="discipline_id"
            loading={loadingDisciplines || loadingKpi || isActionLoading}
            scroll={{ x: 920 }}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: 'Нет данных по дисциплинам в выбранной выборке' }}
            onRow={(record) => ({
              onClick: () => handleOpenDisciplineModal(record),
              style: { cursor: 'pointer' },
            })}
          />
        )}
      </Card>

      {/* Модальное окно преподавателя */}
      <TeacherQualityModal
        visible={isModalOpen}
        onClose={handleCloseModal}
        radarData={teacherRadar}
        isLoading={loadingRadar}
        onRefresh={handleRefreshAll}
        presentationMode={presentationMode}
        onTogglePresentationMode={setPresentationMode}
      />

      {/* Модальное окно детальной оценки ДИСЦИПЛИНЫ */}
      <Modal
        open={isDisciplineModalOpen}
        onCancel={() => setIsDisciplineModalOpen(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setIsDisciplineModalOpen(false)}>
            Закрыть
          </Button>,
        ]}
        width={900}
        style={{ top: 20, maxWidth: 'calc(100vw - 16px)' }}
        title={
          selectedDiscipline ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <Award size={22} color="#1a56db" />
              <span style={{ fontSize: 16, fontWeight: 700 }}>
                Оценка качества дисциплины: {selectedDiscipline.discipline_name}
              </span>
            </div>
          ) : null
        }
      >
        {selectedDiscipline && (
          <div style={{ maxHeight: 'calc(84vh - 120px)', overflowY: 'auto', paddingRight: 6 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#f8fafc',
                padding: '14px 16px',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                marginBottom: 20,
                flexWrap: 'wrap',
                gap: 14,
              }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <Title level={4} style={{ margin: 0, color: '#0f172a', fontSize: 17 }}>
                  {selectedDiscipline.discipline_name}
                </Title>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  <Tag color="cyan" style={{ margin: 0 }}>{selectedDiscipline.discipline_code}</Tag>
                  <Tag color="green" style={{ margin: 0 }}>
                    🎓 Студенческих анкет: {selectedDiscipline.student_responses_count ?? 0}
                  </Tag>
                  <Tag color="purple" style={{ margin: 0 }}>
                    🧪 Синтетических анкет: {selectedDiscipline.synthetic_responses_count ?? 0}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 13 }}>
                    Всего анкет в выборке: <strong>{selectedDiscipline.responses_count || 0}</strong>
                  </Text>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Удовлетворенность</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#15803d' }}>
                    {selectedDiscipline.responses_count > 0 ? `${selectedDiscipline.satisfaction_rate}%` : '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Средняя оценка (из 5.0)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {selectedDiscipline.responses_count > 0 ? (
                      <>
                        <span style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
                          {selectedDiscipline.average_score} / 5.0
                        </span>
                        <Rate disabled allowHalf value={Number(selectedDiscipline.average_score)} style={{ fontSize: 14 }} />
                      </>
                    ) : (
                      <span style={{ color: '#94a3b8' }}>Нет анкет</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Tabs
              defaultActiveKey="blocks"
              items={[
                {
                  key: 'blocks',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={16} /> Оценка по 5 блокам анкеты
                    </span>
                  ),
                  children: (
                    <div>
                      <TeacherRadarChart
                        radarData={selectedDiscipline.responses_count > 0 ? selectedDiscipline.radar : null}
                        height={300}
                      />
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))',
                          gap: 12,
                          marginTop: 16,
                        }}
                      >
                        {(selectedDiscipline.radar || []).map((item) => (
                          <Card key={item.category} size="small" style={{ backgroundColor: '#fafbfc' }}>
                            <div style={{ fontSize: 11, color: '#64748b', height: 32, overflow: 'hidden' }}>
                              {item.label}
                            </div>
                            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a56db', marginTop: 4 }}>
                              {item.question_score} <span style={{ fontSize: 11, color: '#94a3b8' }}>/ 1.0 балл</span>
                            </div>
                            <div style={{ fontSize: 11, color: item.rate_pct >= 75 ? '#15803d' : '#d97706' }}>
                              {item.rate_pct}% ({item.score} / 5.0)
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'teachers_groups',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Building2 size={16} /> Преподаватели и группы ({selectedDiscipline.groups?.length || 0})
                    </span>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <Card size="small" title="Преподаватели дисциплины" style={{ backgroundColor: '#fafbfc' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                          {(selectedDiscipline.teachers || []).map((tea) => (
                            <div
                              key={tea.teacher_id}
                              onClick={() => {
                                setIsDisciplineModalOpen(false)
                                handleOpenTeacherModal(tea.teacher_id)
                              }}
                              style={{
                                border: '1px solid #cbd5e1',
                                borderRadius: 8,
                                padding: '10px 14px',
                                backgroundColor: '#ffffff',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ fontWeight: 600, color: '#1a56db' }}>{tea.teacher_name}</div>
                              <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                                Оценка: <strong>{tea.submissions_count > 0 ? `${tea.average_score} / 5.0 (${tea.satisfaction_rate}%)` : 'Нет анкет'}</strong>
                                {' '} &bull; Анкет: <strong>{tea.submissions_count || 0}</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>

                      <Card size="small" title="Учебные группы потока (без дублирования)" style={{ backgroundColor: '#fafbfc' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                          {(selectedDiscipline.groups || []).map((grp) => {
                            const hasGrpData = (grp.submissions_count || 0) > 0
                            return (
                              <div
                                key={grp.group_name}
                                style={{
                                  border: `1px solid ${hasGrpData ? '#86efac' : '#e2e8f0'}`,
                                  backgroundColor: hasGrpData ? '#f0fdf4' : '#f8fafc',
                                  borderRadius: 8,
                                  padding: '10px 14px',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <strong>{grp.group_name}</strong>
                                  <span style={{ fontWeight: 700, color: hasGrpData ? '#15803d' : '#94a3b8' }}>
                                    {hasGrpData ? `${grp.average_score} / 5.0 (${grp.satisfaction_rate}%)` : '—'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: '#64748b' }}>
                                  <span>Анкет: {grp.submissions_count || 0}</span>
                                  <Tag color={hasGrpData ? 'success' : 'default'} style={{ margin: 0, fontSize: 10 }}>
                                    {hasGrpData ? 'Оценено' : 'Нет анкет'}
                                  </Tag>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </Card>
                    </div>
                  ),
                },
                {
                  key: 'comments',
                  label: (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <MessageSquare size={16} /> Письменные отзывы (
                      {presentationMode
                        ? (selectedDiscipline.comments || []).filter((c) => !c.is_flagged).length
                        : (selectedDiscipline.comments || []).length}
                      ) и чекбоксы замечаний ({selectedDiscipline.defects_count || 0})
                    </span>
                  ),
                  children: (
                    <div>
                      <List
                        dataSource={
                          presentationMode
                            ? (selectedDiscipline.comments || []).filter((c) => !c.is_flagged)
                            : selectedDiscipline.comments || []
                        }
                        locale={{ emptyText: 'По данной дисциплине нет письменных отзывов (введённых вручную)' }}
                        renderItem={(item) => {
                          const isRevealed = Boolean(revealedDiscIds[item.id])
                          const textToShow =
                            item.is_flagged && !isRevealed ? item.masked_text || item.text : item.text
                          return (
                            <Card
                              size="small"
                              style={{
                                marginBottom: 10,
                                borderLeft: item.is_flagged
                                  ? '4px solid #dc2626'
                                  : item.is_synthetic
                                  ? '4px solid #9333ea'
                                  : '4px solid #16a34a',
                                backgroundColor: item.is_flagged ? '#fef2f2' : '#ffffff',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                                <Paragraph style={{ margin: 0, fontSize: 13, flex: 1, minWidth: 200 }}>
                                  «{textToShow}»
                                </Paragraph>
                                {item.is_flagged && (
                                  <Button
                                    size="small"
                                    icon={isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                                    onClick={() =>
                                      setRevealedDiscIds((prev) => ({
                                        ...prev,
                                        [item.id]: !prev[item.id],
                                      }))
                                    }
                                  >
                                    {isRevealed ? 'Скрыть под ***' : 'Показать текст'}
                                  </Button>
                                )}
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#64748b', flexWrap: 'wrap', gap: 6 }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <Tag color={item.is_synthetic ? 'purple' : 'green'} style={{ margin: 0, fontSize: 11 }}>
                                    {item.is_synthetic ? '🧪 Синтетика' : '🎓 Студент'}
                                  </Tag>
                                  <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>Преп.: {item.teacher_name}</Tag>
                                  <Tag color="default" style={{ margin: 0, fontSize: 11 }}>Гр. {item.group_name}</Tag>
                                  {item.is_flagged && (
                                    <Tag color="red" style={{ margin: 0, fontSize: 11 }}>
                                      🔒 Скрыт в режиме презентации ({item.flag_reason})
                                    </Tag>
                                  )}
                                </div>
                                <span>{item.date}</span>
                              </div>
                            </Card>
                          )
                        }}
                      />

                      {(selectedDiscipline.checkbox_remarks || []).length > 0 && (
                        <Card
                          size="small"
                          style={{ marginTop: 14, backgroundColor: '#fffbeb', borderColor: '#fde68a' }}
                          title={
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>
                              ⚠️ Отмеченные чекбоксы замечаний в вопросах №1–5 (почему оценка 0.5 / 0.25 / 0)
                            </span>
                          }
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {(selectedDiscipline.checkbox_remarks || []).map((rem, idx) => (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  padding: '8px 12px',
                                  backgroundColor: '#ffffff',
                                  borderRadius: 6,
                                  border: '1px solid #fde68a',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{rem.text}</div>
                                  <div style={{ fontSize: 11, color: '#64748b' }}>Блок анкеты: {rem.question_text}</div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                  {(rem.groups || []).map((g) => (
                                    <Tag key={g} style={{ margin: 0, fontSize: 11 }}>Гр. {g}</Tag>
                                  ))}
                                  <Tag color="warning" style={{ margin: 0, fontWeight: 700 }}>
                                    Отмечено: {rem.count} раз(а)
                                  </Tag>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Card>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
