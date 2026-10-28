import client from './client'

/**
 * Получение списка пользователей с фильтрацией по роли и поиску
 * @param {Object} params - { role, search }
 */
export async function getUsers(params = {}) {
  const response = await client.get('/users/', { params })
  return response.data
}

/**
 * Создание нового пользователя (Администратора, Зав. кафедрой, Преподавателя)
 * @param {Object} data
 */
export async function createUser(data) {
  const response = await client.post('/users/', data)
  return response.data
}

/**
 * Обновление данных пользователя (роли, пароля, ФИО, активности)
 * @param {number} id
 * @param {Object} data
 */
export async function updateUser(id, data) {
  const response = await client.patch(`/users/${id}/`, data)
  return response.data
}

/**
 * Удаление пользователя
 * @param {number} id
 */
export async function deleteUser(id) {
  const response = await client.delete(`/users/${id}/`)
  return response.data
}

/**
 * Получение состояния сервера, квоты 50 ГБ, ОЗУ и локальной сети (LAN IP)
 */
export async function getSystemStatus() {
  const response = await client.get('/system/status/')
  return response.data
}

/**
 * Ручное создание резервной копии базы данных
 */
export async function createManualBackup() {
  const response = await client.post('/system/backup/')
  return response.data
}

/**
 * Очистка и оптимизация памяти/логов сервера
 */
export async function triggerSystemCleanup() {
  const response = await client.post('/system/cleanup/')
  return response.data
}
