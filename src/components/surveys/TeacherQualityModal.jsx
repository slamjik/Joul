import React, { useState } from 'react'
import { Modal, Tag, Rate, Typography, Tabs, Card, List, Button, Input, Select, Switch, message, Spin, Alert, Form } from 'antd'
import {
  Award,
  MessageSquare,
  Sparkles,
  UserCheck,
  Building2,
  Calendar,
  PlusCircle,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  EyeOff,
  Eye,
} from 'lucide-react'
import { TeacherRadarChart } from '../charts/TeacherRadarChart'
import { createTeacherRecommendation, updateTeacherRecommendation, moderateSurveyComment } from '../../api/surveys'
import { useAuthStore } from '../../store/authStore'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

export function TeacherQualityModal({
  visible,
  onClose,
  radarData,
  isLoading,
  onRefresh,
  presentationMode = true,
  onTogglePresentationMode,
}) {
  const { user } = useAuthStore()
  const isHeadOrAdmin = !user || user?.role === 'head' || user?.role === 'admin' || Boolean(user?.is_head)
  const [form] = Form.useForm()
  const [isSubmittingRec, setIsSubmittingRec] = useState(false)
  const [showAddRecForm, setShowAddRecForm] = useState(false)
  const [localSafeMode, setLocalSafeMode] = useState(true)
  const [showFlaggedSpoiler, setShowFlaggedSpoiler] = useState(false)
  const [revealedIds, setRevealedIds] = useState({})

  const isSafeMode = onTogglePresentationMode ? presentationMode : localSafeMode
  const handleSafeModeChange = (checked) => {
    if (onTogglePresentationMode) onTogglePresentationMode(checked)
    else setLocalSafeMode(checked)
    if (checked) setShowFlaggedSpoiler(false)
  }

  const handleModerateComment = async (commentId, status) => {
    try {
      await moderateSurveyComment(commentId, status)
      message.success(
        status === 'approved'
          ? 'Отзыв одобрен для показа на экране'
          : status === 'hidden'
          ? 'Отзыв скрыт с главного экрана'
          : 'Возвращён автоматический фильтр'
      )
      if (onRefresh) onRefresh()
    } catch {
      message.error('Не удалось изменить статус модерации отзыва')
    }
  }

  if (!radarData && isLoading) {
    return (
      <Modal open={visible} onCancel={onClose} footer={null} width={800}>
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: '#64748b' }}>Загрузка профиля качества и оценок...</div>
        </div>
      </Modal>
    )
  }

  if (!radarData) {
    return null
  }

  const handleAddRecommendation = async (values) => {
    setIsSubmittingRec(true)
    try {
      await createTeacherRecommendation({
        teacher: radarData.teacher_id,
        category: values.category || '',
        recommendation_text: values.recommendation_text,
        semester: '2024-1',
        source: 'head',
        status: 'published',
      })
      message.success('Рекомендация успешно добавлена и направлена преподавателю')
      form.resetFields()
      setShowAddRecForm(false)
      if (onRefresh) onRefresh()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Не удалось сохранить рекомендацию')
    } finally {
      setIsSubmittingRec(false)
    }
  }

  const handleMarkReviewed = async (recId) => {
    try {
      await updateTeacherRecommendation(recId, { status: 'reviewed' })
      message.success('Статус рекомендации обновлен (принята к сведению)')
      if (onRefresh) onRefresh()
    } catch (err) {
      message.error('Не удалось обновить статус')
    }
  }

  const hasResponses = (radarData.total_responses || 0) > 0
  const overallRate = hasResponses ? (radarData.overall_rate ?? 0) : null
  const rateColor = overallRate >= 80 ? '#15803d' : overallRate >= 70 ? '#1a56db' : '#d97706'

  return (
    <Modal
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" type="primary" onClick={onClose}>
          Закрыть
        </Button>,
      ]}
      width={900}
      style={{ top: 16, maxWidth: 'calc(100vw - 16px)', margin: '0 auto' }}
      styles={{
        body: {
          maxHeight: 'calc(86vh - 120px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Award size={22} color="#1a56db" />
          <span style={{ fontSize: 16, fontWeight: 700 }}>Профиль качества: {radarData.teacher_name}</span>
        </div>
      }
    >
      <div style={{ maxHeight: 'calc(86vh - 130px)', overflowY: 'auto', paddingRight: 6 }}>
        {/* Header Info */}
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
        <div style={{ minWidth: 200, flex: 1 }}>
          <Title level={4} style={{ margin: 0, color: '#0f172a', fontSize: 17, wordBreak: 'normal', overflowWrap: 'break-word' }}>
            {radarData.teacher_name}
          </Title>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <Tag color="blue" style={{ margin: 0 }}>{radarData.position || 'Преподаватель'}</Tag>
            <Tag color="cyan" style={{ margin: 0 }}>
              <Building2 size={12} style={{ marginRight: 4 }} />
              {radarData.department_code}
            </Tag>
            <Tag color="green" style={{ margin: 0 }} title="Реальные анкеты, заполненные студентами">
              🎓 Студентов: {radarData.student_responses_count ?? 0}
            </Tag>
            <Tag color="purple" style={{ margin: 0 }} title="Синтетические тестовые данные">
              🧪 Синтетических: {radarData.synthetic_responses_count ?? 0}
            </Tag>
            <Text type="secondary" style={{ fontSize: 13, marginLeft: 4 }}>
              В текущей выборке: <strong>{radarData.total_responses || 0}</strong>
            </Text>
          </div>
        </div>

        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Индекс удовлетворенности</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: hasResponses ? rateColor : '#94a3b8' }}>
              {hasResponses ? `${overallRate}%` : '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Средняя оценка</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {hasResponses ? (
                <>
                  <span style={{ fontSize: 18, fontWeight: 600 }}>{radarData.overall_score}</span>
                  <Rate disabled allowHalf value={Number(radarData.overall_score)} style={{ fontSize: 14 }} />
                </>
              ) : (
                <span style={{ color: '#94a3b8', fontSize: 14 }}>Нет анкет</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <Tabs
        defaultActiveKey="radar"
        items={[
          {
            key: 'radar',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} /> Лепестковая диаграмма компетенций
              </span>
            ),
            children: (
              <div>
                {!hasResponses && (
                  <Alert
                    type="info"
                    showIcon
                    message="Анкеты студентов пока не поступили"
                    description="По данному преподавателю пока нет оценок от студентов. После прохождения опроса студентами лепестковая диаграмма компетенций и индекс качества сформируются автоматически в реальном времени."
                    style={{ marginBottom: 16 }}
                  />
                )}
                <TeacherRadarChart radarData={hasResponses ? radarData.radar : null} height={320} />

                {/* Таблица показателей по 5 блокам (макс. 1.0 балл за каждый блок, сумма = 5.0) */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                    gap: 12,
                    marginTop: 16,
                  }}
                >
                  {(radarData.radar || []).map((item) => {
                    const qScore =
                      item.question_score !== undefined
                        ? item.question_score
                        : Math.round(((item.score || 0) / 5) * 100) / 100
                    return (
                      <Card key={item.category} size="small" style={{ backgroundColor: '#fafbfc' }}>
                        <div style={{ fontSize: 11, color: '#64748b', height: 32, overflow: 'hidden' }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1a56db', marginTop: 4 }}>
                          {qScore} <span style={{ fontSize: 11, color: '#94a3b8' }}>/ 1.0 балл</span>
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: item.rate_pct >= 75 ? '#15803d' : '#d97706',
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: 2,
                          }}
                        >
                          <span>{item.rate_pct}% станд.</span>
                          <span style={{ color: '#64748b' }}>({item.score}/5.0)</span>
                        </div>
                      </Card>
                    )
                  })}
                </div>
              </div>
            ),
          },
          {
            key: 'disciplines',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Building2 size={16} /> Дисциплины и группы ({radarData.disciplines?.length || 0})
              </span>
            ),
            children: (
              <div>
                {(radarData.disciplines || []).length === 0 ? (
                  <Card size="small" style={{ textAlign: 'center', color: '#64748b', padding: '24px 0' }}>
                    Нет данных по дисциплинам за текущий семестр
                  </Card>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {(radarData.disciplines || []).map((disc, idx) => {
                      const hasDiscData = (disc.groups || []).some((g) => (g.submissions_count || g.responses_count || 0) > 0)
                      const discScore =
                        disc.average_score !== undefined
                          ? disc.average_score
                          : Math.round(((disc.average_satisfaction || 0) / 20) * 100) / 100
                      return (
                        <Card
                          key={disc.discipline_id || idx}
                          size="small"
                          style={{
                            borderRadius: 10,
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#fafbfc',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: 12,
                              paddingBottom: 8,
                              borderBottom: '1px solid #e2e8f0',
                              flexWrap: 'wrap',
                              gap: 8,
                            }}
                          >
                            <div>
                              <Text strong style={{ fontSize: 15, color: '#0f172a' }}>
                                {disc.discipline_name}
                              </Text>
                              <span style={{ marginLeft: 8, fontSize: 12, color: '#64748b' }}>
                                ({disc.groups?.length || 0} групп на потоке)
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 12, color: '#64748b' }}>Оценка дисциплины:</span>
                              {hasDiscData ? (
                                <>
                                  <Tag color="blue" style={{ fontWeight: 700, fontSize: 13, margin: 0 }}>
                                    {discScore} / 5.0
                                  </Tag>
                                  <Tag
                                    color={
                                      disc.average_satisfaction >= 80
                                        ? 'success'
                                        : disc.average_satisfaction >= 65
                                        ? 'processing'
                                        : 'warning'
                                    }
                                    style={{ fontWeight: 600, fontSize: 13, padding: '2px 8px', margin: 0 }}
                                  >
                                    {disc.average_satisfaction}%
                                  </Tag>
                                </>
                              ) : (
                                <Tag color="default" style={{ fontSize: 12 }}>
                                  Нет анкет
                                </Tag>
                              )}
                            </div>
                          </div>

                          {/* Таблица групп внутри дисциплины (строго без дублей по названию группы) */}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                              gap: 12,
                            }}
                          >
                            {(disc.groups || []).map((grp) => {
                              const formsCount = grp.submissions_count ?? grp.responses_count ?? 0
                              const hasGrpData = formsCount > 0
                              const grpScore =
                                grp.average_score !== undefined
                                  ? grp.average_score
                                  : Math.round(((grp.satisfaction_rate || 0) / 20) * 100) / 100
                              const isAttention = hasGrpData && (grp.status === 'attention' || grp.satisfaction_rate < 65)
                              const isGood =
                                hasGrpData &&
                                (grp.status === 'good' || (grp.satisfaction_rate >= 65 && grp.satisfaction_rate < 80))

                              const borderColor = !hasGrpData
                                ? '#e2e8f0'
                                : isAttention
                                ? '#fca5a5'
                                : isGood
                                ? '#93c5fd'
                                : '#86efac'
                              const bgCard = !hasGrpData
                                ? '#f8fafc'
                                : isAttention
                                ? '#fff1f2'
                                : isGood
                                ? '#f0f9ff'
                                : '#f0fdf4'
                              const textColor = !hasGrpData
                                ? '#94a3b8'
                                : isAttention
                                ? '#b91c1c'
                                : isGood
                                ? '#1d4ed8'
                                : '#15803d'

                              return (
                                <div
                                  key={`${disc.discipline_id}_${grp.group_name}`}
                                  style={{
                                    border: `1px solid ${borderColor}`,
                                    backgroundColor: bgCard,
                                    borderRadius: 8,
                                    padding: '10px 14px',
                                  }}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <strong style={{ fontSize: 14, color: '#0f172a' }}>{grp.group_name}</strong>
                                    <span style={{ fontWeight: 700, fontSize: 14, color: textColor }}>
                                      {hasGrpData ? `${grpScore} / 5.0 (${grp.satisfaction_rate}%)` : '—'}
                                    </span>
                                  </div>
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      marginTop: 6,
                                      fontSize: 12,
                                      color: '#64748b',
                                    }}
                                  >
                                    <span>{hasGrpData ? `Анкет: ${formsCount}` : 'Анкет: 0'}</span>
                                    {!hasGrpData ? (
                                      <Tag color="default" style={{ fontSize: 10, margin: 0 }}>
                                        Нет анкет
                                      </Tag>
                                    ) : isAttention ? (
                                      <Tag color="error" style={{ fontSize: 10, margin: 0 }}>
                                        Внимание
                                      </Tag>
                                    ) : isGood ? (
                                      <Tag color="blue" style={{ fontSize: 10, margin: 0 }}>
                                        В норме
                                      </Tag>
                                    ) : (
                                      <Tag color="success" style={{ fontSize: 10, margin: 0 }}>
                                        Высокий
                                      </Tag>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'comments',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MessageSquare size={16} /> Письменные отзывы (
                {isSafeMode
                  ? (radarData.comments || []).filter((c) => !c.is_flagged).length
                  : (radarData.comments || []).length}
                ) и замечания ({radarData.defects_count || 0})
              </span>
            ),
            children: (() => {
              const allWritten = radarData.comments || []
              const cleanWritten = allWritten.filter((c) => !c.is_flagged)
              const flaggedWritten = allWritten.filter((c) => c.is_flagged)
              const displayedWritten = isSafeMode ? cleanWritten : allWritten
              const checkboxRemarks = radarData.checkbox_remarks || []

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Панель управления безопасным показом (Режим презентации + Анти-мат) */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 10,
                      padding: '10px 14px',
                      borderRadius: 8,
                      backgroundColor: isSafeMode ? '#f0fdf4' : '#fffbeb',
                      border: `1px solid ${isSafeMode ? '#bbf7d0' : '#fde68a'}`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ShieldCheck size={18} color={isSafeMode ? '#15803d' : '#d97706'} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                          {isSafeMode
                            ? 'Режим презентации включён (Анти-мат и фильтр троллинга активны)'
                            : 'Режим модерации (отображаются все комментарии, включая скрытые)'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          В список отзывов попадают только живые комментарии, написанные руками. Выбранные галочки вынесены отдельно ниже.
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 12, fontWeight: 600 }}>Режим презентации:</Text>
                      <Switch checked={isSafeMode} onChange={handleSafeModeChange} size="small" />
                    </div>
                  </div>

                  {/* Раздел 1: Живые письменные отзывы студентов */}
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                        flexWrap: 'wrap',
                        gap: 8,
                      }}
                    >
                      <Text strong style={{ fontSize: 14, color: '#0f172a' }}>
                        💬 Живые письменные отзывы студентов ({displayedWritten.length})
                      </Text>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {!isSafeMode && flaggedWritten.length > 0 && (() => {
                          const allFlaggedRevealed = flaggedWritten.every((f) => revealedIds[f.id])
                          return (
                            <Button
                              size="small"
                              icon={allFlaggedRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                              onClick={() => {
                                const nextState = !allFlaggedRevealed
                                const patch = {}
                                flaggedWritten.forEach((f) => {
                                  patch[f.id] = nextState
                                })
                                setRevealedIds((prev) => ({ ...prev, ...patch }))
                              }}
                            >
                              {allFlaggedRevealed
                                ? 'Скрыть все звёздочками (***)'
                                : `Показать полный текст скрытых (${flaggedWritten.length})`}
                            </Button>
                          )
                        })()}

                        {flaggedWritten.length > 0 && isSafeMode && (
                          <Button
                            size="small"
                            type="dashed"
                            danger={showFlaggedSpoiler}
                            icon={showFlaggedSpoiler ? <EyeOff size={13} /> : <Eye size={13} />}
                            onClick={() => setShowFlaggedSpoiler(!showFlaggedSpoiler)}
                          >
                            {showFlaggedSpoiler
                              ? 'Свернуть заблокированные отзывы'
                              : `🔒 Заблокировано фильтром: ${flaggedWritten.length} (открыть)`}
                          </Button>
                        )}
                      </div>
                    </div>

                    <List
                      dataSource={displayedWritten}
                      locale={{
                        emptyText:
                          'Письменных текстовых отзывов (написанных от руки) по данному преподавателю пока нет',
                      }}
                      renderItem={(item) => {
                        const isSynth = item.source === 'synthetic' || item.is_synthetic
                        const isFlagged = Boolean(item.is_flagged)
                        const isRevealed = Boolean(revealedIds[item.id])
                        const textToShow =
                          isFlagged && !isRevealed ? item.masked_text || item.text : item.text

                        return (
                          <Card
                            size="small"
                            style={{
                              marginBottom: 10,
                              borderLeft: isFlagged
                                ? '4px solid #ef4444'
                                : isSynth
                                ? '4px solid #9333ea'
                                : '4px solid #16a34a',
                              backgroundColor: isFlagged ? '#fff1f2' : '#fcfcfd',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                gap: 10,
                                flexWrap: 'wrap',
                              }}
                            >
                              <Paragraph style={{ margin: 0, fontSize: 13, color: '#1e293b', flex: 1, minWidth: 200 }}>
                                «{textToShow}»
                              </Paragraph>

                              {isFlagged && (
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <Button
                                    size="small"
                                    icon={isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                                    onClick={() =>
                                      setRevealedIds((prev) => ({
                                        ...prev,
                                        [item.id]: !prev[item.id],
                                      }))
                                    }
                                  >
                                    {isRevealed ? 'Скрыть под ***' : 'Показать текст'}
                                  </Button>
                                  <Button
                                    size="small"
                                    type="primary"
                                    ghost
                                    onClick={() => handleModerateComment(item.id, 'approved')}
                                  >
                                    Разрешить показ
                                  </Button>
                                </div>
                              )}
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginTop: 8,
                                fontSize: 11,
                                color: '#94a3b8',
                                flexWrap: 'wrap',
                                gap: 6,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                {isSynth ? (
                                  <Tag color="purple" style={{ fontSize: 11, margin: 0 }}>
                                    🧪 Синтетический образец
                                  </Tag>
                                ) : (
                                  <Tag color="green" style={{ fontSize: 11, margin: 0 }}>
                                    🎓 Письменный отзыв студента
                                  </Tag>
                                )}
                                {item.discipline_name && (
                                  <Tag color="blue" style={{ fontSize: 11, margin: 0 }}>
                                    📚 {item.discipline_name}
                                  </Tag>
                                )}
                                {item.group_name && (
                                  <Tag color="default" style={{ fontSize: 11, margin: 0 }}>
                                    Гр. {item.group_name}
                                  </Tag>
                                )}
                                {isFlagged && (
                                  <Tag color="error" style={{ fontSize: 11, margin: 0 }}>
                                    🔒 {item.flag_reason || 'Скрыто автомодерацией'}
                                  </Tag>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {!isFlagged && (
                                  <Button
                                    size="small"
                                    type="link"
                                    danger
                                    style={{ padding: 0, fontSize: 11 }}
                                    onClick={() => handleModerateComment(item.id, 'hidden')}
                                  >
                                    Скрыть с экрана
                                  </Button>
                                )}
                                <span>{item.date}</span>
                              </div>
                            </div>
                          </Card>
                        )
                      }}
                    />

                    {/* Спойлер со скрытыми автомодерацией отзывами (если включён режим презентации, но нажали кнопку просмотра) */}
                    {isSafeMode && showFlaggedSpoiler && flaggedWritten.length > 0 && (
                      <Card
                        size="small"
                        title={
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <span style={{ fontSize: 12, color: '#b91c1c' }}>
                              🔒 Заблокированные умным фильтром комментарии ({flaggedWritten.length}) — не показываются на презентации
                            </span>
                            {(() => {
                              const allRevealed = flaggedWritten.every((f) => revealedIds[f.id])
                              return (
                                <Button
                                  size="small"
                                  icon={allRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                                  onClick={() => {
                                    const nextState = !allRevealed
                                    const patch = {}
                                    flaggedWritten.forEach((f) => {
                                      patch[f.id] = nextState
                                    })
                                    setRevealedIds((prev) => ({ ...prev, ...patch }))
                                  }}
                                >
                                  {allRevealed ? 'Скрыть все под ***' : 'Показать текст всех'}
                                </Button>
                              )
                            })()}
                          </div>
                        }
                        style={{ marginTop: 10, borderColor: '#fecaca', backgroundColor: '#fff1f2' }}
                      >
                        <List
                          dataSource={flaggedWritten}
                          renderItem={(item) => {
                            const isRevealed = Boolean(revealedIds[item.id])
                            return (
                              <div
                                style={{
                                  padding: '10px 0',
                                  borderBottom: '1px solid #ffe4e6',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 10,
                                }}
                              >
                                <div style={{ flex: 1, minWidth: 200 }}>
                                  <div style={{ fontSize: 13, color: '#881337', fontWeight: isRevealed ? 600 : 400 }}>
                                    «{isRevealed ? item.text : item.masked_text || item.text}»
                                  </div>
                                  <div style={{ fontSize: 11, color: '#9f1239', marginTop: 4 }}>
                                    Причина: <strong>{item.flag_reason}</strong> &bull; Гр. {item.group_name || '—'} &bull;{' '}
                                    {item.discipline_name || '—'}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <Button
                                    size="small"
                                    icon={isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                                    onClick={() =>
                                      setRevealedIds((prev) => ({
                                        ...prev,
                                        [item.id]: !prev[item.id],
                                      }))
                                    }
                                  >
                                    {isRevealed ? 'Скрыть под ***' : 'Показать текст'}
                                  </Button>
                                  <Button
                                    size="small"
                                    type="primary"
                                    ghost
                                    onClick={() => handleModerateComment(item.id, 'approved')}
                                  >
                                    Разрешить показ
                                  </Button>
                                </div>
                              </div>
                            )
                          }}
                        />
                      </Card>
                    )}
                  </div>

                  {/* Раздел 2: Сводка отмеченных галочек-замечаний по чекбоксам из вопросов №1-5 */}
                  <div>
                    <Text strong style={{ fontSize: 14, color: '#0f172a', display: 'block', marginBottom: 8 }}>
                      ⚠️ Отмеченные чекбоксы замечаний в вопросах №1–5 (всего ответов с замечаниями: {radarData.defects_count || 0})
                    </Text>
                    {checkboxRemarks.length === 0 ? (
                      <Card size="small" style={{ color: '#64748b', textAlign: 'center' }}>
                        По оценочным блокам №1–5 замечаний (чекбоксов) не отмечено
                      </Card>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {checkboxRemarks.map((rem, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              padding: '10px 14px',
                              borderRadius: 8,
                              backgroundColor: '#fffbeb',
                              border: '1px solid #fde68a',
                              gap: 12,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 220 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
                                {rem.text}
                              </div>
                              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {(rem.disciplines || []).map((dName) => (
                                  <Tag key={dName} color="blue" style={{ margin: 0, fontSize: 10 }}>
                                    📚 {dName}
                                  </Tag>
                                ))}
                                {(rem.groups || []).map((gName) => (
                                  <Tag key={gName} color="default" style={{ margin: 0, fontSize: 10 }}>
                                    Гр. {gName}
                                  </Tag>
                                ))}
                              </div>
                            </div>
                            <Tag color="warning" style={{ margin: 0, fontWeight: 700, fontSize: 12, padding: '2px 10px' }}>
                              Отмечено: {rem.count} {rem.count === 1 ? 'раз' : rem.count < 5 ? 'раза' : 'раз'}
                            </Tag>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })(),
          },
          {
            key: 'recommendations',
            label: (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <UserCheck size={16} /> Рекомендации и решения ({radarData.recommendations?.length || 0})
              </span>
            ),
            children: (
              <div>
                {isHeadOrAdmin && (
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      type="dashed"
                      icon={<PlusCircle size={16} />}
                      onClick={() => setShowAddRecForm(!showAddRecForm)}
                    >
                      {showAddRecForm ? 'Отмена' : 'Вынести рекомендацию кафедры'}
                    </Button>
                  </div>
                )}

                {showAddRecForm && (
                  <Card
                    title="Новая рекомендация преподавателю"
                    size="small"
                    style={{ marginBottom: 16, backgroundColor: '#f8fafc', borderColor: '#cbd5e1' }}
                  >
                    <Form form={form} layout="vertical" onFinish={handleAddRecommendation}>
                      <Form.Item name="category" label="Критерий / Направление">
                        <Select
                          placeholder="Выберите компетенцию (необязательно)"
                          allowClear
                          options={[
                            { value: 'clarity', label: 'Понятность и структурированность' },
                            { value: 'fairness', label: 'Объективность оценивания' },
                            { value: 'relevance', label: 'Практическая ценность' },
                            { value: 'ethics', label: 'Педагогический такт и этика' },
                            { value: 'facilities', label: 'Условия и организация' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item
                        name="recommendation_text"
                        label="Текст методической рекомендации или указания"
                        rules={[{ required: true, message: 'Пожалуйста, введите текст рекомендации' }]}
                      >
                        <TextArea rows={3} placeholder="Введите конкретные указания по корректировке учебного процесса..." />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" loading={isSubmittingRec}>
                        Направить преподавателю
                      </Button>
                    </Form>
                  </Card>
                )}

                <List
                  dataSource={radarData.recommendations || []}
                  locale={{ emptyText: 'Рекомендации отсутствуют — показатели в пределах нормы' }}
                  renderItem={(item) => (
                    <Card
                      size="small"
                      style={{
                        marginBottom: 12,
                        borderLeft: item.source === 'auto' ? '4px solid #3b82f6' : '4px solid #8b5cf6',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <Tag color={item.source === 'auto' ? 'blue' : 'purple'}>
                            {item.source_label || (item.source === 'auto' ? 'Алгоритм KafIS' : 'Зав. кафедрой')}
                          </Tag>
                          {item.category_label && <Tag color="default">{item.category_label}</Tag>}
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {item.created_at}
                        </Text>
                      </div>

                      <Paragraph style={{ margin: '8px 0', fontSize: 13, color: '#334155' }}>
                        {item.text}
                      </Paragraph>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        {item.status !== 'reviewed' ? (
                          <Button
                            size="small"
                            type="text"
                            icon={<CheckCircle2 size={14} color="#15803d" />}
                            onClick={() => handleMarkReviewed(item.id)}
                          >
                            Принять к сведению
                          </Button>
                        ) : (
                          <Tag color="success">Принята к сведению</Tag>
                        )}
                      </div>
                    </Card>
                  )}
                />
              </div>
            ),
          },
        ]}
      />
      </div>
    </Modal>
  )
}
