import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  Typography,
  Button,
  Tag,
  Table,
  Input,
  Select,
  Modal,
  Form,
  Switch,
  Progress,
  Radio,
  Popconfirm,
  Tooltip,
  Alert,
  message,
} from 'antd'
import {
  UserPlus,
  Shield,
  Users,
  KeyRound,
  Trash2,
  Edit3,
  HardDrive,
  Cpu,
  Wifi,
  RefreshCw,
  DatabaseBackup,
  Sparkles,
  Copy,
  CheckCircle2,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getSystemStatus,
  createManualBackup,
  triggerSystemCleanup,
} from '../api/users'
import { useAuthStore } from '../store/authStore'

const { Title, Text, Paragraph } = Typography

const DEPARTMENTS = [
  { id: 15, code: 'ГиСЭН', name: 'Кафедра гуманитарных и социально-экономических наук' },
  { id: 12, code: 'МТиО', name: 'Кафедра металлургических технологий и оборудования' },
  { id: 13, code: 'МиЕ', name: 'Кафедра математики и естествознания' },
  { id: 14, code: 'ЭиЭ', name: 'Кафедра электроэнергетики и электротехники' },
]

export function UsersPage() {
  const { user: currentUser } = useAuthStore()
  const [roleFilter, setRoleFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [showPasswords, setShowPasswords] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sysActionLoading, setSysActionLoading] = useState(false)

  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()

  // 1. Загрузка пользователей
  const {
    data: usersList = [],
    isLoading: loadingUsers,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['system-users', roleFilter, searchQuery],
    queryFn: () => getUsers({ role: roleFilter || undefined, search: searchQuery || undefined }),
  })

  // 2. Загрузка статуса сервера, памяти (50 ГБ квота) и локальной сети
  const {
    data: sysStatus,
    isLoading: loadingStatus,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['system-status'],
    queryFn: () => getSystemStatus(),
    refetchInterval: 30000,
  })

  const handleCreateUser = async (values) => {
    setIsSubmitting(true)
    try {
      const res = await createUser(values)
      message.success(`Пользователь «${res.username}» успешно создан`)
      setIsCreateModalOpen(false)
      createForm.resetFields()
      refetchUsers()
      refetchStatus()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Ошибка при создании пользователя')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleOpenEdit = (record) => {
    setEditingUser(record)
    editForm.setFieldsValue({
      first_name: record.first_name,
      last_name: record.last_name,
      email: record.email,
      role: record.role,
      position: record.position,
      department: record.department_id || 15,
      is_active: record.is_active !== false,
      password: '',
    })
  }

  const handleUpdateUser = async (values) => {
    if (!editingUser) return
    setIsSubmitting(true)
    try {
      const payload = { ...values }
      if (!payload.password) delete payload.password
      await updateUser(editingUser.id, payload)
      message.success(`Права и профиль «${editingUser.username}» обновлены`)
      setEditingUser(null)
      editForm.resetFields()
      refetchUsers()
      refetchStatus()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Не удалось обновить пользователя')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleQuickRoleChange = async (userId, newRole) => {
    try {
      await updateUser(userId, { role: newRole })
      message.success('Роль пользователя успешно изменена')
      refetchUsers()
      refetchStatus()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Ошибка смены роли')
    }
  }

  const handleToggleActive = async (userId, checked) => {
    try {
      await updateUser(userId, { is_active: checked })
      message.success(checked ? 'Учетная запись активирована' : 'Учетная запись отключена')
      refetchUsers()
    } catch (err) {
      message.error('Не удалось изменить статус активности')
    }
  }

  const handleDeleteUser = async (userId) => {
    try {
      await deleteUser(userId)
      message.success('Пользователь удален')
      refetchUsers()
      refetchStatus()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Не удалось удалить пользователя')
    }
  }

  const handleBackup = async () => {
    setSysActionLoading(true)
    try {
      const res = await createManualBackup()
      message.success(res.message || 'Резервная копия создана')
      refetchStatus()
    } catch {
      message.error('Ошибка создания резервной копии')
    } finally {
      setSysActionLoading(false)
    }
  }

  const handleCleanup = async () => {
    setSysActionLoading(true)
    try {
      const res = await triggerSystemCleanup()
      message.success(res.message || 'Оптимизация памяти завершена')
      refetchStatus()
    } catch {
      message.error('Ошибка при очистке памяти')
    } finally {
      setSysActionLoading(false)
    }
  }

  const copyToClipboard = (text) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
      message.success(`Скопировано: ${text}`)
    }
  }

  const columns = [
    {
      title: 'Пользователь / ФИО',
      dataIndex: 'full_name',
      key: 'full_name',
      render: (name, record) => (
        <div>
          <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 14 }}>{name}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {record.position} &bull; <Tag color="cyan" style={{ margin: 0 }}>{record.department_code}</Tag>
          </div>
        </div>
      ),
    },
    {
      title: 'Логин и Пароль',
      dataIndex: 'username',
      key: 'credentials',
      width: 220,
      render: (uname, record) => (
        <div style={{ fontSize: 13 }}>
          <div>
            <Text type="secondary">Логин:</Text>{' '}
            <code
              style={{
                backgroundColor: '#f1f5f9',
                padding: '2px 6px',
                borderRadius: 4,
                fontWeight: 600,
                color: '#1e293b',
              }}
            >
              {uname}
            </code>
          </div>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">Пароль:</Text>{' '}
            <code
              style={{
                backgroundColor: '#f8fafc',
                padding: '2px 6px',
                borderRadius: 4,
                color: showPasswords ? '#15803d' : '#94a3b8',
              }}
            >
              {showPasswords ? record.password_hint : '••••••••'}
            </code>
          </div>
        </div>
      ),
    },
    {
      title: 'Роль и Права доступа',
      dataIndex: 'role',
      key: 'role',
      width: 230,
      render: (role, record) => (
        <Select
          size="small"
          value={role}
          style={{ width: 200 }}
          onChange={(val) => handleQuickRoleChange(record.id, val)}
          disabled={record.username === 'admin' && currentUser?.username !== 'admin'}
          options={[
            {
              value: 'admin',
              label: (
                <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                  🛡️ Администратор (полные права)
                </span>
              ),
            },
            {
              value: 'head',
              label: (
                <span style={{ color: '#1a56db', fontWeight: 600 }}>
                  🎓 Зав. кафедрой (управление)
                </span>
              ),
            },
            {
              value: 'teacher',
              label: <span style={{ color: '#15803d' }}>👨‍🏫 Преподаватель (ППС)</span>,
            },
          ]}
        />
      ),
    },
    {
      title: 'Доступ',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 110,
      align: 'center',
      render: (active, record) => (
        <Switch
          size="small"
          checked={active !== false}
          disabled={record.username === 'admin' || record.username === 'head'}
          checkedChildren="Активен"
          unCheckedChildren="Блок"
          onChange={(checked) => handleToggleActive(record.id, checked)}
        />
      ),
    },
    {
      title: 'Действия',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_, record) => {
        const isProtected = record.username === 'admin' || record.username === 'head'
        return (
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Tooltip title="Редактировать профиль или сменить пароль">
              <Button
                size="small"
                icon={<Edit3 size={14} />}
                onClick={() => handleOpenEdit(record)}
              >
                Изменить
              </Button>
            </Tooltip>

            {!isProtected && (
              <Popconfirm
                title={`Удалить пользователя ${record.username}?`}
                description="Учетная запись будет удалена из системы."
                onConfirm={() => handleDeleteUser(record.id)}
                okText="Удалить"
                cancelText="Отмена"
                okButtonProps={{ danger: true }}
              >
                <Button size="small" danger icon={<Trash2 size={14} />} />
              </Popconfirm>
            )}
          </div>
        )
      },
    },
  ]

  const storage = sysStatus?.storage || { used_mb: 2.5, quota_gb: 50, usage_percent: 0.01, backups_count: 1 }
  const memory = sysStatus?.memory || { rss_mb: 85, system_total_gb: 16, system_free_gb: 8 }
  const network = sysStatus?.network || { lan_urls: ['http://localhost:3000'], survey_urls: ['http://localhost:3000/survey'] }
  const counts = sysStatus?.counts || { users: usersList.length, admins: 1, heads: 1, teachers: 46 }

  return (
    <div style={{ padding: '4px 0 24px 0' }}>
      {/* Заголовок страницы */}
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
        <div>
          <Title level={2} style={{ margin: 0, color: '#0f172a' }}>
            Управление пользователями, правами и сервером
          </Title>
          <Paragraph style={{ margin: '4px 0 0 0', color: '#64748b' }}>
            Создание администраторов, зав. кафедрой и преподавателей &bull; Автоуправление памятью (квота 50 ГБ) и локальная сеть
          </Paragraph>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            icon={<UserPlus size={16} />}
            onClick={() => {
              createForm.resetFields()
              createForm.setFieldsValue({
                role: 'admin',
                department: 15,
                position: 'Администратор ИС',
                create_teacher_profile: false,
              })
              setIsCreateModalOpen(true)
            }}
          >
            Добавить пользователя / Админа
          </Button>

          <Button
            icon={<RefreshCw size={16} />}
            onClick={() => {
              refetchUsers()
              refetchStatus()
            }}
          >
            Обновить
          </Button>
        </div>
      </div>

      {/* Блок 1: Мониторинг сервера, Автоуправление памятью (50 ГБ) и Локальная сеть */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Карточка 1: Дисковая квота 50 ГБ и Автоочистка */}
        <Card
          size="small"
          style={{ borderRadius: 10, border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  backgroundColor: '#eff6ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#1a56db',
                }}
              >
                <HardDrive size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  Квота хранилища: 50 ГБ
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Автоуправление памятью активно
                </div>
              </div>
            </div>
            <Tag color="green">В норме</Tag>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span>Занято данными и бэкапами: <strong>{storage.used_mb} МБ</strong></span>
              <span style={{ color: '#64748b' }}>Лимит: {storage.quota_gb} ГБ</span>
            </div>
            <Progress
              percent={Math.max(1, storage.usage_percent)}
              strokeColor="#15803d"
              showInfo={false}
              size="small"
            />
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
              База <code>db.json</code>: {storage.db_file_size_kb || 580} КБ &bull; Авто-бэкапов: {storage.backups_count} из {storage.max_backups || 7} (старые удаляются автоматически)
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <Button
              size="small"
              icon={<DatabaseBackup size={14} />}
              loading={sysActionLoading}
              onClick={handleBackup}
            >
              Создать бэкап
            </Button>
            <Button
              size="small"
              icon={<Sparkles size={14} />}
              loading={sysActionLoading}
              onClick={handleCleanup}
            >
              Очистить кэш и логи
            </Button>
          </div>
        </Card>

        {/* Карточка 2: ОЗУ и Процессор (Защита от переполнения памяти) */}
        <Card
          size="small"
          style={{ borderRadius: 10, border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  backgroundColor: '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#15803d',
                }}
              >
                <Cpu size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  Оперативная память (RAM)
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Процесс КафИС: <strong>{memory.rss_mb} МБ</strong>
                </div>
              </div>
            </div>
            <Tag color="blue">Авто-GC</Tag>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: '#334155', lineHeight: 1.7 }}>
            <div>
              &bull; Свободно ОЗУ на ПК: <strong>{memory.system_free_gb} ГБ</strong> из {memory.system_total_gb} ГБ
            </div>
            <div>
              &bull; Ротация журнала аудита: <strong>макс. 5 000 записей</strong>
            </div>
            <div>
              &bull; Защита записи: <strong>атомарный .tmp коммит</strong> (без риска поломки при выключении ПК)
            </div>
          </div>
        </Card>

        {/* Карточка 3: Доступ в локальной сети (Windows LAN Server) */}
        <Card
          size="small"
          style={{ borderRadius: 10, border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  backgroundColor: '#f5f3ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#7c3aed',
                }}
              >
                <Wifi size={20} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                  Доступ по локальной сети (LAN)
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Хост: <code>0.0.0.0:{network.port || 3000}</code> (открыт для всех ПК и телефонов)
                </div>
              </div>
            </div>
            <Tag color="purple">LAN активен</Tag>
          </div>

          <div style={{ marginTop: 12, fontSize: 12 }}>
            <div style={{ color: '#64748b', marginBottom: 4 }}>Адреса для входа с других ПК в сети:</div>
            {(network.lan_urls || []).slice(0, 2).map((url, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: '#f8fafc',
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  marginBottom: 4,
                }}
              >
                <code style={{ fontWeight: 600, color: '#1a56db' }}>{url}</code>
                <Button
                  type="text"
                  size="small"
                  icon={<Copy size={13} />}
                  onClick={() => copyToClipboard(url)}
                  title="Скопировать адрес"
                />
              </div>
            ))}
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Для запуска на Windows 10/11 в 1 клик используйте файл <code>START_WINDOWS_SERVER.bat</code>
            </div>
          </div>
        </Card>
      </div>

      {/* Таблица управления пользователями и ролями */}
      <Card style={{ borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Radio.Group
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="">
                Все ({counts.users || usersList.length})
              </Radio.Button>
              <Radio.Button value="admin">
                🛡️ Админы ({counts.admins || 1})
              </Radio.Button>
              <Radio.Button value="head">
                🎓 Зав. кафедрой ({counts.heads || 1})
              </Radio.Button>
              <Radio.Button value="teacher">
                👨‍🏫 Преподаватели
              </Radio.Button>
            </Radio.Group>

            <Input.Search
              placeholder="Поиск по ФИО, логину, кафедре..."
              allowClear
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 260, maxWidth: '100%' }}
            />
          </div>

          <Button
            size="small"
            icon={showPasswords ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShowPasswords(!showPasswords)}
          >
            {showPasswords ? 'Скрыть пароли' : 'Показать пароли'}
          </Button>
        </div>

        <Table
          dataSource={usersList}
          columns={columns}
          rowKey="id"
          loading={loadingUsers || loadingStatus}
          scroll={{ x: 860 }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          locale={{ emptyText: 'Пользователи не найдены' }}
        />
      </Card>

      {/* Модальное окно создания нового пользователя / администратора */}
      <Modal
        open={isCreateModalOpen}
        onCancel={() => setIsCreateModalOpen(false)}
        footer={null}
        title="Добавление нового пользователя и назначение прав"
        width={560}
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreateUser}
          initialValues={{
            role: 'admin',
            department: 15,
            position: 'Администратор ИС',
            create_teacher_profile: false,
          }}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="Права доступа"
            description="Вы можете создать второго Системного администратора, Заведующего кафедрой или Преподавателя. Учетная запись сразу сохраняется в базу db.json."
          />

          <Form.Item
            name="role"
            label="Роль и уровень полномочий"
            rules={[{ required: true, message: 'Выберите роль' }]}
          >
            <Select
              onChange={(val) => {
                if (val === 'admin') {
                  createForm.setFieldsValue({ position: 'Системный администратор', create_teacher_profile: false })
                } else if (val === 'head') {
                  createForm.setFieldsValue({ position: 'Заведующий кафедрой', create_teacher_profile: true })
                } else {
                  createForm.setFieldsValue({ position: 'Старший преподаватель', create_teacher_profile: true })
                }
              }}
              options={[
                { value: 'admin', label: '🛡️ Системный администратор (полный доступ ко всем разделам)' },
                { value: 'head', label: '🎓 Заведующий кафедрой (управление кафедрой и правами)' },
                { value: 'teacher', label: '👨‍🏫 Преподаватель (просмотр нагрузки, оценок и качества)' },
              ]}
            />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Form.Item
              name="username"
              label="Логин для входа"
              rules={[{ required: true, message: 'Укажите логин (например, admin2 или ivanov)' }]}
            >
              <Input placeholder="Например: admin2" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Пароль"
              rules={[{ required: true, message: 'Укажите пароль' }]}
            >
              <Input.Password placeholder="Например: admin12345" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <Form.Item
              name="last_name"
              label="Фамилия"
              rules={[{ required: true, message: 'Введите фамилию' }]}
            >
              <Input placeholder="Иванов" />
            </Form.Item>

            <Form.Item
              name="first_name"
              label="Имя"
              rules={[{ required: true, message: 'Введите имя' }]}
            >
              <Input placeholder="Иван" />
            </Form.Item>

            <Form.Item name="middle_name" label="Отчество">
              <Input placeholder="Иванович" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <Form.Item name="department" label="Кафедра">
              <Select
                options={DEPARTMENTS.map((d) => ({
                  value: d.id,
                  label: `${d.code} — ${d.name}`,
                }))}
              />
            </Form.Item>

            <Form.Item name="position" label="Должность">
              <Input placeholder="Доцент кафедры, к.т.н." />
            </Form.Item>
          </div>

          <Form.Item name="email" label="Корпоративный Email">
            <Input placeholder="ivanov@misis.ru" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setIsCreateModalOpen(false)}>Отмена</Button>
            <Button type="primary" htmlType="submit" loading={isSubmitting}>
              Создать учетную запись
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Модальное окно редактирования пользователя и смены пароля */}
      <Modal
        open={!!editingUser}
        onCancel={() => setEditingUser(null)}
        footer={null}
        title={`Редактирование: ${editingUser?.full_name || editingUser?.username}`}
        width={520}
      >
        <Form form={editForm} layout="vertical" onFinish={handleUpdateUser}>
          <Form.Item name="role" label="Роль в системе">
            <Select
              options={[
                { value: 'admin', label: '🛡️ Системный администратор' },
                { value: 'head', label: '🎓 Заведующий кафедрой' },
                { value: 'teacher', label: '👨‍🏫 Преподаватель' },
              ]}
            />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="last_name" label="Фамилия">
              <Input />
            </Form.Item>
            <Form.Item name="first_name" label="Имя">
              <Input />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="department" label="Кафедра">
              <Select
                options={DEPARTMENTS.map((d) => ({
                  value: d.id,
                  label: `${d.code} — ${d.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="position" label="Должность">
              <Input />
            </Form.Item>
          </div>

          <Form.Item
            name="password"
            label="Новый пароль (оставьте пустым, чтобы не менять)"
          >
            <Input.Password placeholder="Введите новый пароль для сброса" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => setEditingUser(null)}>Отмена</Button>
            <Button type="primary" htmlType="submit" loading={isSubmitting}>
              Сохранить изменения
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
