// ═══════════════════════════════════════════
// API клиент
// ═══════════════════════════════════════════
const { useState, useEffect, useCallback } = React

const API = '/api'
function getToken() { return localStorage.getItem('portal_token') }
function setToken(t) { t ? localStorage.setItem('portal_token', t) : localStorage.removeItem('portal_token') }

async function request(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
  return data
}

const METHOD_CLASS = { GET:'m-get', POST:'m-post', PUT:'m-put', DELETE:'m-delete', PATCH:'m-patch' }
function respClass(c) { return c < 300 ? 'rc-2' : c < 500 ? 'rc-4' : 'rc-5' }

// ═══════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════
function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const data = await request('/auth/login', { method:'POST', body: JSON.stringify({ username, password }) })
      setToken(data.token)
      onLogin()
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>🗺️ API Портал</h1>
        <p className="sub">Авторизация</p>
        {error && <div className="error-box">{error}</div>}
        <input type="text" placeholder="Логин" value={username}
          onChange={e => setUsername(e.target.value)} required autoFocus />
        <input type="password" placeholder="Пароль" value={password}
          onChange={e => setPassword(e.target.value)} required />
        <button type="submit" disabled={loading}>{loading ? '...' : 'Войти'}</button>
        <p className="hint">Демо: <b>admin</b> / <b>admin12345</b></p>
      </form>
    </div>
  )
}

