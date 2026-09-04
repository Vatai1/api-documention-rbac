/**
 * Express-сервер API Портала.
 * Хранилище — PostgreSQL (Docker: api-portal-pg, localhost:5433, база api_portal).
 * Модель держится в памяти, после каждой мутации — полная синхронизация в PG (транзакция).
 * Первая миграция: данные из data.json импортируются автоматически.
 * JWT-авторизация, RBAC. Первый запуск: пароль администратора устанавливается
 * при первом входе через экран первичной настройки (без демо-доступа).
 */
import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readZipEntry, parseDocxSpec } from './parse-docx.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_FILE = join(__dirname, 'data.json')

// ── .env (без зависимостей) ──
function loadEnvFile() {
  try {
    const envPath = join(__dirname, '.env')
    if (!existsSync(envPath)) return
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  } catch { /* ignore */ }
}
loadEnvFile()

const SECRET = process.env.PORTAL_SECRET || 'eks-portal-secret-2025-dev'
const PORT = (() => {
  const n = parseInt(process.env.PORT || '3010', 10)
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3010
})()

// ── Хранилище: PostgreSQL ──
function pgPort(defaultPort = 5432) {
  const raw = process.env.PGPORT
  if (raw === undefined || raw === '') return defaultPort
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    console.warn(`⚠ Некорректное значение PGPORT «${raw}» — используется порт ${defaultPort}`)
    return defaultPort
  }
  return n
}

const PG = {
  host: process.env.PGHOST || 'localhost',
  port: pgPort(),
  user: process.env.PGUSER || 'portal',
  password: process.env.PGPASSWORD || 'portal',
  database: process.env.PGDATABASE || 'api_portal'
}
const pool = new pg.Pool({ ...PG, max: 5 })

