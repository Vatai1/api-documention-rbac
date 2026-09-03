const BASE = '/api'

export function getToken() {
  return localStorage.getItem('portal_token')
}
export function setToken(t) {
  t ? localStorage.setItem('portal_token', t) : localStorage.removeItem('portal_token')
}

export async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, { ...opts, headers })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export async function login(username, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
  setToken(data.token)
  return data.user
}

export async function getMe() {
  return request('/auth/me')
}

// ── APIs ──
export const getApis = () => request('/apis')
export const getApi = (id) => request(`/apis/${id}`)

// ── Admin: APIs ──
export const createApi = (data) => request('/admin/apis', { method: 'POST', body: JSON.stringify(data) })
export const updateApi = (id, data) => request(`/admin/apis/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteApi = (id) => request(`/admin/apis/${id}`, { method: 'DELETE' })

// ── Admin: папки ──
export const createFolder = (apiId, name, parentId) =>
  request(`/admin/apis/${apiId}/folders`, { method: 'POST', body: JSON.stringify({ name, parent_id: parentId ?? null }) })
export const updateFolder = (apiId, folderId, data) =>
  request(`/admin/apis/${apiId}/folders/${folderId}`, { method: 'PUT', body: JSON.stringify(data) })
export const reorderFolder = (apiId, folderId, targetId, position) =>
  request(`/admin/apis/${apiId}/folders/${folderId}`, {
    method: 'PUT',
    body: JSON.stringify({ move: { target_id: targetId, position } })
  })
export const deleteFolder = (apiId, folderId) =>
  request(`/admin/apis/${apiId}/folders/${folderId}`, { method: 'DELETE' })
export const moveEndpointTo = (apiId, endpointId, folderId) =>
  request(`/admin/apis/${apiId}/endpoints/move`, { method: 'PUT', body: JSON.stringify({ endpoint_id: endpointId, folder_id: folderId ?? null }) })

// Пакетное переименование эндпоинтов (названия)
export const setEndpointNames = (apiId, names) =>
  request(`/admin/apis/${apiId}/endpoints/names`, { method: 'PUT', body: JSON.stringify({ names }) })

// ── Глобальные папки (вне API) ──
export const getTreeFolders = () => request('/tree/folders')
export const createTreeFolder = (name, parentId) =>
  request('/admin/tree/folders', { method: 'POST', body: JSON.stringify({ name, parent_id: parentId ?? null }) })
export const updateTreeFolder = (folderId, data) =>
  request(`/admin/tree/folders/${folderId}`, { method: 'PUT', body: JSON.stringify(data) })
export const reorderTreeFolder = (folderId, targetId, position) =>
  request(`/admin/tree/folders/${folderId}`, { method: 'PUT', body: JSON.stringify({ move: { target_id: targetId, position } }) })
export const deleteTreeFolder = (folderId) =>
  request(`/admin/tree/folders/${folderId}`, { method: 'DELETE' })
export const moveApiToFolder = (apiId, folderId) =>
  request(`/admin/apis/${apiId}/folder`, { method: 'PUT', body: JSON.stringify({ folder_id: folderId ?? null }) })

// ── Admin: Users ──
export const getUsers = () => request('/admin/users')
export const createUser = (data) => request('/admin/users', { method: 'POST', body: JSON.stringify(data) })
export const updateUser = (id, data) => request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser = (id) => request(`/admin/users/${id}`, { method: 'DELETE' })

// ── Admin: Permissions ──
// accesses: [{ api_id, folder_ids: null(полный доступ) | [folderId] }]
export const setUserAccesses = (userId, accesses) =>
  request(`/admin/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ accesses }) })

// ── Песочница ──
export const tryRequest = (payload) =>
  request('/try', { method: 'POST', body: JSON.stringify(payload) })

// ── Admin: парсинг .docx → OpenAPI ──
export const parseDocx = (base64, filename) =>
  request('/admin/parse-docx', { method: 'POST', body: JSON.stringify({ data_base64: base64, filename }) })

// ── Профиль ──
export const setFavorites = (items) =>
  request('/me/favorites', { method: 'PUT', body: JSON.stringify({ items }) })

// ── Admin: заметка к эндпоинту ──
export const saveEndpointNote = (apiId, epId, note) =>
  request(`/admin/apis/${apiId}/endpoints/${epId}/note`, { method: 'PUT', body: JSON.stringify({ note }) })

// ── Admin: журнал действий ──
export const getAudit = (limit = 200) => request(`/admin/audit?limit=${limit}`)
