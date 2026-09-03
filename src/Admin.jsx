import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getApis, getApi, createApi, deleteApi, updateApi, setEndpointNames,
  getUsers, createUser, updateUser, deleteUser,
  setUserAccesses, parseDocx, getAudit
} from './api.js'
import RuleModal from './RuleModal.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import Highlight from './Highlight.jsx'
import useFocusTrap from './useFocusTrap.js'
import { AdminSkeleton } from './Skeletons.jsx'
import { toast } from './toast.js'

/* ── Универсальная модалка (focus-trap + Esc + ARIA) ── */
function Modal({ title, onClose, children }) {
  const ref = useFocusTrap(true)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal admin-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const SECTIONS = [
  { id: 'dashboard', label: 'Обзор', icon: '📊' },
  { id: 'apis', label: 'API', icon: '📄' },
  { id: 'users', label: 'Пользователи', icon: '👥' },
  { id: 'perms', label: 'Права доступа', icon: '🔑' },
  { id: 'audit', label: 'Журнал', icon: '📜' },
]

/* Секция из URL: /admin, /admin/users, … */
function sectionFromPath() {
  if (!window.location.pathname.startsWith('/admin')) return 'dashboard'
  const m = window.location.pathname.match(/^\/admin\/?(\w*)/)
  const s = m?.[1]
  return SECTIONS.some(x => x.id === s) ? s : 'dashboard'
}

export default function Admin() {
  const [section, setSection] = useState(sectionFromPath)
  const [apis, setApis] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingAction, setPendingAction] = useState(null) // 'addApi' | 'addUser' — быстрое действие с Обзора

  const load = useCallback(async () => {
    try {
      const [a, u] = await Promise.all([getApis(), getUsers()])
      setApis(a); setUsers(u)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const goSection = useCallback((s) => {
    setSection(s)
    const path = s === 'dashboard' ? '/admin' : `/admin/${s}`
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
  }, [])

  // Кнопки «назад/вперёд» браузера по секциям админки
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname.startsWith('/admin')) setSection(sectionFromPath())
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const quickAction = (s, action) => {
    setPendingAction(action)
    goSection(s)
  }

  return (
    <div className="admin-layout">
      <aside className="admin-nav">
        <div className="admin-nav-brand">⚙️ Админ-панель</div>
        <div className="admin-nav-items">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`admin-nav-item ${section === s.id ? 'active' : ''}`}
              onClick={() => goSection(s.id)}
            >
              <span className="icon">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="admin-content">
        {error && <div className="error-box" onClick={() => setError('')}>{error}</div>}
        {loading && !apis.length && !users.length ? (
          <AdminSkeleton />
        ) : (
          <>
            {section === 'dashboard' && <Dashboard apis={apis} users={users} onGo={goSection} onQuick={quickAction} />}
            {section === 'apis' && <ApisSection apis={apis} reload={load} autoAdd={pendingAction === 'addApi'} clearAuto={() => setPendingAction(null)} />}
            {section === 'users' && <UsersSection users={users} reload={load} autoAdd={pendingAction === 'addUser'} clearAuto={() => setPendingAction(null)} />}
            {section === 'perms' && <PermsSection />}
            {section === 'audit' && <AuditSection />}
          </>
        )}
      </main>
    </div>
  )
}

/* ═══════════ ЖУРНАЛ ДЕЙСТВИЙ: общие хелперы ═══════════ */
const AUDIT_LABELS = {
  login: 'Вход', login_failed: 'Неудачный вход',
  api_create: 'Создан API', api_update: 'Изменён API', api_delete: 'Удалён API',
  folder_create: 'Создана папка', folder_update: 'Изменена папка', folder_delete: 'Удалена папка',
  tree_folder_create: 'Создана корневая папка', tree_folder_delete: 'Удалена корневая папка',
  user_create: 'Создан пользователь', user_delete: 'Удалён пользователь',
  permissions_set: 'Изменены права', endpoint_names: 'Названия эндпоинтов', endpoint_note: 'Заметка к эндпоинту'
}

const FIELD_LABELS = {
  ip: 'IP', id: 'ID', name: 'название', endpoints: 'эндпоинтов', api: 'API',
  username: 'логин', is_admin: 'админ', target: 'кому', accesses: 'доступов',
  changed: 'изменено', path: 'путь', len: 'длина', parent_id: 'родитель'
}

const actionIcon = (a) => {
  if (a === 'login') return '🔓'
  if (a === 'login_failed') return '⛔'
  if (a.includes('delete')) return '🗑'
  if (a.endsWith('_create')) return '✨'
  if (a.startsWith('permissions')) return '🔑'
  if (a.startsWith('endpoint')) return '🔌'
  if (a.startsWith('user')) return '👤'
  return '📝'
}

const prettyDetails = (d) => {
  if (!d || Object.keys(d).length === 0) return ''
  return Object.entries(d)
    .map(([k, v]) => `${FIELD_LABELS[k] || k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ')
}

const fmtTs = (ts) => {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return String(ts) }
}

const fmtTimeShort = (ts) => {
  try { return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
  catch { return String(ts) }
}

const relTime = (ts) => {
  try {
    const diff = Date.now() - new Date(ts).getTime()
    if (diff < 60e3) return 'только что'
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)} мин назад`
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)} ч назад`
    if (diff < 7 * 86400e3) return `${Math.floor(diff / 86400e3)} дн назад`
    return new Date(ts).toLocaleDateString('ru-RU')
  } catch { return '' }
}

const dayLabel = (ts) => {
  try {
    const d = new Date(ts)
    const today = new Date()
    const yest = new Date(Date.now() - 86400e3)
    if (d.toDateString() === today.toDateString()) return 'Сегодня'
    if (d.toDateString() === yest.toDateString()) return 'Вчера'
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch { return '' }
}

const AUDIT_GROUPS = [
  { id: 'all', label: 'Все', match: () => true },
  { id: 'login', label: 'Входы', match: a => a === 'login' || a === 'login_failed' },
  { id: 'apis', label: 'API и папки', match: a => a.startsWith('api_') || a.startsWith('folder_') || a.startsWith('tree_folder') || a.startsWith('endpoint') },
  { id: 'users', label: 'Пользователи', match: a => a.startsWith('user_') },
  { id: 'perms', label: 'Права', match: a => a === 'permissions_set' },
  { id: 'danger', label: 'Удаления и ошибки', match: a => a.includes('delete') || a.includes('failed') },
]

/* ═══════════ ЖУРНАЛ ДЕЙСТВИЙ ═══════════ */
function AuditSection() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('all')

  const load = useCallback(async () => {
    try { setRows(await getAudit(300)) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const f = q.trim().toLowerCase()
  const g = AUDIT_GROUPS.find(x => x.id === group) || AUDIT_GROUPS[0]
  const filtered = (rows || []).filter(r => g.match(r.action) && (!f ||
    (r.username || '').toLowerCase().includes(f) ||
    (AUDIT_LABELS[r.action] || r.action).toLowerCase().includes(f) ||
    JSON.stringify(r.details || {}).toLowerCase().includes(f)))

  const exportCsv = () => {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['ID', 'Время', 'Пользователь', 'Действие', 'Детали']
    const body = filtered.map(r => [
      r.id,
      new Date(r.ts).toISOString(),
      r.username || '',
      AUDIT_LABELS[r.action] || r.action,
      prettyDetails(r.details) || JSON.stringify(r.details || {})
    ])
    const csv = '\uFEFF' + [head, ...body].map(r => r.map(esc).join(';')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`Экспортировано записей: ${filtered.length}`, 'success')
  }

  let lastDay = null

  return (
    <>
      <div className="admin-content-head">
        <h2>Журнал действий <span className="count-chip">{rows?.length ?? '…'}</span></h2>
        <div className="spacer" />
        <div className="admin-search">
          <span className="search-ico">🔍</span>
          <input placeholder="Поиск по журналу…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn-secondary csv-btn" onClick={exportCsv} disabled={!rows?.length} title="Экспорт в CSV">⬇ CSV</button>
      </div>

      <div className="chips" role="tablist" aria-label="Фильтр по типу события">
        {AUDIT_GROUPS.map(g2 => (
          <button
            key={g2.id}
            className={`chip ${group === g2.id ? 'active' : ''}`}
            onClick={() => setGroup(g2.id)}
          >
            {g2.label}
          </button>
        ))}
      </div>

      {error && <div className="error-box" onClick={() => setError('')}>{error}</div>}
      {rows === null ? (
        <div className="card" style={{ padding: 20 }}>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skel skel-row" style={{ marginBottom: 14, width: `${90 - i * 7}%` }} />)}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr><th>Время</th><th>Пользователь</th><th>Действие</th><th>Детали</th></tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const day = new Date(r.ts).toDateString()
                const newDay = day !== lastDay
                lastDay = day
                return (
                  <React.Fragment key={r.id}>
                    {newDay && (
                      <tr className="audit-day"><td colSpan={4}>{dayLabel(r.ts)}</td></tr>
                    )}
                    <tr>
                      <td style={{ whiteSpace: 'nowrap' }} title={fmtTs(r.ts)}>
                        {fmtTimeShort(r.ts)}
                        <span className="rel">{relTime(r.ts)}</span>
                      </td>
                      <td><b><Highlight text={r.username || '—'} query={q} /></b></td>
                      <td>
                        <span className={`pill ${r.action.includes('failed') || r.action.includes('delete') ? 'pill-folders' : 'pill-version'}`}>
                          <Highlight text={AUDIT_LABELS[r.action] || r.action} query={q} />
                        </span>
                      </td>
                      <td className="audit-details">
                        <Highlight text={prettyDetails(r.details) || '—'} query={q} />
                      </td>
                    </tr>
                  </React.Fragment>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={4} className="am-empty">Записей нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ═══════════ ОБЗОР ═══════════ */
function Dashboard({ apis, users, onGo, onQuick }) {
  const totalEps = apis.reduce((s, a) => s + (a.endpoint_count || 0), 0)
  const admins = users.filter(u => u.is_admin).length
  const [auditRows, setAuditRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    getAudit(8)
      .then(r => { if (!cancelled) setAuditRows(r) })
      .catch(() => { if (!cancelled) setAuditRows([]) })
    return () => { cancelled = true }
  }, [])

  const stats = [
    { icon: '📄', label: 'API', value: apis.length, color: 'blue', go: 'apis' },
    { icon: '🔌', label: 'Эндпоинтов всего', value: totalEps, color: 'green' },
    { icon: '👥', label: 'Пользователей', value: users.length, color: 'purple', go: 'users' },
    { icon: '⭐', label: 'Администраторов', value: admins, color: 'orange', go: 'users' },
  ]

  return (
    <>
      <div className="admin-content-head">
        <h2>Обзор</h2>
        <div className="spacer" />
        <button className="btn-secondary" onClick={() => onQuick('apis', 'addApi')}>＋ Добавить API</button>
        <button className="btn-secondary" onClick={() => onQuick('users', 'addUser')}>＋ Добавить пользователя</button>
      </div>
      <div className="stat-grid">
        {stats.map((s, i) => (
          <div
            key={i}
            className={`stat-card ${s.color} ${s.go ? 'clickable' : ''}`}
            onClick={() => s.go && onGo(s.go)}
          >
            <div className="stat-icon">{s.icon}</div>
            <div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="card">
          <div className="card-title">API</div>
          <div className="dash-list">
            {apis.length === 0 && <p className="muted">Пока нет ни одного API</p>}
            {apis.slice(0, 6).map(a => (
              <div className="dash-row" key={a.id}>
                <span className="dash-row-icon">📄</span>
                <div className="dash-row-main">
                  <b>{a.title}</b>
                  <span className="muted">{a.name}</span>
                </div>
                <span className="pill pill-endpoints">{a.endpoint_count} эп.</span>
              </div>
            ))}
            {apis.length > 6 && <p className="muted" style={{ marginTop: 8 }}>и ещё {apis.length - 6}…</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Пользователи</div>
          <div className="dash-list">
            {users.length === 0 && <p className="muted">Пользователей нет</p>}
            {users.slice(0, 6).map(u => (
              <div className="dash-row" key={u.id}>
                <div className="avatar small">{(u.fullName || u.username).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                <div className="dash-row-main">
                  <b>{u.fullName || u.username}</b>
                  <span className="muted">{u.username}</span>
                </div>
                {u.is_admin && <span className="pill-admin">админ</span>}
              </div>
            ))}
            {users.length > 6 && <p className="muted" style={{ marginTop: 8 }}>и ещё {users.length - 6}…</p>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Последние действия
          <button className="link-btn" onClick={() => onGo('audit')}>весь журнал →</button>
        </div>
        <div className="dash-list">
          {auditRows === null && <p className="muted">Загрузка…</p>}
          {auditRows?.length === 0 && <p className="muted">Событий пока нет</p>}
          {auditRows?.map(r => (
            <div className="dash-row" key={r.id}>
              <span className="dash-row-icon">{actionIcon(r.action)}</span>
              <div className="dash-row-main">
                <b>{AUDIT_LABELS[r.action] || r.action}</b>
                <span className="muted">
                  {r.username || '—'}{prettyDetails(r.details) ? ` · ${prettyDetails(r.details)}` : ''}
                </span>
              </div>
              <span className="muted" style={{ whiteSpace: 'nowrap' }} title={fmtTs(r.ts)}>{relTime(r.ts)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* ═══════════ API ═══════════ */
function ApisSection({ apis, reload, autoAdd, clearAuto }) {
  const [showModal, setShowModal] = useState(false)
  const [error, setError] = useState('')
  const [docxMsg, setDocxMsg] = useState('')
  const [parsing, setParsing] = useState(false)
  const [specMode, setSpecMode] = useState('text')        // 'text' | 'file'
  const [specFileInfo, setSpecFileInfo] = useState('')
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState(null)
  const now = new Date()
  const defaultVersion = `${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`
  const emptyForm = {
    name: '', title: '', version: defaultVersion, description: '',
    server_url: '', swagger_url: '', specJson: ''
  }
  const [form, setForm] = useState(emptyForm)

  // ── Настройки существующего API ──
  const [settings, setSettings] = useState(null)   // { api: full, fields: {...}, names: [{id, path, summary}] }
  const [settingsSaving, setSettingsSaving] = useState(false)

  const openSettings = async (light) => {
    setError('')
    try {
      const full = await getApi(light.id)
      setSettings({
        api: full,
        fields: {
          name: full.name || '', title: full.title || '', version: full.version || '',
          server_url: full.server_url || '', swagger_url: full.swagger_url || '',
          description: full.description || ''
        },
        names: (full.endpoints || []).map(e => ({ id: e.id, path: e.path, method: e.method, summary: e.summary || '' }))
      })
    } catch (e) { setError(e.message) }
  }

  const saveSettings = async (e) => {
    e.preventDefault()
    if (!settings) return
    setSettingsSaving(true); setError('')
    try {
      const f = settings.fields
      await updateApi(settings.api.id, {
        name: f.name, title: f.title, version: f.version,
        server_url: f.server_url, swagger_url: f.swagger_url, description: f.description
      })
      const changedNames = settings.names
        .map(n => ({ id: n.id, summary: n.summary }))
        .filter(n => {
          const orig = (settings.api.endpoints || []).find(x => x.id === n.id)
          return orig && (orig.summary || '') !== n.summary
        })
      if (changedNames.length) {
        await setEndpointNames(settings.api.id, changedNames)
      }
      toast(`Настройки API сохранены${changedNames.length ? ` (названий: ${changedNames.length})` : ''}`, 'success')
      setSettings(null)
      reload()
    } catch (err) { setError(err.message) }
    finally { setSettingsSaving(false) }
  }

  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const fmtVersion = (v) => {
    const s = String(v)
    if (/^\d{2}\.\d{4}$/.test(s)) return s
    if (/^\d{4}$/.test(s)) return `${s} г.`
    return `v${s}`
  }

  const openModal = () => {
    setForm({ ...emptyForm })
    setDocxMsg(''); setSpecFileInfo(''); setError('')
    setSpecMode('text')
    setShowModal(true)
  }

  // Быстрое действие с Обзора — открыть модалку создания
  useEffect(() => {
    if (autoAdd) { openModal(); clearAuto() }
  }, [autoAdd]) // eslint-disable-line

  // Загрузка .docx → парсинг → автозаполнение
  const onDocx = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParsing(true); setDocxMsg(''); setError('')
    try {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result).split(',')[1])
        fr.onerror = () => reject(new Error('Не удалось прочитать файл'))
        fr.readAsDataURL(file)
      })
      const spec = await parseDocx(b64, file.name)
      const nPaths = Object.keys(spec.paths || {}).length
      const nSchemas = Object.keys(spec.components?.schemas || {}).length
      const slug = file.name.replace(/\.docx$/i, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'imported-api'
      // Версия: ММ.ГГГГ или год из имени файла, иначе из спеки
      const mm = file.name.match(/(\d{2})\.(20\d{2})/)
      const yearMatch = file.name.match(/(20\d{2})/)
      setForm(f => ({
        ...f,
        name: slug,
        title: spec.info?.title || f.title || slug,
        version: mm ? `${mm[1]}.${mm[2]}` : (yearMatch ? yearMatch[1] : (spec.info?.version || f.version)),
        description: spec.info?.description || '',
        specJson: JSON.stringify(spec, null, 2)
      }))
      setDocxMsg(`Распарсено: ${nPaths} путей, ${nSchemas} схем`)
    } catch (err) {
      setError('Ошибка парсинга: ' + err.message)
    } finally {
      setParsing(false)
      e.target.value = ''
    }
  }

  // Загрузка OpenAPI JSON файлом
  const onSpecFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(''); setSpecFileInfo('')
    try {
      const text = await file.text()
      const spec = JSON.parse(text)
      setForm(f => ({ ...f, specJson: JSON.stringify(spec, null, 2) }))
      setSpecFileInfo(`Загружено: ${file.name} (${Object.keys(spec.paths || {}).length} путей)`)
    } catch (err) {
      setError('Файл не является валидным JSON: ' + err.message)
    } finally {
      e.target.value = ''
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      let groups = {}
      if (form.specJson.trim()) {
        const spec = JSON.parse(form.specJson)
        for (const [path, methods] of Object.entries(spec.paths || {})) {
          for (const [method, detail] of Object.entries(methods)) {
            if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue
            const tags = detail.tags || ['Без категории']
            for (const tag of tags) {
              if (!groups[tag]) groups[tag] = []
              groups[tag].push({
                method: method.toUpperCase(),
                path,
                summary: detail.summary || '',
                description: detail.description || '',
                parameters: detail.parameters || [],
                requestBody: detail.requestBody || null,
                responses: detail.responses || {}
              })
            }
          }
        }
      }
      await createApi({
        name: form.name,
        title: form.title || form.name,
        version: form.version,
        description: form.description,
        server_url: form.server_url,
        swagger_url: form.swagger_url,
        groups
      })
      setShowModal(false)
      setForm(emptyForm)
      setDocxMsg('')
      toast('API создан', 'success')
      reload()
    } catch (err) { setError(err.message) }
  }

  const remove = (a) => setConfirm({
    title: `Удалить API «${a.title}»?`,
    message: 'Права пользователей на него тоже будут удалены. Действие необратимо.',
    onConfirm: async () => {
      setConfirm(null)
      try { await deleteApi(a.id); toast('API удалён', 'success'); reload() } catch (e) { setError(e.message) }
    }
  })

  const f = q.trim().toLowerCase()
  const filtered = apis.filter(a => !f ||
    a.name?.toLowerCase().includes(f) ||
    a.title?.toLowerCase().includes(f) ||
    a.server_url?.toLowerCase().includes(f))
  const hl = (text) => (f ? <Highlight text={text} query={q} /> : text)

  return (
    <>
      <div className="admin-content-head">
        <h2>API <span className="count-chip">{apis.length}</span></h2>
        <div className="spacer" />
        <div className="admin-search">
          <span className="search-ico">🔍</span>
          <input placeholder="Поиск по названию, имени, серверу…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={openModal}>＋ Добавить API</button>
      </div>

      <div className="api-grid">
        {filtered.map(a => (
          <div key={a.id} className="api-card">
            <div className="api-card-top">
              <div className="api-card-icon">📄</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <a
                  className="icon-btn"
                  title="Открыть в портале"
                  href={`/apis/${a.id}`}
                  onClick={e => e.stopPropagation()}
                >
                  ↗
                </a>
                <button className="icon-btn" title="Настройки API" onClick={() => openSettings(a)}>✏️</button>
                <button className="icon-btn danger" title="Удалить" onClick={() => remove(a)}>🗑</button>
              </div>
            </div>
            <div className="api-card-title">{hl(a.title)}</div>
            <code className="api-card-name">{hl(a.name)}</code>
            <div className="api-card-meta">
              <span className="pill pill-version">{fmtVersion(a.version)}</span>
              <span className="pill pill-endpoints">{a.endpoint_count} эп.</span>
              {!!a.folder_count && <span className="pill pill-folders">{a.folder_count} папок</span>}
            </div>
            {a.server_url && (
              <div className="api-card-server" title={a.server_url}><code>{hl(a.server_url)}</code></div>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            <div className="empty-icon">📄</div>
            <h2>{f ? 'Ничего не найдено' : 'Нет API'}</h2>
            <p>{f ? 'Попробуйте изменить запрос' : 'Создайте первое API — вручную или загрузив .docx-спецификацию'}</p>
          </div>
        )}
      </div>

      {showModal && (
        <Modal title="Новый API" onClose={() => { setShowModal(false); setDocxMsg(''); setError('') }}>
          <form onSubmit={submit}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-row docx-upload-row">
              <label>Спецификация из .docx</label>
              <div className="docx-upload">
                <input type="file" accept=".docx" onChange={onDocx} disabled={parsing} />
                {parsing && <span className="muted">Парсинг…</span>}
                {docxMsg && <span className="docx-ok">{docxMsg}</span>}
              </div>
            </div>
            <div className="form-cols">
              <div className="form-row">
                <label>Имя (slug)</label>
                <input value={form.name} onChange={upd('name')} placeholder="my-api" required />
              </div>
              <div className="form-row">
                <label>Версия (ММ.ГГГГ)</label>
                <input value={form.version} onChange={upd('version')} placeholder="09.2026" />
              </div>
            </div>
            <div className="form-row">
              <label>Название</label>
              <input value={form.title} onChange={upd('title')} placeholder="My API" />
            </div>
            <div className="form-row">
              <label>URL сервера</label>
              <input value={form.server_url} onChange={upd('server_url')} placeholder="https://api.example.com" />
            </div>
            <div className="form-row">
              <label>Swagger UI URL</label>
              <input value={form.swagger_url} onChange={upd('swagger_url')} placeholder="/swagger.html" />
            </div>
            <div className="form-row">
              <label>Описание</label>
              <textarea value={form.description} onChange={upd('description')} rows={2} />
            </div>
            <div className="form-row">
              <label>OpenAPI JSON</label>
              <div className="spec-source">
                <div className="seg">
                  <button type="button" className={specMode === 'text' ? 'active' : ''} onClick={() => setSpecMode('text')}>Текст</button>
                  <button type="button" className={specMode === 'file' ? 'active' : ''} onClick={() => setSpecMode('file')}>Файл .json</button>
                </div>
                {specMode === 'text' ? (
                  <textarea
                    value={form.specJson} onChange={upd('specJson')} rows={7}
                    placeholder='{"openapi":"3.0.3","paths":{...}}'
                    className="code-input"
                  />
                ) : (
                  <div className="docx-upload">
                    <input type="file" accept=".json,application/json" onChange={onSpecFile} />
                    {specFileInfo && <span className="docx-ok">{specFileInfo}</span>}
                  </div>
                )}
              </div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Отмена</button>
              <button type="submit" className="btn-primary">Создать API</button>
            </div>
          </form>
        </Modal>
      )}

      {settings && (
        <Modal title={`Настройки — ${settings.api.name}`} onClose={() => setSettings(null)}>
          <form onSubmit={saveSettings}>
            {error && <div className="error-box">{error}</div>}
            <div className="form-cols">
              <div className="form-row">
                <label>Имя (slug)</label>
                <input value={settings.fields.name} required
                  onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, name: e.target.value } }))} />
              </div>
              <div className="form-row">
                <label>Версия (ММ.ГГГГ)</label>
                <input value={settings.fields.version}
                  onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, version: e.target.value } }))} />
              </div>
            </div>
            <div className="form-row">
              <label>Название</label>
              <input value={settings.fields.title}
                onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, title: e.target.value } }))} />
            </div>
            <div className="form-cols">
              <div className="form-row">
                <label>URL сервера</label>
                <input value={settings.fields.server_url}
                  onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, server_url: e.target.value } }))} />
              </div>
              <div className="form-row">
                <label>Swagger UI URL</label>
                <input value={settings.fields.swagger_url}
                  onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, swagger_url: e.target.value } }))} />
              </div>
            </div>
            <div className="form-row">
              <label>Описание</label>
              <textarea rows={2} value={settings.fields.description}
                onChange={e => setSettings(s => ({ ...s, fields: { ...s.fields, description: e.target.value } }))} />
            </div>

            <div className="form-row">
              <label>Названия эндпоинтов <span className="muted">(режим имён «Aa» в сайдбаре портала)</span></label>
              <div className="names-editor">
                {settings.names.map((n, i) => (
                  <div className="names-row" key={n.id}>
                    <span className={`badge ${String(n.method).toLowerCase()}`}>{n.method}</span>
                    <span className="names-path" title={n.path}>{n.path}</span>
                    <input
                      value={n.summary}
                      placeholder="Человекочитаемое название…"
                      onChange={e => setSettings(s => {
                        const names = [...s.names]
                        names[i] = { ...names[i], summary: e.target.value }
                        return { ...s, names }
                      })}
                    />
                  </div>
                ))}
                {settings.names.length === 0 && <p className="muted">В API нет эндпоинтов</p>}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setSettings(null)}>Отмена</button>
              <button type="submit" className="btn-primary" disabled={settingsSaving}>
                {settingsSaving ? 'Сохранение…' : '💾 Сохранить'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </>
  )
}

/* ═══════════ ПОЛЬЗОВАТЕЛИ ═══════════ */
function genPassword() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*'
  const arr = new Uint32Array(16)
  crypto.getRandomValues(arr)
  let s = ''
  for (let i = 0; i < 16; i++) s += chars[arr[i] % chars.length]
  return s
}

/* Поле пароля: генерация 🎲 + показ 👁 */
function PwField({ value, onValue, placeholder, required }) {
  const [show, setShow] = useState(false)
  return (
    <div className="pw-field">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onValue(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="new-password"
      />
      <button type="button" className="pw-btn" title="Сгенерировать надёжный пароль"
        onClick={() => { onValue(genPassword()); setShow(true) }}>
        🎲
      </button>
      <button type="button" className="pw-btn" title={show ? 'Скрыть пароль' : 'Показать пароль'}
        onClick={() => setShow(s => !s)}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  )
}

function UsersSection({ users, reload, autoAdd, clearAuto }) {
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [sort, setSort] = useState('name')
  const [confirm, setConfirm] = useState(null)
  const [logins, setLogins] = useState(null) // последний вход: username → ts

  // Последний вход каждого пользователя — из журнала
  useEffect(() => {
    let cancelled = false
    getAudit(300)
      .then(rows => {
        if (cancelled) return
        const m = new Map()
        for (const r of rows) {
          if (r.action === 'login' && r.username && !m.has(r.username)) m.set(r.username, r.ts)
        }
        setLogins(m)
      })
      .catch(() => { if (!cancelled) setLogins(new Map()) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (autoAdd) { setAddOpen(true); clearAuto() }
  }, [autoAdd]) // eslint-disable-line

  const emptyAdd = { username: '', password: '', fullName: '', email: '', is_admin: false }
  const [addForm, setAddForm] = useState(emptyAdd)
  const [editForm, setEditForm] = useState({})

  const f = q.trim().toLowerCase()
  const filtered = users.filter(u =>
    !f ||
    u.username?.toLowerCase().includes(f) ||
    u.fullName?.toLowerCase().includes(f) ||
    u.email?.toLowerCase().includes(f)
  )
  const loginTs = (u) => {
    const ts = logins?.get(u.username)
    return ts ? new Date(ts).getTime() : 0
  }
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'name') return (a.fullName || a.username).localeCompare(b.fullName || b.username, 'ru')
    if (sort === 'name-desc') return (b.fullName || a.username).localeCompare(a.fullName || a.username, 'ru')
    if (sort === 'api-desc') return (b.api_access?.length || 0) - (a.api_access?.length || 0)
    if (sort === 'last-login') return loginTs(b) - loginTs(a)
    return 0
  })

  const addSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await createUser(addForm)
      setAddOpen(false)
      setAddForm(emptyAdd)
      toast('Пользователь создан', 'success')
      reload()
    } catch (err) { setError(err.message) }
  }

  const editSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const payload = { fullName: editForm.fullName, email: editForm.email, is_admin: editForm.is_admin }
      if (editForm.password) payload.password = editForm.password
      await updateUser(editUser.id, payload)
      setEditUser(null)
      toast('Изменения сохранены', 'success')
      reload()
    } catch (err) { setError(err.message) }
  }

  const toggleAdmin = async (u) => {
    try {
      await updateUser(u.id, { is_admin: !u.is_admin })
      toast(u.is_admin ? 'Права администратора сняты' : 'Выданы права администратора', 'success')
      reload()
    }
    catch (e) { setError(e.message) }
  }

  const remove = (u) => setConfirm({
    title: `Удалить пользователя «${u.username}»?`,
    message: 'Логин и все права доступа будут удалены безвозвратно.',
    onConfirm: async () => {
      setConfirm(null)
      try { await deleteUser(u.id); toast('Пользователь удалён', 'success'); reload() } catch (e) { setError(e.message) }
    }
  })

  const hl = (text) => (f ? <Highlight text={text} query={q} /> : text)

  return (
    <>
      <div className="admin-content-head">
        <h2>Пользователи <span className="count-chip">{users.length}</span></h2>
        <div className="spacer" />
        <select className="sort-select" value={sort} onChange={e => setSort(e.target.value)} aria-label="Сортировка">
          <option value="name">Имя А-Я</option>
          <option value="name-desc">Имя Я-А</option>
          <option value="api-desc">Больше API</option>
          <option value="last-login">Последний вход</option>
        </select>
        <div className="admin-search">
          <span className="search-ico">🔍</span>
          <input placeholder="Поиск по логину, имени, email…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>＋ Добавить пользователя</button>
      </div>

      {error && <div className="error-box" onClick={() => setError('')}>{error}</div>}

      <div className="user-list">
        {sorted.map(u => {
          const lastTs = logins?.get(u.username)
          return (
            <div key={u.id} className="user-row">
              <div className="avatar">{(u.fullName || u.username).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
              <div className="user-info">
                <div className="user-name-line">
                  <span>{hl(u.fullName || u.username)}</span>
                  <span
                    className={`pill-admin ${u.is_admin ? '' : 'off'}`}
                    title={u.is_admin ? 'Убрать права администратора' : 'Сделать администратором'}
                    onClick={() => toggleAdmin(u)}
                    style={{ cursor: 'pointer' }}
                  >
                    {u.is_admin ? '⭐ админ' : 'не админ'}
                  </span>
                </div>
                <div className="user-sub">
                  {hl(u.username)}{u.email ? ` · ${hl(u.email)}` : ''}
                  <span className="last-login" title={lastTs ? fmtTs(lastTs) : ''}>
                    {' · '}
                    {logins === null ? '' : (lastTs ? `вход: ${relTime(lastTs)}` : 'не входил')}
                  </span>
                </div>
              </div>
              <span className="pill-count" title="Доступных API">{u.api_access?.length || 0} API</span>
              <button className="icon-btn" title="Редактировать" onClick={() => {
                setEditForm({ fullName: u.fullName || '', email: u.email || '', is_admin: u.is_admin, password: '' })
                setEditUser(u)
              }}>✏️</button>
              <button className="icon-btn danger" title="Удалить" onClick={() => remove(u)}>🗑</button>
            </div>
          )
        })}
        {sorted.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            <h2>{f ? 'Ничего не найдено' : 'Нет пользователей'}</h2>
            <p>{f ? 'Попробуйте изменить запрос' : 'Добавьте первого пользователя'}</p>
          </div>
        )}
      </div>

      {addOpen && (
        <Modal title="Новый пользователь" onClose={() => setAddOpen(false)}>
          <form onSubmit={addSubmit}>
            <div className="form-cols">
              <div className="form-row">
                <label>Логин</label>
                <input value={addForm.username} required
                  onChange={e => setAddForm(f2 => ({ ...f2, username: e.target.value }))} />
              </div>
              <div className="form-row">
                <label>Пароль</label>
                <PwField value={addForm.password} required placeholder="Придумайте или сгенерируйте 🎲"
                  onValue={v => setAddForm(f2 => ({ ...f2, password: v }))} />
              </div>
            </div>
            <div className="form-row">
              <label>Полное имя</label>
              <input value={addForm.fullName}
                onChange={e => setAddForm(f2 => ({ ...f2, fullName: e.target.value }))} />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input type="email" value={addForm.email}
                onChange={e => setAddForm(f2 => ({ ...f2, email: e.target.value }))} />
            </div>
            <div className="form-row">
              <label className="checkbox-label">
                <input type="checkbox" checked={addForm.is_admin}
                  onChange={e => setAddForm(f2 => ({ ...f2, is_admin: e.target.checked }))} />
                Администратор (доступ ко всему)
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>Отмена</button>
              <button type="submit" className="btn-primary">Создать</button>
            </div>
          </form>
        </Modal>
      )}

      {editUser && (
        <Modal title={`Редактирование — ${editUser.username}`} onClose={() => setEditUser(null)}>
          <form onSubmit={editSubmit}>
            <div className="form-row">
              <label>Полное имя</label>
              <input value={editForm.fullName}
                onChange={e => setEditForm(f2 => ({ ...f2, fullName: e.target.value }))} />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input type="email" value={editForm.email}
                onChange={e => setEditForm(f2 => ({ ...f2, email: e.target.value }))} />
            </div>
            <div className="form-row">
              <label>Новый пароль <span className="muted">(оставьте пустым, чтобы не менять)</span></label>
              <PwField value={editForm.password} placeholder="••••••••"
                onValue={v => setEditForm(f2 => ({ ...f2, password: v }))} />
            </div>
            <div className="form-row">
              <label className="checkbox-label">
                <input type="checkbox" checked={editForm.is_admin}
                  onChange={e => setEditForm(f2 => ({ ...f2, is_admin: e.target.checked }))} />
                Администратор
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>Отмена</button>
              <button type="submit" className="btn-primary">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {confirm && <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />}
    </>
  )
}

/* ═══════════ ПРАВА ДОСТУПА ═══════════ */
function PermsSection() {
  const [users, setUsers] = useState([])
  const [apis, setApis] = useState([])          // полные данные (с folders)
  const [error, setError] = useState('')
  const [access, setAccess] = useState({})      // черновик: { [userId]: [{ api_id, folder_ids }] }
  const [orig, setOrig] = useState({})          // сохранённое состояние с сервера
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [copied, setCopied] = useState(null)    // userId — источник копирования прав
  const [collapsed, setCollapsed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('perms_collapsed') || '[]')) } catch { return new Set() }
  })

  const load = useCallback(async () => {
    try {
      const [u, light] = await Promise.all([getUsers(), getApis()])
      const full = await Promise.all(light.map(a => getApi(a.id)))
      setUsers(u); setApis(full)
      const m = {}
      u.forEach(usr => {
        m[usr.id] = (usr.accesses || []).map(a => ({
          api_id: a.api_id,
          folder_ids: Array.isArray(a.folder_ids) ? [...a.folder_ids] : null,
          endpoint_ids: Array.isArray(a.endpoint_ids) ? [...a.endpoint_ids] : []
        }))
      })
      setAccess(JSON.parse(JSON.stringify(m)))
      setOrig(JSON.parse(JSON.stringify(m)))
    } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const mutate = (userId, fn) => {
    setAccess(prev => {
      const list = [...(prev[userId] || [])]
      fn(list)
      return { ...prev, [userId]: list }
    })
  }

  const dirtyUsers = users.filter(u =>
    JSON.stringify(orig[u.id] || []) !== JSON.stringify(access[u.id] || []))
  const dirty = dirtyUsers.length > 0

  const save = async () => {
    setSaving(true); setError('')
    try {
      for (const u of dirtyUsers) {
        await setUserAccesses(u.id, access[u.id] || [])
      }
      const m = {}
      dirtyUsers.forEach(u => { m[u.id] = JSON.parse(JSON.stringify(access[u.id] || [])) })
      setOrig(prev => ({ ...prev, ...m }))
      toast('Права доступа сохранены', 'success')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => setAccess(JSON.parse(JSON.stringify(orig)))

  // Предупреждение при уходе со страницы с несохранёнными правами
  useEffect(() => {
    if (!dirty) return
    const h = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Правило создано в RuleModal (уже сохранено на сервере) — синхронизируем состояние
  const onRuleSaved = ({ userId, accesses }) => {
    setRuleOpen(false)
    setAccess(prev => ({ ...prev, [userId]: JSON.parse(JSON.stringify(accesses)) }))
    setOrig(prev => ({ ...prev, [userId]: JSON.parse(JSON.stringify(accesses)) }))
  }

  const toggleApi = (userId, apiId) => {
    mutate(userId, list => {
      const i = list.findIndex(a => a.api_id === apiId)
      if (i >= 0) list.splice(i, 1)
      else list.push({ api_id: apiId, folder_ids: [] })
    })
  }

  const getAcc = (userId, apiId) => (access[userId] || []).find(a => a.api_id === apiId)

  const toggleFull = (userId, apiId) => {
    mutate(userId, list => {
      const acc = list.find(a => a.api_id === apiId)
      if (acc) acc.folder_ids = acc.folder_ids == null ? [] : null
    })
  }

  const toggleFolder = (userId, apiId, api, fid) => {
    const folders = api.folders || []
    const sub = new Set([fid])
    let changed = true
    while (changed) {
      changed = false
      for (const fo of folders) {
        if (fo.parent_id != null && sub.has(fo.parent_id) && !sub.has(fo.id)) { sub.add(fo.id); changed = true }
      }
    }
    mutate(userId, list => {
      const acc = list.find(a => a.api_id === apiId)
      if (!acc) return
      if (!Array.isArray(acc.folder_ids)) acc.folder_ids = []
      const checked = acc.folder_ids.includes(fid)
      for (const id of sub) {
        if (checked) acc.folder_ids = acc.folder_ids.filter(x => x !== id)
        else if (!acc.folder_ids.includes(id)) acc.folder_ids.push(id)
      }
    })
  }

  // ── Копирование прав между пользователями ──
  const copyFrom = (u) => {
    setCopied(u.id)
    toast(`Права «${u.username}» скопированы — нажмите 📋 у другого пользователя`, 'info')
  }

  const pasteTo = (u) => {
    if (copied == null || copied === u.id) return
    setAccess(prev => ({ ...prev, [u.id]: JSON.parse(JSON.stringify(access[copied] || [])) }))
    toast(`Права вставлены: ${u.username} — не забудьте сохранить`, 'success')
  }

  const toggleCollapse = (id) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem('perms_collapsed', JSON.stringify([...next])) } catch { /* нет доступа */ }
      return next
    })
  }

  const f = q.trim().toLowerCase()
  const nonAdmins = users.filter(u => !u.is_admin && (!f ||
    u.username?.toLowerCase().includes(f) ||
    u.fullName?.toLowerCase().includes(f)))
  const copiedUser = users.find(x => x.id === copied)

  const renderFolderChecks = (userId, api, folderList, acc) => folderList.map(fo => (
    <div key={fo.id} className="perms-folder-node">
      <label className="perms-folder">
        <input
          type="checkbox"
          checked={(acc.folder_ids || []).includes(fo.id)}
          onChange={() => toggleFolder(userId, api.id, api, fo.id)}
        />
        <span className="perms-folder-icon">📁</span>
        <span className="perms-folder-name">{fo.name}</span>
      </label>
      <div className="perms-folder-children">
        {renderFolderChecks(userId, api, api.folders.filter(x => x.parent_id === fo.id), acc)}
      </div>
    </div>
  ))

  return (
    <>
      <div className="admin-content-head">
        <h2>Права доступа</h2>
        <div className="spacer" />
        <button className="btn-primary" onClick={() => setRuleOpen(true)}>＋ Добавить правило</button>
        <div className="admin-search">
          <span className="search-ico">🔍</span>
          <input placeholder="Поиск пользователя…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      {error && <div className="error-box" onClick={() => setError('')}>{error}</div>}
      <p className="muted" style={{ marginBottom: 16 }}>
        Отметьте API и папки, доступные каждому пользователю. Доступ к папке включает все вложенные подпапки.
        Кнопка ⧉ копирует права пользователя — 📋 вставляет их другому. Изменения применяются после «Сохранить».
      </p>
      {nonAdmins.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔑</div>
          <h2>{f ? 'Не найдено' : 'Нет обычных пользователей'}</h2>
          <p>{f ? 'Измените запрос' : 'Создайте пользователя без прав админа во вкладке «Пользователи»'}</p>
        </div>
      ) : (
        nonAdmins.map(u => {
          const isDirty = dirtyUsers.some(d => d.id === u.id)
          const open = !collapsed.has(u.id) || isDirty
          const apiCount = (access[u.id] || []).length
          return (
            <div key={u.id} className={`card perms-card ${isDirty ? 'dirty' : ''} ${open ? '' : 'collapsed'}`}>
              <div
                className="perms-user"
                style={{ cursor: 'pointer' }}
                onClick={() => toggleCollapse(u.id)}
                title={open ? 'Свернуть карточку' : 'Развернуть карточку'}
              >
                <span className="perms-caret">{open ? '▾' : '▸'}</span>
                <div className="avatar small">{(u.fullName || u.username).trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}</div>
                <div>
                  <div className="perms-user-name">{u.fullName || u.username}</div>
                  <div className="muted">{u.username} {u.email && `· ${u.email}`}</div>
                </div>
                <span className="pill-count" style={{ marginLeft: 'auto' }}>{apiCount} API</span>
                {isDirty && <span className="pill-admin">не сохранено</span>}
                <button
                  className="icon-btn"
                  title="Копировать права этого пользователя"
                  onClick={e => { e.stopPropagation(); copyFrom(u) }}
                >
                  ⧉
                </button>
                {copied === u.id && <span className="pill pill-version">скопировано</span>}
                {copied != null && copied !== u.id && (
                  <button
                    className="icon-btn paste"
                    title={copiedUser ? `Вставить права от «${copiedUser.username}»` : 'Вставить права'}
                    onClick={e => { e.stopPropagation(); pasteTo(u) }}
                  >
                    📋
                  </button>
                )}
              </div>
              {open && (
                <div className="perms-body">
                  {apis.length === 0 && <p className="muted">Нет API.</p>}
                  {apis.map(api => {
                    const acc = getAcc(u.id, api.id)
                    const has = !!acc
                    const full = has && acc.folder_ids == null
                    return (
                      <div key={api.id} className="perms-api">
                        <div className="perms-api-head">
                          <label className="perms-api-name">
                            <input type="checkbox" checked={has} onChange={() => toggleApi(u.id, api.id)} />
                            <span className="perms-api-chip">📄</span>
                            <span>{api.name}</span>
                          </label>
                          {has && (
                            <label className={`perms-full ${full ? 'on' : ''}`}>
                              <input type="checkbox" checked={full} onChange={() => toggleFull(u.id, api.id)} />
                              Полный доступ
                            </label>
                          )}
                        </div>
                        {has && !full && (
                          <div className="perms-folders">
                            {(api.folders || []).length === 0
                              ? <span className="muted">В API нет папок — доступ откроет всё содержимое</span>
                              : renderFolderChecks(u.id, api, api.folders.filter(x => x.parent_id == null), acc)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}

      {dirty && (
        <div className="perms-savebar">
          <span className="muted">Изменений: {dirtyUsers.length}</span>
          <div className="perms-savebar-actions">
            <button className="btn-secondary" onClick={reset} disabled={saving}>Сбросить</button>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Сохранение…' : '💾 Сохранить'}
            </button>
          </div>
        </div>
      )}

      {ruleOpen && (
        <RuleModal
          users={users.filter(u => !u.is_admin)}
          apis={apis.map(a => ({ id: a.id, name: a.name }))}
          onClose={() => setRuleOpen(false)}
          onSaved={onRuleSaved}
        />
      )}
    </>
  )
}