// ═══════════════════════════════════════════
// SIDEBAR (дерево: спецификация → разделы → эндпоинты)
// ═══════════════════════════════════════════
function Sidebar({ apis, activeApi, activeEndpoint, search, onSelectApi, onSelectEndpoint }) {
  const [openSpecs, setOpenSpecs] = useState({})
  const [openTags, setOpenTags] = useState({})

  const toggleSpec = (id) => setOpenSpecs(s => ({ ...s, [id]: !(s[id] !== false) }))
  const toggleTag = (key) => setOpenTags(s => ({ ...s, [key]: !(s[key] !== false) }))

  const f = search.toLowerCase()

  return (
    <div className="tree">
      {apis.map(api => {
        const specOpen = openSpecs[api.id] !== false
        const isActive = activeApi?.id === api.id
        return (
          <div key={api.id} className="tree-spec">
            <div className={`tree-spec-head ${specOpen ? 'open' : ''} ${isActive ? 'selected' : ''}`}
              onClick={() => { onSelectApi(api.id); toggleSpec(api.id) }}>
              <span className="arrow">{specOpen ? '▼' : '▶'}</span>
              <span className="icon">📄</span>
              <span className="name">{api.name}</span>
              <span className="count">{api.endpoint_count}</span>
            </div>
            {specOpen && isActive && Object.keys(activeApi.groups || {}).sort().map(tag => {
              const tagKey = `${api.id}-${tag}`
              const tagOpen = openTags[tagKey] !== false
              const endpoints = (activeApi.groups[tag] || []).filter(ep =>
                !f || ep.path.toLowerCase().includes(f) || ep.summary.toLowerCase().includes(f) || ep.method.toLowerCase().includes(f))
              if (f && endpoints.length === 0) return null
              return (
                <div key={tagKey} className="tree-tag-wrap">
                  <div className={`tree-tag-head ${tagOpen ? 'open' : ''}`} onClick={() => toggleTag(tagKey)}>
                    <span className="arrow">{tagOpen ? '▼' : '▶'}</span>
                    <span className="icon">📁</span>
                    <span className="name">{tag}</span>
                    <span className="count">{endpoints.length}</span>
                  </div>
                  {tagOpen && (
                    <div className="tree-ep-list">
                      {endpoints.map(ep => (
                        <div key={ep.id} className={`tree-ep ${activeEndpoint?.id === ep.id ? 'active' : ''}`}
                          onClick={() => onSelectEndpoint(ep)}>
                          <span className={`badge ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
                          <span className="ep-path">{ep.path}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════
// ENDPOINT DETAIL
// ═══════════════════════════════════════════
function EndpointDetail({ ep, api }) {
  const params = ep.parameters || []
  const responses = ep.responses || {}
  let bodySchema = ep.requestBody?.content?.['application/json']?.schema || null

  return (
    <div className="ep-detail">
      <div className="ep-header">
        <span className={`badge-lg ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
        <h2>{ep.summary}</h2>
      </div>
      <div className="ep-full-path">{ep.method} {api?.server_url}{ep.path}</div>
      {ep.description && <p className="ep-desc">{ep.description}</p>}

      {params.length > 0 && (
        <>
          <h3>Параметры</h3>
          <table className="data-table">
            <thead><tr><th>Имя</th><th>В</th><th>Тип</th><th>Обяз.</th><th>Описание</th></tr></thead>
            <tbody>
              {params.map((p, i) => (
                <tr key={i}>
                  <td><code>{p.name}</code></td><td>{p.in}</td>
                  <td>{p.schema?.type || '-'}</td>
                  <td>{p.required ? '✅' : ''}</td><td>{p.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {bodySchema && (
        <>
          <h3>Тело запроса</h3>
          <pre className="code-block">{JSON.stringify(bodySchema, null, 2)}</pre>
        </>
      )}

      <h3>Коды ответов</h3>
      <div className="resp-codes">
        {Object.entries(responses).map(([code, detail]) => (
          <span key={code} className={`resp-code ${respClass(parseInt(code))}`}>
            {code} — {detail.description || ''}
          </span>
        ))}
      </div>

      {api?.swagger_url && (
        <a className="btn-apidocs" href={api.swagger_url}>→ Открыть в Swagger UI (apidocs)</a>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// PORTAL (страница портала: sidebar + detail)
// ═══════════════════════════════════════════
function Portal() {
  const [apis, setApis] = useState([])
  const [activeApi, setActiveApi] = useState(null)
  const [activeEndpoint, setActiveEndpoint] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const loadApis = useCallback(async () => {
    try {
      const data = await request('/apis')
      setApis(data)
      if (data.length && !activeApi) {
        const full = await request(`/apis/${data[0].id}`)
        setActiveApi(full)
      }
    } catch (err) { setError(err.message) }
  }, [])

  useEffect(() => { loadApis() }, [loadApis])

  const selectApi = async (apiId) => {
    try {
      const full = await request(`/apis/${apiId}`)
      setActiveApi(full)
      setActiveEndpoint(null)
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="portal-layout">
      <div className="portal-sidebar">
        <div className="search-bar">
          <input type="text" placeholder="🔍 Поиск эндпоинтов…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Sidebar apis={apis} activeApi={activeApi} activeEndpoint={activeEndpoint}
          search={search} onSelectApi={selectApi} onSelectEndpoint={setActiveEndpoint} />
      </div>
      <div className="portal-main">
        {error && <div className="error-box">{error}</div>}
        {activeEndpoint ? (
          <EndpointDetail ep={activeEndpoint} api={activeApi} />
        ) : activeApi ? (
          <div className="api-overview">
            <h2>{activeApi.title}</h2>
            <div className="api-meta">
              <span className="badge-version">v{activeApi.version}</span>
              <span className="badge-endpoints">
                {Object.values(activeApi.groups).flat().length} эндпоинтов
              </span>
            </div>
            {activeApi.description && <pre className="api-desc">{activeApi.description}</pre>}
            <div className="api-server"><strong>Server:</strong> <code>{activeApi.server_url}</code></div>
            {activeApi.swagger_url && <a className="btn-apidocs" href={activeApi.swagger_url}>📖 Swagger UI</a>}
            <p className="muted">Выберите эндпоинт слева</p>
          </div>
        ) : (
          <div className="empty-state">
            <h2>Нет доступных API</h2>
            <p>Обратитесь к администратору.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════
// ADMIN: вкладка API
// ═══════════════════════════════════════════
function ApisTab() {
  const [apis, setApis] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const blank = { name:'', title:'', version:'1.0', description:'', server_url:'', swagger_url:'', specJson:'' }
  const [form, setForm] = useState(blank)

  const load = useCallback(async () => {
    try { setApis(await request('/admin/apis')) } catch(e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const startEdit = async (api) => {
    try {
      const full = await request(`/apis/${api.id}`)
      setForm({
        name: full.name, title: full.title, version: full.version,
        description: full.description, server_url: full.server_url,
        swagger_url: full.swagger_url || '', specJson: ''
      })
      setEditingId(api.id)
      setShowForm(true)
      setError('')
    } catch(e) { setError(e.message) }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setShowForm(false)
    setForm(blank)
  }

  const parseSpec = (specJson) => {
    let groups = {}
    if (specJson && specJson.trim()) {
      const spec = JSON.parse(specJson)
      for (const [path, methods] of Object.entries(spec.paths || {})) {
        for (const [method, detail] of Object.entries(methods)) {
          if (!['get','post','put','delete','patch'].includes(method)) continue
          const tags = detail.tags || ['Без категории']
          for (const tag of tags) {
            groups[tag] = groups[tag] || []
            groups[tag].push({
              method: method.toUpperCase(), path,
              summary: detail.summary || '', description: detail.description || '',
              parameters: detail.parameters || [], requestBody: detail.requestBody || null,
              responses: detail.responses || {}
            })
          }
        }
      }
    }
    return groups
  }

  const submit = async (e) => {
    e.preventDefault(); setError('')
    try {
      const groups = parseSpec(form.specJson)
      const payload = {
        name: form.name, title: form.title || form.name, version: form.version,
        description: form.description, server_url: form.server_url,
        swagger_url: form.swagger_url
      }
      if (form.specJson.trim()) payload.groups = groups

      if (editingId) {
        await request(`/admin/apis/${editingId}`, { method:'PUT', body: JSON.stringify(payload) })
      } else {
        if (!form.specJson.trim()) throw new Error('Вставьте OpenAPI JSON для нового API')
        payload.groups = groups
        await request('/admin/apis', { method:'POST', body: JSON.stringify(payload) })
      }
      cancelEdit(); load()
    } catch(e) { setError(e.message) }
  }

  const remove = async (id) => {
    if (!confirm('Удалить API?')) return
    try { await request(`/admin/apis/${id}`, { method:'DELETE' }); load() } catch(e) { setError(e.message) }
  }
  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {!showForm && (
        <button className="btn-primary" onClick={() => { setForm(blank); setEditingId(null); setShowForm(true) }}>
          ＋ Добавить API
        </button>
      )}
      {showForm && (
        <form className="admin-form" onSubmit={submit}>
          <h3>{editingId ? `✏️ Редактирование API #${editingId}` : '➕ Новое API'}</h3>
          <div className="form-row"><label>Имя (slug)</label>
            <input value={form.name} onChange={upd('name')} required /></div>
          <div className="form-row"><label>Название</label>
            <input value={form.title} onChange={upd('title')} /></div>
          <div className="form-row"><label>Версия</label>
            <input value={form.version} onChange={upd('version')} /></div>
          <div className="form-row"><label>URL сервера</label>
            <input value={form.server_url} onChange={upd('server_url')} /></div>
          <div className="form-row"><label>Swagger UI URL</label>
            <input value={form.swagger_url} onChange={upd('swagger_url')} /></div>
          <div className="form-row"><label>Описание</label>
            <textarea value={form.description} onChange={upd('description')} rows="3" /></div>
          <div className="form-row">
            <label>OpenAPI JSON {editingId ? '(опционально — только для замены эндпоинтов)' : '(обязательно)'}</label>
            <textarea value={form.specJson} onChange={upd('specJson')} rows="8"
              placeholder='{"openapi":"3.0.3","paths":{...}}' className="code-input" />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn-primary">{editingId ? 'Сохранить' : 'Создать API'}</button>
            <button type="button" className="btn-secondary" onClick={cancelEdit}>✕ Отмена</button>
          </div>
        </form>
      )}
      <table className="data-table admin-table">
        <thead><tr><th>ID</th><th>Имя</th><th>Название</th><th>Версия</th><th>Эндпоинтов</th><th></th></tr></thead>
        <tbody>
          {apis.map(a => (
            <tr key={a.id}>
              <td>{a.id}</td><td><code>{a.name}</code></td><td>{a.title}</td>
              <td>{a.version}</td><td>{a.endpoint_count}</td>
              <td className="row-actions">
                <button className="btn-edit-sm" onClick={() => startEdit(a)} title="Редактировать">✏️</button>
                <button className="btn-danger-sm" onClick={() => remove(a.id)} title="Удалить">🗑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════
// ADMIN: вкладка Пользователи
// ═══════════════════════════════════════════
function UsersTab() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const blank = { username:'', password:'', email:'', fullName:'', is_admin:false }
  const [form, setForm] = useState(blank)

  const load = useCallback(async () => {
    try { setUsers(await request('/admin/users')) } catch(e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const submit = async (e) => {
    e.preventDefault(); setError('')
    try {
      await request('/admin/users', { method:'POST', body: JSON.stringify(form) })
      setShowForm(false); setForm(blank); load()
    } catch(e) { setError(e.message) }
  }

  const remove = async (id) => {
    if (!confirm('Удалить пользователя?')) return
    try { await request(`/admin/users/${id}`, { method:'DELETE' }); load() } catch(e) { setError(e.message) }
  }
  const toggleAdmin = async (u) => {
    try { await request(`/admin/users/${u.id}`, { method:'PUT', body: JSON.stringify({ is_admin: !u.is_admin }) }); load() }
    catch(e) { setError(e.message) }
  }
  const upd = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
        {showForm ? '✕ Отмена' : '＋ Добавить пользователя'}
      </button>
      {showForm && (
        <form className="admin-form" onSubmit={submit}>
          <div className="form-row"><label>Логин</label><input value={form.username} onChange={upd('username')} required /></div>
          <div className="form-row"><label>Пароль</label><input type="password" value={form.password} onChange={upd('password')} required /></div>
          <div className="form-row"><label>Полное имя</label><input value={form.fullName} onChange={upd('fullName')} /></div>
          <div className="form-row"><label>Email</label><input type="email" value={form.email} onChange={upd('email')} /></div>
          <div className="form-row"><label><input type="checkbox" checked={form.is_admin} onChange={upd('is_admin')} /> Администратор</label></div>
          <button type="submit" className="btn-primary">Создать</button>
        </form>
      )}
      <table className="data-table admin-table">
        <thead><tr><th>ID</th><th>Логин</th><th>Имя</th><th>Email</th><th>Админ</th><th>API доступ</th><th></th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.id}</td><td><strong>{u.username}</strong></td>
              <td>{u.fullName || '-'}</td><td>{u.email || '-'}</td>
              <td><input type="checkbox" checked={u.is_admin} onChange={() => toggleAdmin(u)} /></td>
              <td>{u.api_access?.length || 0}</td>
              <td><button className="btn-danger-sm" onClick={() => remove(u.id)}>🗑</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════
// ADMIN: вкладка Права (матрица user × api)
// ═══════════════════════════════════════════
function PermsTab() {
  const [users, setUsers] = useState([])
  const [apis, setApis] = useState([])
  const [error, setError] = useState('')
  const [matrix, setMatrix] = useState({})

  const load = useCallback(async () => {
    try {
      const [u, a] = await Promise.all([request('/admin/users'), request('/admin/apis')])
      setUsers(u); setApis(a)
      const m = {}
      u.forEach(usr => { m[usr.id] = new Set(usr.api_access || []) })
      setMatrix(m)
    } catch(e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = async (userId, apiId) => {
    const current = new Set(matrix[userId] || [])
    if (current.has(apiId)) current.delete(apiId); else current.add(apiId)
    setMatrix(m => ({ ...m, [userId]: current }))
    try { await request(`/admin/users/${userId}/permissions`, { method:'PUT', body: JSON.stringify({ api_ids: [...current] }) }) }
    catch(e) { setError(e.message); load() }
  }

  const nonAdmins = users.filter(u => !u.is_admin)

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">Отметьте галочками, к каким API имеет доступ пользователь. Админы видят все API.</p>
      {nonAdmins.length === 0 ? (
        <p className="muted">Нет обычных пользователей.</p>
      ) : (
        <table className="data-table perms-table">
          <thead><tr><th>Пользователь</th>{apis.map(a => <th key={a.id} title={a.title}>{a.name}</th>)}</tr></thead>
          <tbody>
            {nonAdmins.map(u => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong><br /><span className="muted">{u.email}</span></td>
                {apis.map(a => (
                  <td key={a.id} className="center">
                    <input type="checkbox" checked={matrix[u.id]?.has(a.id) || false} onChange={() => toggle(u.id, a.id)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════
// ADMIN (обёртка с табами)
// ═══════════════════════════════════════════
function Admin() {
  const [tab, setTab] = useState('apis')
  return (
    <div className="admin">
      <h2>⚙️ Админ-панель</h2>
      <div className="tabs">
        <button className={tab === 'apis' ? 'active' : ''} onClick={() => setTab('apis')}>📄 API</button>
        <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>👥 Пользователи</button>
        <button className={tab === 'perms' ? 'active' : ''} onClick={() => setTab('perms')}>🔑 Права доступа</button>
      </div>
      {tab === 'apis' && <ApisTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'perms' && <PermsTab />}
    </div>
  )
}

// ═══════════════════════════════════════════
// APP (корень)
// ═══════════════════════════════════════════
function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('portal')
  const [checked, setChecked] = useState(false)

  const checkAuth = useCallback(async () => {
    if (!getToken()) { setUser(null); setChecked(true); return }
    try { setUser(await request('/auth/me')) }
    catch { setToken(null); setUser(null) }
    setChecked(true)
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  const logout = () => { setToken(null); setUser(null); setPage('portal') }

  if (!checked) return <div className="loading">Загрузка…</div>
  if (!user) return <Login onLogin={checkAuth} />

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand">🗺️ API Портал</div>
        <div className="nav-links">
          <button className={page === 'portal' ? 'active' : ''} onClick={() => setPage('portal')}>📋 Портал</button>
          {user.is_admin && (
            <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>⚙️ Админка</button>
          )}
        </div>
        <div className="nav-user">
          <span>{user.fullName || user.username}{user.is_admin ? ' ⭐' : ''}</span>
          <button className="btn-danger" onClick={logout}>Выйти</button>
        </div>
      </nav>
      <main className="content">
        {page === 'portal' ? <Portal /> : <Admin />}
      </main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