// Автосоздание базы при первом запуске (для внешнего PostgreSQL без POSTGRES_DB)
async function ensureDatabase() {
  const admin = new pg.Client({ ...PG, database: 'postgres' })
  try {
    await admin.connect()
    const r = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [PG.database])
    if (r.rowCount === 0) {
      const safeName = PG.database.replace(/"/g, '""')
      await admin.query(`CREATE DATABASE "${safeName}"`)
      console.log(`🗄 Создана база данных «${PG.database}»`)
    }
  } catch (e) {
    console.warn(`Не удалось проверить/создать базу «${PG.database}»: ${e.message}`)
  } finally {
    await admin.end().catch(() => {})
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS apis (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0',
  description TEXT NOT NULL DEFAULT '',
  server_url TEXT NOT NULL DEFAULT '',
  swagger_url TEXT NOT NULL DEFAULT '',
  folder_id INTEGER,
  folders JSONB NOT NULL DEFAULT '[]'::jsonb,
  endpoints JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS global_folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id INTEGER,
  "order" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS permissions (
  user_id INTEGER NOT NULL,
  api_id INTEGER NOT NULL,
  folder_ids JSONB,
  endpoint_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, api_id)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  ts TEXT NOT NULL,
  user_id INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS favorites JSONB NOT NULL DEFAULT '[]'::jsonb;
`

async function initSchema() {
  await pool.query(SCHEMA_SQL)
}

async function loadFromPg() {
  const [u, a, g, p] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY id'),
    pool.query('SELECT * FROM apis ORDER BY id'),
    pool.query('SELECT * FROM global_folders ORDER BY id'),
    pool.query('SELECT * FROM permissions ORDER BY user_id, api_id')
  ])
  if (u.rows.length === 0 && a.rows.length === 0) return null
  return {
    users: u.rows.map(r => ({
      id: r.id, username: r.username, password: r.password, email: r.email,
      fullName: r.full_name, is_admin: r.is_admin, created_at: r.created_at,
      favorites: r.favorites || []
    })),
    apis: a.rows.map(r => ({
      id: r.id, name: r.name, title: r.title, version: r.version, description: r.description,
      server_url: r.server_url, swagger_url: r.swagger_url, folder_id: r.folder_id ?? null,
      folders: r.folders || [], endpoints: r.endpoints || [], created_at: r.created_at
    })),
    globalFolders: g.rows.map(r => ({ id: r.id, name: r.name, parent_id: r.parent_id ?? null, order: r.order })),
    permissions: p.rows.map(r => ({
      user_id: r.user_id, api_id: r.api_id,
      folder_ids: r.folder_ids ?? null, endpoint_ids: r.endpoint_ids || []
    }))
  }
}

// Записи сериализуются в очередь — порядок мутаций сохраняется
let saveChain = Promise.resolve()
function saveDB(db) {
  saveChain = saveChain.then(() => syncToPg(db)).catch(err => {
    console.error('❌ Ошибка записи в PostgreSQL:', err.message)
  })
  return saveChain
}

async function syncToPg(db) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM permissions')
    await client.query('DELETE FROM users')
    for (const usr of db.users) {
      await client.query(
        'INSERT INTO users (id, username, password, email, full_name, is_admin, created_at, favorites) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [usr.id, usr.username, usr.password, usr.email || '', usr.fullName || '', !!usr.is_admin, usr.created_at || '', JSON.stringify(usr.favorites || [])]
      )
    }
    await client.query('DELETE FROM apis')
    for (const api of db.apis) {
      await client.query(
        'INSERT INTO apis (id, name, title, version, description, server_url, swagger_url, folder_id, folders, endpoints, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [api.id, api.name, api.title || '', api.version || '1.0', api.description || '',
          api.server_url || '', api.swagger_url || '', api.folder_id ?? null,
          JSON.stringify(api.folders || []), JSON.stringify(api.endpoints || []), api.created_at || '']
      )
    }
    await client.query('DELETE FROM global_folders')
    for (const g of db.globalFolders || []) {
      await client.query(
        'INSERT INTO global_folders (id, name, parent_id, "order") VALUES ($1,$2,$3,$4)',
        [g.id, g.name, g.parent_id ?? null, g.order || 1]
      )
    }
    for (const p of db.permissions || []) {
      await client.query(
        'INSERT INTO permissions (user_id, api_id, folder_ids, endpoint_ids) VALUES ($1,$2,$3,$4)',
        [p.user_id, p.api_id,
          p.folder_ids == null ? null : JSON.stringify(p.folder_ids),
          JSON.stringify(p.endpoint_ids || [])]
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

// Чтение старого файла (для первой миграции)
function loadFileDb() {
  if (!existsSync(DATA_FILE)) return null
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf-8')) } catch { return null }
}

function nextId(arr) {
  return arr.length ? Math.max(...arr.map(x => x.id)) + 1 : 1
}

// ── Папки: миграция и хелперы ──
function migrateApi(api) {
  if (api.folders && api.endpoints) return false
  const folders = []
  const endpoints = []
  for (const [tag, eps] of Object.entries(api.groups || {})) {
    const folderId = folders.length + 1
    folders.push({ id: folderId, name: tag, parent_id: null, order: folders.length + 1 })
    for (const ep of eps) {
      endpoints.push({ ...ep, id: endpoints.length + 1, folder_id: folderId })
    }
  }
  api.folders = folders
  api.endpoints = endpoints
  delete api.groups
  return true
}

function isDescendant(api, fid, maybeAncestorId) {
  let f = api.folders.find(x => x.id === fid)
  while (f && f.parent_id != null) {
    if (f.parent_id === maybeAncestorId) return true
    f = api.folders.find(x => x.id === f.parent_id)
  }
  return false
}

function collectSubtreeIds(api, fid, set) {
  set.add(fid)
  for (const f of api.folders) if (f.parent_id === fid) collectSubtreeIds(api, f.id, set)
  return set
}

function collectAncestorIds(api, fid, set) {
  let f = api.folders.find(x => x.id === fid)
  while (f && f.parent_id != null) {
    set.add(f.parent_id)
    f = api.folders.find(x => x.id === f.parent_id)
  }
  return set
}

// ── Сидинг (первый запуск): админ без пароля (устанавливается при первом входе) ──
function pendingAdmin() {
  return {
    id: 1,
    username: 'admin',
    password: '',  // пустой пароль = ждёт установки через /api/auth/setup
    email: 'admin@local',
    fullName: 'Администратор',
    is_admin: true,
    created_at: new Date().toISOString()
  }
}

function seed() {
  const db = { users: [pendingAdmin()], apis: [], globalFolders: [], permissions: [] }

  let spec = null
  try {
    const specPath = join(__dirname, 'openapi.json')
    if (existsSync(specPath)) spec = JSON.parse(readFileSync(specPath, 'utf-8'))
  } catch (e) {
    console.error('Не удалось прочитать openapi.json:', e.message)
  }

  if (spec && spec.paths) {
    // Группируем эндпоинты по тегам
    const groups = {}
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, detail] of Object.entries(methods)) {
        if (!['get','post','put','delete','patch'].includes(method)) continue
        const tags = detail.tags || ['Без категории']
        for (const tag of tags) {
          if (!groups[tag]) groups[tag] = []
          groups[tag].push({
            id: nextId(Object.values(groups).flat()),
            method: method.toUpperCase(),
            path,
            summary: detail.summary || '',
            description: detail.description || '',
            operationId: detail.operationId || '',
            parameters: detail.parameters || [],
            requestBody: detail.requestBody || null,
            responses: detail.responses || {}
          })
        }
      }
    }

    const api = {
      id: 1,
      name: 'eks-api-2025',
      title: spec.info?.title || 'API',
      version: spec.info?.version || '1.0',
      description: spec.info?.description || '',
      server_url: spec.servers?.[0]?.url || '',
      swagger_url: '/eks-api-swagger-2025.html',
      groups: groups,
      created_at: new Date().toISOString()
    }
    migrateApi(api)
    db.apis.push(api)
  }

  saveDB(db)
  console.log(`✅ Сидинг: админ без пароля (установите при первом входе), ${db.apis.length} API`)
  return db
}

// ── Старт: база → схема → загрузка из PG → (импорт API из data.json) → сидинг ──
await ensureDatabase()
await initSchema()
let db = await loadFromPg()
if (db) {
  console.log('🐘 Данные загружены из PostgreSQL')
  // Демо-доступ отключён: сбрасываем известный демо-пароль администратора
  let demoReset = false
  for (const u of db.users) {
    if (u.is_admin && u.password && bcrypt.compareSync('admin12345', u.password)) {
      u.password = ''
      demoReset = true
    }
  }
  if (demoReset) {
    saveDB(db)
    console.log('🔑 Обнаружен демо-пароль администратора — сброшен, установите новый при первом входе')
  }
} else {
  const fileDb = loadFileDb()
  if (fileDb && (fileDb.apis?.length || fileDb.users?.length)) {
    // Импортируем контент (API, папки); пользователи не переносятся —
    // админ создаётся без пароля и настраивается при первом входе
    db = {
      users: [pendingAdmin()],
      apis: fileDb.apis || [],
      globalFolders: fileDb.globalFolders || [],
      permissions: []
    }
    for (const api of db.apis) migrateApi(api)
    saveDB(db)
    console.log(`📦 Импорт из data.json → PostgreSQL: ${db.apis.length} API (пользователи не переносятся)`)
  } else {
    console.log('База пуста — выполняю сидинг...')
    db = seed()
  }
}
// Миграция старого формата groups → folders/endpoints
let migrated = false
for (const api of db.apis) {
  if (migrateApi(api)) {
    migrated = true
    console.log(`📦 Миграция API «${api.name}»: groups → ${api.folders.length} папок, ${api.endpoints.length} эндпоинтов`)
  }
}
if (migrated) saveDB(db)
if (!db.globalFolders) {
  db.globalFolders = []
  saveDB(db)
}
console.log(`📊 База: ${db.users.length} польз., ${db.apis.length} API`)

// Поддерево глобальных папок
function treeSubtreeIds(fid) {
  const set = new Set([fid])
  let changed = true
  while (changed) {
    changed = false
    for (const f of db.globalFolders) {
      if (f.parent_id != null && set.has(f.parent_id) && !set.has(f.id)) { set.add(f.id); changed = true }
    }
  }
  return set
}

// ── Express ──
const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Middleware: JWT
function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'Не авторизован' })
  try {
    const token = header.replace('Bearer ', '')
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Неверный токен' })
  }
}

// Middleware: только админ
function adminOnly(req, res, next) {
  const u = db.users.find(x => x.id === req.user.id)
  if (!u || !u.is_admin) return res.status(403).json({ error: 'Только для администратора' })
  next()
}

// ── Rate limit (in-memory) ──
const rlBuckets = new Map()
function rateLimit(key, max, windowMs) {
  const now = Date.now()
  let b = rlBuckets.get(key)
  if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; rlBuckets.set(key, b) }
  b.count++
  return b.count <= max
}

// ── Аудит действий ──
function audit(userId, username, action, details = {}) {
  pool.query(
    'INSERT INTO audit_log (ts, user_id, username, action, details) VALUES ($1,$2,$3,$4,$5)',
    [new Date().toISOString(), userId ?? null, username || '', action, JSON.stringify(details)]
  ).catch(e => console.error('audit:', e.message))
}

// ── AUTH ──
// Требуется ли первичная настройка (нет админа с установленным паролем)
function setupRequired() {
  return !db.users.some(u => u.is_admin && u.password)
}

app.get('/api/auth/status', (req, res) => {
  res.json({ setup_required: setupRequired() })
})

// Первый вход: установка пароля администратора
app.post('/api/auth/setup', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || ''
  if (!rateLimit(`setup:${ip}`, 10, 10 * 60 * 1000))
    return res.status(429).json({ error: 'Слишком много попыток. Повторите через 10 минут.' })
  if (!setupRequired())
    return res.status(403).json({ error: 'Пароль администратора уже установлен' })
  const { password } = req.body || {}
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' })
  let admin = db.users.find(u => u.is_admin)
  if (!admin) {
    admin = { ...pendingAdmin(), id: nextId(db.users) }
    db.users.push(admin)
  }
  admin.password = bcrypt.hashSync(password, 10)
  saveDB(db)
  audit(admin.id, admin.username, 'admin_setup', { ip })
  const token = jwt.sign({ id: admin.id, username: admin.username }, SECRET, { expiresIn: '24h' })
  res.json({
    token,
    user: { id: admin.id, username: admin.username, email: admin.email, fullName: admin.fullName, is_admin: admin.is_admin, favorites: admin.favorites || [] }
  })
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body
  const ip = req.ip || req.socket?.remoteAddress || ''
  if (!rateLimit(`login:${ip}:${username}`, 8, 10 * 60 * 1000))
    return res.status(429).json({ error: 'Слишком много попыток входа. Повторите через 10 минут.' })
  const user = db.users.find(u => u.username === username)
  if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
    audit(null, String(username || ''), 'login_failed', { ip })
    return res.status(401).json({ error: 'Неверный логин или пароль' })
  }
  audit(user.id, user.username, 'login', { ip })
  const token = jwt.sign({ id: user.id, username: user.username }, SECRET, { expiresIn: '24h' })
  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, fullName: user.fullName, is_admin: user.is_admin, favorites: user.favorites || [] }
  })
})

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' })
  const apiIds = db.permissions
    .filter(p => p.user_id === user.id)
    .map(p => p.api_id)
  const accessibleApis = user.is_admin
    ? db.apis.map(a => a.id)
    : apiIds
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    is_admin: user.is_admin,
    favorites: user.favorites || [],
    accessible_apis: accessibleApis
  })
})

// ── APIS (чтение — по правам) ──
app.get('/api/apis', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id)
  let apis = db.apis
  if (!user.is_admin) {
    const allowed = db.permissions.filter(p => p.user_id === user.id).map(p => p.api_id)
    apis = apis.filter(a => allowed.includes(a.id))
  }
  // Лёгкий список (без эндпоинтов)
  res.json(apis.map(a => ({
    id: a.id,
    name: a.name,
    title: a.title,
    version: a.version,
    description: a.description,
    server_url: a.server_url,
    swagger_url: a.swagger_url,
    endpoint_count: (a.endpoints || []).length,
    folder_count: (a.folders || []).length,
    folder_id: a.folder_id ?? null,
    created_at: a.created_at
  })))
})

// Глобальные папки (вне API) — видны папки, содержащие доступные пользователю API
app.get('/api/tree/folders', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id)
  let folders = db.globalFolders || []
  if (!user.is_admin) {
    const allowed = new Set(db.permissions.filter(p => p.user_id === user.id).map(p => p.api_id))
    const direct = new Set()
    for (const a of db.apis) {
      if (allowed.has(a.id) && a.folder_id != null) direct.add(a.folder_id)
    }
    const byId = new Map(folders.map(f => [f.id, f]))
    const visible = new Set(direct)
    for (const fid of direct) {
      let f = byId.get(fid)
      while (f && f.parent_id != null) { visible.add(f.parent_id); f = byId.get(f.parent_id) }
    }
    folders = folders.filter(f => visible.has(f.id))
  }
  res.json(folders)
})

// Видимая пользователю версия API (с учётом прав) или null (нет доступа)
function visibleApiFor(user, api) {
  if (user.is_admin) return api
  const perms = db.permissions.filter(p => p.user_id === user.id && p.api_id === api.id)
  if (!perms.length) return null
  const fullAccess = perms.some(p => p.folder_ids == null)
  if (fullAccess) return api
  // Разрешённые папки (с вложенными) + отдельные эндпоинты + предки для структуры дерева
  const allowedEp = new Set()
  const allowed = new Set()
  for (const p of perms) {
    for (const fid of (p.folder_ids || [])) collectSubtreeIds(api, fid, allowed)
    for (const eid of (p.endpoint_ids || [])) allowedEp.add(eid)
  }
  const visEndpoints = api.endpoints.filter(e =>
    (e.folder_id != null && allowed.has(e.folder_id)) || allowedEp.has(e.id))
  // Папки, содержащие видимые эндпоинты, тоже видимы
  for (const e of visEndpoints) if (e.folder_id != null) allowed.add(e.folder_id)
  const ancestors = new Set()
  for (const fid of allowed) collectAncestorIds(api, fid, ancestors)
  const visible = new Set([...allowed, ...ancestors])
  return {
    ...api,
    folders: api.folders.filter(f => visible.has(f.id)),
    endpoints: visEndpoints
  }
}

app.get('/api/apis/:id', auth, (req, res) => {
  const apiId = parseInt(req.params.id)
  const user = db.users.find(u => u.id === req.user.id)
  const api = db.apis.find(a => a.id === apiId)
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const visible = visibleApiFor(user, api)
  if (!visible) return res.status(403).json({ error: 'Нет доступа к этому API' })
  res.json(visible)
})

// ── OpenAPI spec из текущего дерева (для Swagger UI / экспорта) ──
app.get('/api/apis/:id/spec', (req, res) => {
  // Swagger UI не умеет Authorization-хедер без настройки — принимаем токен в query
  const token = (req.query.token || '').toString()
  let payload = null
  try { payload = jwt.verify(token, SECRET) } catch { /* ниже проверим хедер */ }
  const header = req.headers.authorization
  if (!payload && header) {
    try { payload = jwt.verify(header.replace('Bearer ', ''), SECRET) } catch {}
  }
  if (!payload) return res.status(401).json({ error: 'Не авторизован' })
  const user = db.users.find(u => u.id === payload.id)
  if (!user) return res.status(401).json({ error: 'Не авторизован' })
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const visible = visibleApiFor(user, api)
  if (!visible) return res.status(403).json({ error: 'Нет доступа к этому API' })

  const folderName = (fid) => (visible.folders || []).find(f => f.id === fid)?.name
  const paths = {}
  for (const ep of (visible.endpoints || [])) {
    const p = paths[ep.path] = paths[ep.path] || {}
    p[ep.method.toLowerCase()] = {
      summary: ep.summary || '',
      description: [ep.description, ep.note].filter(Boolean).join('\n\n') || undefined,
      tags: [ep.folder_id != null ? (folderName(ep.folder_id) || 'Прочее') : 'Корень'],
      parameters: ep.parameters || [],
      ...(ep.requestBody ? { requestBody: ep.requestBody } : {}),
      responses: ep.responses || {}
    }
  }
  res.json({
    openapi: '3.0.3',
    info: {
      title: visible.title || visible.name,
      version: String(visible.version || '1.0'),
      description: visible.description || ''
    },
    servers: visible.server_url ? [{ url: visible.server_url }] : [],
    paths
  })
})

// ── ADMIN: API ──
app.post('/api/admin/apis', auth, adminOnly, (req, res) => {
  const { name, title, version, description, server_url, swagger_url, groups } = req.body
  // Назначаем id эндпоинтам
  let counter = 1
  for (const eps of Object.values(groups || {})) {
    for (const ep of eps) ep.id = counter++
  }
  const api = {
    id: nextId(db.apis),
    name: name || 'unnamed-api',
    title: title || name || 'API',
    version: version || '1.0',
    description: description || '',
    server_url: server_url || '',
    swagger_url: swagger_url || '',
    groups: groups || {},
    created_at: new Date().toISOString()
  }
  migrateApi(api)
  db.apis.push(api)
  saveDB(db)
  audit(req.user.id, req.user.username, 'api_create', { id: api.id, name: api.name, endpoints: api.endpoints?.length || 0 })
  res.status(201).json(api)
})

app.put('/api/admin/apis/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id)
  const api = db.apis.find(a => a.id === id)
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const { name, title, version, description, server_url, swagger_url, groups } = req.body
  if (name !== undefined) api.name = name
  if (title !== undefined) api.title = title
  if (version !== undefined) api.version = version
  if (description !== undefined) api.description = description
  if (server_url !== undefined) api.server_url = server_url
  if (swagger_url !== undefined) api.swagger_url = swagger_url
  if (groups !== undefined) {
    let c = 1
    for (const eps of Object.values(groups)) for (const ep of eps) ep.id = c++
    api.groups = groups
    migrateApi(api)
  }
  saveDB(db)
  audit(req.user.id, req.user.username, 'api_update', { id: api.id, name: api.name })
  res.json(api)
})

app.delete('/api/admin/apis/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id)
  const api = db.apis.find(a => a.id === id)
  db.apis = db.apis.filter(a => a.id !== id)
  db.permissions = db.permissions.filter(p => p.api_id !== id)
  saveDB(db)
  audit(req.user.id, req.user.username, 'api_delete', { id, name: api?.name })
  res.json({ ok: true })
})

// ── ADMIN: папки внутри API ──
app.post('/api/admin/apis/:id/folders', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const { name, parent_id } = req.body
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Укажите название папки' })
  if (!api.folders) migrateApi(api)
  if (parent_id != null && !api.folders.find(f => f.id === parent_id))
    return res.status(404).json({ error: 'Родительская папка не найдена' })
  const siblings = api.folders.filter(f => (f.parent_id ?? null) === (parent_id ?? null))
  const folder = {
    id: nextId(api.folders),
    name: String(name).trim(),
    parent_id: parent_id ?? null,
    order: siblings.length ? Math.max(...siblings.map(f => f.order || 0)) + 1 : 1
  }
  api.folders.push(folder)
  saveDB(db)
  audit(req.user.id, req.user.username, 'folder_create', { api: api.name, name: folder.name, parent_id: folder.parent_id })
  res.status(201).json(folder)
})

app.put('/api/admin/apis/:id/folders/:fid', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const folder = api.folders.find(f => f.id === parseInt(req.params.fid))
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' })
  const { name, parent_id, move } = req.body
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Название не может быть пустым' })
    folder.name = String(name).trim()
  }
  // Перестановка относительно другой папки: { target_id, position: 'before'|'after' }
  if (move) {
    const target = api.folders.find(f => f.id === move.target_id)
    if (!target) return res.status(404).json({ error: 'Целевая папка не найдена' })
    if (target.id === folder.id || isDescendant(api, target.id, folder.id))
      return res.status(409).json({ error: 'Нельзя переместить папку относительно самой себя или её подпапки' })
    const newParent = target.parent_id ?? null
    const sibs = api.folders
      .filter(f => (f.parent_id ?? null) === newParent && f.id !== folder.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    const idx = sibs.findIndex(f => f.id === target.id)
    sibs.splice(move.position === 'before' ? idx : idx + 1, 0, folder)
    sibs.forEach((f, i) => { f.order = i + 1 })
    folder.parent_id = newParent
  }
  if (parent_id !== undefined) {
    const target = parent_id ?? null
    if (target !== null) {
      if (!api.folders.find(f => f.id === target))
        return res.status(404).json({ error: 'Целевая папка не найдена' })
      if (target === folder.id || isDescendant(api, target, folder.id))
        return res.status(409).json({ error: 'Нельзя переместить папку в саму себя или её подпапку' })
    }
    folder.parent_id = target
  }
  saveDB(db)
  audit(req.user.id, req.user.username, 'folder_update', { api: api.name, id: folder.id, name: folder.name })
  res.json(folder)
})

app.delete('/api/admin/apis/:id/folders/:fid', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const fid = parseInt(req.params.fid)
  const folder = api.folders.find(f => f.id === fid)
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' })
  // Содержимое поднимается к родителю
  for (const ep of api.endpoints) if (ep.folder_id === fid) ep.folder_id = folder.parent_id
  for (const f of api.folders) if (f.parent_id === fid) f.parent_id = folder.parent_id
  api.folders = api.folders.filter(f => f.id !== fid)
  saveDB(db)
  audit(req.user.id, req.user.username, 'folder_delete', { api: api.name, name: folder.name })
  res.json({ ok: true })
})

// Пакетное переименование эндпоинтов (названия для режима имён)
app.put('/api/admin/apis/:id/endpoints/names', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const names = Array.isArray(req.body.names) ? req.body.names : []
  let changed = 0
  for (const n of names) {
    if (!n || typeof n.id !== 'number') continue
    const ep = (api.endpoints || []).find(e => e.id === n.id)
    if (!ep) continue
    const val = String(n.summary ?? '').slice(0, 300)
    if (ep.summary !== val) { ep.summary = val; changed++ }
  }
  if (changed) {
    saveDB(db)
    audit(req.user.id, req.user.username, 'endpoint_names', { api: api.name, changed })
  }
  res.json({ ok: true, changed })
})

app.put('/api/admin/apis/:id/endpoints/move', auth, adminOnly, (req, res) => {  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const { endpoint_id, folder_id } = req.body
  const ep = api.endpoints.find(e => e.id === endpoint_id)
  if (!ep) return res.status(404).json({ error: 'Эндпоинт не найден' })
  if (folder_id != null && !api.folders.find(f => f.id === folder_id))
    return res.status(404).json({ error: 'Папка не найдена' })
  ep.folder_id = folder_id ?? null
  saveDB(db)
  res.json({ ok: true, endpoint_id, folder_id: ep.folder_id })
})

// ── ADMIN: глобальные папки (вне API) ──
app.post('/api/admin/tree/folders', auth, adminOnly, (req, res) => {
  const { name, parent_id } = req.body
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Укажите название папки' })
  if (parent_id != null && !db.globalFolders.find(f => f.id === parent_id))
    return res.status(404).json({ error: 'Родительская папка не найдена' })
  const siblings = db.globalFolders.filter(f => (f.parent_id ?? null) === (parent_id ?? null))
  const folder = {
    id: nextId(db.globalFolders),
    name: String(name).trim(),
    parent_id: parent_id ?? null,
    order: siblings.length ? Math.max(...siblings.map(f => f.order || 0)) + 1 : 1
  }
  db.globalFolders.push(folder)
  saveDB(db)
  audit(req.user.id, req.user.username, 'tree_folder_create', { name: folder.name, parent_id: folder.parent_id })
  res.status(201).json(folder)
})

app.put('/api/admin/tree/folders/:fid', auth, adminOnly, (req, res) => {
  const folder = db.globalFolders.find(f => f.id === parseInt(req.params.fid))
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' })
  const { name, parent_id, move } = req.body
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'Название не может быть пустым' })
    folder.name = String(name).trim()
  }
  if (move) {
    const target = db.globalFolders.find(f => f.id === move.target_id)
    if (!target) return res.status(404).json({ error: 'Целевая папка не найдена' })
    if (target.id === folder.id || treeSubtreeIds(folder.id).has(target.id))
      return res.status(409).json({ error: 'Нельзя переместить папку относительно самой себя или её подпапки' })
    const newParent = target.parent_id ?? null
    const sibs = db.globalFolders
      .filter(f => (f.parent_id ?? null) === newParent && f.id !== folder.id)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    const idx = sibs.findIndex(f => f.id === target.id)
    sibs.splice(move.position === 'before' ? idx : idx + 1, 0, folder)
    sibs.forEach((f, i) => { f.order = i + 1 })
    folder.parent_id = newParent
  }
  if (parent_id !== undefined) {
    const target = parent_id ?? null
    if (target !== null) {
      if (!db.globalFolders.find(f => f.id === target))
        return res.status(404).json({ error: 'Целевая папка не найдена' })
      if (target === folder.id || treeSubtreeIds(folder.id).has(target))
        return res.status(409).json({ error: 'Нельзя переместить папку в саму себя или её подпапку' })
    }
    folder.parent_id = target
  }
  saveDB(db)
  res.json(folder)
})

app.delete('/api/admin/tree/folders/:fid', auth, adminOnly, (req, res) => {
  const fid = parseInt(req.params.fid)
  const folder = db.globalFolders.find(f => f.id === fid)
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' })
  // Содержимое поднимается к родителю
  for (const a of db.apis) if ((a.folder_id ?? null) === fid) a.folder_id = folder.parent_id
  for (const g of db.globalFolders) if (g.parent_id === fid) g.parent_id = folder.parent_id
  db.globalFolders = db.globalFolders.filter(g => g.id !== fid)
  saveDB(db)
  audit(req.user.id, req.user.username, 'tree_folder_delete', { name: folder.name })
  res.json({ ok: true })
})

app.put('/api/admin/apis/:id/folder', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const { folder_id } = req.body
  if (folder_id != null && !db.globalFolders.find(f => f.id === folder_id))
    return res.status(404).json({ error: 'Папка не найдена' })
  api.folder_id = folder_id ?? null
  saveDB(db)
  res.json({ ok: true, api_id: api.id, folder_id: api.folder_id })
})

// ── ADMIN: пользователи ──
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  res.json(db.users.map(u => {
    const perms = db.permissions.filter(p => p.user_id === u.id)
    return {
      id: u.id, username: u.username, email: u.email, fullName: u.fullName,
      is_admin: u.is_admin, created_at: u.created_at,
      api_access: perms.map(p => p.api_id),
      accesses: perms.map(p => ({
        api_id: p.api_id,
        folder_ids: p.folder_ids ?? null,
        endpoint_ids: p.endpoint_ids || []
      }))
    }
  }))
})

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { username, password, email, fullName, is_admin } = req.body
  if (db.users.find(u => u.username === username))
    return res.status(409).json({ error: 'Пользователь уже существует' })
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'Пароль должен быть не короче 8 символов' })
  const user = {
    id: nextId(db.users),
    username, password: bcrypt.hashSync(password, 10),
    email: email || '', fullName: fullName || '',
    is_admin: !!is_admin,
    created_at: new Date().toISOString()
  }
  db.users.push(user)
  saveDB(db)
  audit(req.user.id, req.user.username, 'user_create', { id: user.id, username: user.username, is_admin: user.is_admin })
  res.status(201).json({ id: user.id, username: user.username, email: user.email, fullName: user.fullName, is_admin: user.is_admin })
})

app.put('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id)
  const user = db.users.find(u => u.id === id)
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' })
  const { email, fullName, is_admin, password } = req.body
  if (email !== undefined) user.email = email
  if (fullName !== undefined) user.fullName = fullName
  if (is_admin !== undefined) user.is_admin = is_admin
  if (password) user.password = bcrypt.hashSync(password, 10)
  saveDB(db)
  res.json({ id: user.id, username: user.username, email: user.email, fullName: user.fullName, is_admin: user.is_admin })
})

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const id = parseInt(req.params.id)
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' })
  db.users = db.users.filter(u => u.id !== id)
  db.permissions = db.permissions.filter(p => p.user_id !== id)
  saveDB(db)
  audit(req.user.id, req.user.username, 'user_delete', { id })
  res.json({ ok: true })
})

// ── ADMIN: права ──
// Формат: { accesses: [{ api_id, folder_ids, endpoint_ids }] }
// folder_ids == null → полный доступ к API; endpoint_ids — отдельные эндпоинты
// Обратная совместимость: { api_ids: [...] } → полный доступ к перечисленным API
app.put('/api/admin/users/:id/permissions', auth, adminOnly, (req, res) => {
  const userId = parseInt(req.params.id)
  if (!db.users.find(u => u.id === userId)) return res.status(404).json({ error: 'Пользователь не найден' })
  const { accesses, api_ids } = req.body
  db.permissions = db.permissions.filter(p => p.user_id !== userId)
  if (Array.isArray(accesses)) {
    for (const acc of accesses) {
      if (!acc || !db.apis.find(a => a.id === acc.api_id)) continue
      db.permissions.push({
        user_id: userId,
        api_id: acc.api_id,
        folder_ids: Array.isArray(acc.folder_ids) ? acc.folder_ids : null,
        endpoint_ids: Array.isArray(acc.endpoint_ids) ? acc.endpoint_ids : []
      })
    }
  } else if (Array.isArray(api_ids)) {
    for (const apiId of api_ids) db.permissions.push({ user_id: userId, api_id: apiId, folder_ids: null, endpoint_ids: [] })
  }
  saveDB(db)
  const target = db.users.find(u => u.id === userId)
  audit(req.user.id, req.user.username, 'permissions_set', { target: target?.username, accesses: db.permissions.filter(p => p.user_id === userId).length })
  res.json({
    user_id: userId,
    accesses: db.permissions
      .filter(p => p.user_id === userId)
      .map(p => ({ api_id: p.api_id, folder_ids: p.folder_ids ?? null, endpoint_ids: p.endpoint_ids || [] }))
  })
})

app.get('/api/admin/users/:id/permissions', auth, adminOnly, (req, res) => {
  const userId = parseInt(req.params.id)
  res.json({
    user_id: userId,
    accesses: db.permissions
      .filter(p => p.user_id === userId)
      .map(p => ({ api_id: p.api_id, folder_ids: p.folder_ids ?? null, endpoint_ids: p.endpoint_ids || [] }))
  })
})

// ── Песочница: прокси тестовых запросов к внешнему API ──
app.post('/api/try', auth, async (req, res) => {
  if (!rateLimit(`try:${req.user.id}`, 30, 60000))
    return res.status(429).json({ error: 'Слишком много запросов из песочницы. Подождите минуту.' })
  const { api_id, method, path: epPath, query, headers, body } = req.body
  const user = db.users.find(u => u.id === req.user.id)
  const api = db.apis.find(a => a.id === api_id)
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  if (!user.is_admin) {
    const hasAccess = db.permissions.some(p => p.user_id === user.id && p.api_id === api_id)
    if (!hasAccess) return res.status(403).json({ error: 'Нет доступа к этому API' })
  }

  const m = String(method || 'get').toLowerCase()
  if (!['get', 'post', 'put', 'delete', 'patch'].includes(m))
    return res.status(400).json({ error: 'Недопустимый метод' })
  if (typeof epPath !== 'string' || !epPath.startsWith('/'))
    return res.status(400).json({ error: 'Путь должен начинаться с символа /' })

  const base = String(api.server_url || '').replace(/\/+$/, '')
  if (!base) return res.status(400).json({ error: 'У API не задан server_url' })

  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) {
    if (k && v !== '' && v != null) qs.append(k, String(v))
  }
  const url = base + epPath + (qs.toString() ? '?' + qs.toString() : '')

  const safeHeaders = {}
  for (const [k, v] of Object.entries(headers || {})) {
    if (k && v !== '' && v != null) safeHeaders[String(k)] = String(v)
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const resp = await fetch(url, {
      method: m.toUpperCase(),
      headers: safeHeaders,
      body: (m === 'get' || m === 'head') ? undefined : (body || undefined),
      signal: controller.signal
    })
    const respHeaders = {}
    resp.headers.forEach((v, k) => { respHeaders[k] = v })
    let text = await resp.text()
    const truncated = text.length > 200000
    if (truncated) text = text.slice(0, 200000) + '\n…(обрезано)'
    res.json({
      status: resp.status,
      status_text: resp.statusText,
      duration_ms: Date.now() - started,
      headers: respHeaders,
      body: text,
      truncated
    })
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'превышен таймаут 15 с' : (e.cause?.code || e.message)
    res.status(502).json({ error: `Запрос не выполнен: ${msg}`, duration_ms: Date.now() - started })
  } finally {
    clearTimeout(timer)
  }
})

// ── Избранное пользователя ──
app.put('/api/me/favorites', auth, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id)
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' })
  const items = Array.isArray(req.body.items)
    ? req.body.items.filter(x => x && typeof x.api_id === 'number' && typeof x.ep_id === 'number').slice(0, 200)
    : []
  user.favorites = items
  saveDB(db)
  res.json({ favorites: items })
})

// ── Заметка к эндпоинту (админ) ──
app.put('/api/admin/apis/:id/endpoints/:epId/note', auth, adminOnly, (req, res) => {
  const api = db.apis.find(a => a.id === parseInt(req.params.id))
  if (!api) return res.status(404).json({ error: 'API не найдено' })
  const ep = (api.endpoints || []).find(e => e.id === parseInt(req.params.epId))
  if (!ep) return res.status(404).json({ error: 'Эндпоинт не найден' })
  ep.note = String(req.body.note || '').slice(0, 4000)
  saveDB(db)
  audit(req.user.id, req.user.username, 'endpoint_note', { api: api.name, path: ep.path, len: ep.note.length })
  res.json({ ok: true, note: ep.note })
})

// ── Аудит: журнал действий ──
app.get('/api/admin/audit', auth, adminOnly, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500)
  try {
    const r = await pool.query(
      'SELECT id, ts, user_id, username, action, details FROM audit_log ORDER BY id DESC LIMIT $1', [limit])
    res.json(r.rows)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── ADMIN: парсинг .docx → OpenAPI JSON ──
app.post('/api/admin/parse-docx', auth, adminOnly, (req, res) => {
  const { data_base64, filename } = req.body
  if (!data_base64) return res.status(400).json({ error: 'Файл не передан' })
  let buffer
  try {
    buffer = Buffer.from(data_base64, 'base64')
  } catch {
    return res.status(400).json({ error: 'Некорректный base64' })
  }
  let xml
  try {
    xml = readZipEntry(buffer, 'word/document.xml')
  } catch (e) {
    return res.status(400).json({ error: 'Не удалось прочитать docx: ' + e.message })
  }
  if (!xml) return res.status(400).json({ error: 'Это не .docx (нет word/document.xml)' })
  try {
    const spec = parseDocxSpec(xml, String(filename || '').replace(/\.docx$/i, ''))
    const nPaths = Object.keys(spec.paths).length
    if (!nPaths) return res.status(422).json({ error: 'В документе не найдено описание сервисов (таблицы «URL endpoint»)' })
    res.json(spec)
  } catch (e) {
    res.status(422).json({ error: 'Ошибка парсинга: ' + e.message })
  }
})

// ── Swagger UI (локальные ассеты из node_modules/swagger-ui-dist) ──
import { createRequire } from 'module'
const require_ = createRequire(import.meta.url)

const SWAGGER_DIR = (() => {
  try { return require_.resolve('swagger-ui-dist/swagger-ui.css').replace(/\\[^\\]+$/, '') } catch { return null }
})()

if (SWAGGER_DIR) {
  app.use('/apidocs/assets', express.static(SWAGGER_DIR))
  app.get('/apidocs/:apiId', (req, res) => {
    const apiId = parseInt(req.params.apiId)
    const api = db.apis.find(a => a.id === apiId)
    const title = api ? `${api.title || api.name} — Swagger UI` : 'Swagger UI'
    res.type('html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/apidocs/assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="/apidocs/assets/swagger-ui-bundle.js"></script>
<script>
const params = new URLSearchParams(location.search)
SwaggerUIBundle({
  url: '/api/apis/${apiId}/spec?token=' + encodeURIComponent(params.get('token') || ''),
  dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: true,
  tryItOutEnabled: false, supportedSubmitMethods: []
})
</script></body></html>`)
  })
}

// ── Production: раздача собранного фронтенда (dist/) одним портом ──
const DIST_DIR = join(__dirname, 'dist')
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  // SPA fallback: всё, кроме /api и /apidocs
  app.get(/^\/(?!api\/|apidocs\/).*/, (req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'))
  })
}

// ── Старт ──
app.listen(PORT, () => {
  console.log(`🚀 API Портал сервер: http://localhost:${PORT}`)
  console.log(`   Фронтенд (vite):  http://localhost:5180`)
})
