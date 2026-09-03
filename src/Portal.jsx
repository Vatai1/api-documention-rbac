import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { getApis, getApi, getTreeFolders, setFavorites } from './api.js'
import Sidebar from './Sidebar.jsx'
import EndpointDetail from './EndpointDetail.jsx'
import CommandPalette from './CommandPalette.jsx'
import Onboarding from './Onboarding.jsx'
import { PortalSkeleton } from './Skeletons.jsx'
import { getRecent, addRecent } from './recent.js'
import { toast } from './toast.js'

const fmtVersion = (v) => {
  const s = String(v)
  if (/^\d{2}\.\d{4}$/.test(s)) return s
  if (/^\d{4}$/.test(s)) return `${s} г.`
  return `v${s}`
}

/* Deep link: /apis/:apiId или /apis/:apiId/ep/:epId */
function parseDeepLink() {
  const m = window.location.pathname.match(/^\/apis\/(\d+)(?:\/ep\/(\d+))?/)
  if (!m) return null
  return { apiId: +m[1], epId: m[2] != null ? +m[2] : null }
}

export default function Portal({ user }) {
  const [apis, setApis] = useState([])
  const [treeFolders, setTreeFolders] = useState([])   // глобальные папки (вне API)
  const [activeApi, setActiveApi] = useState(null)      // полные данные API
  const [apiDetails, setApiDetails] = useState({})      // кэш полных данных: id → api
  const [activeEndpoint, setActiveEndpoint] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  // Текущий выбор — для обработчика popstate
  const selRef = useRef({})
  selRef.current = { apiId: activeApi?.id ?? null, epId: activeEndpoint?.id ?? null }

  // ── Ширина сайдбара (перетаскивание разделителя) ──
  const [sidebarWidth, setSidebarWidth] = useState(
    () => parseInt(localStorage.getItem('sidebar_width'), 10) || 330)
  const widthRef = useRef(sidebarWidth)
  widthRef.current = sidebarWidth

  // ── Command palette (Ctrl+K) ──
  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Режим имён: путь ↔ название эндпоинта ──
  const [labelMode, setLabelMode] = useState(() => localStorage.getItem('tree_label_mode') || 'path')
  const toggleLabelMode = () => {
    setLabelMode(m => {
      const next = m === 'path' ? 'name' : 'path'
      localStorage.setItem('tree_label_mode', next)
      return next
    })
  }

  // ── Избранное ──
  const [favorites, setFavs] = useState(user?.favorites || [])
  useEffect(() => { setFavs(user?.favorites || []) }, [user?.id, user?.favorites?.length])

  const isFav = (apiId, epId) => favorites.some(f2 => f2.api_id === apiId && f2.ep_id === epId)

  const toggleFav = async (apiId, epId) => {
    const next = isFav(apiId, epId)
      ? favorites.filter(f2 => !(f2.api_id === apiId && f2.ep_id === epId))
      : [...favorites, { api_id: apiId, ep_id: epId }]
    setFavs(next)
    try {
      await setFavorites(next)
      toast(next.length > favorites.length ? 'Добавлено в избранное' : 'Удалено из избранного', 'success')
    } catch (e) {
      setFavs(favorites)
      toast('Ошибка: ' + e.message, 'error')
    }
  }

  // ── Недавние эндпоинты ──
  const [recent, setRecent] = useState(() => getRecent())

  // Чистим устаревшие вкладки от предыдущей версии портала
  useEffect(() => {
    try { localStorage.removeItem('open_tabs') } catch { /* нет доступа */ }
  }, [])

  // ── Свёрнутость дерева (поднято из Sidebar ради кнопок «развернуть/свернуть всё») ──
  const [openSpecs, setOpenSpecs] = useState({})     // свёрнутость API
  const [openFolders, setOpenFolders] = useState({}) // папки эндпоинтов
  const [gOpen, setGOpen] = useState({})             // глобальные папки

  // ── Единая точка выбора: deep link + история + вкладки + недавние ──
  // Возвращает полные данные API или null (ошибка/нет доступа)
  const applySelection = useCallback(async (apiId, epId, { push = true } = {}) => {
    try {
      const full = await getApi(apiId)
      setActiveApi(full)
      setApiDetails(m => (m[apiId] ? m : { ...m, [apiId]: full }))
      const ep = epId != null ? (full.endpoints || []).find(e => e.id === epId) || null : null
      setActiveEndpoint(ep)
      if (ep) {
        const label = labelMode === 'name' ? (ep.summary || ep.path) : ep.path
        setRecent(addRecent({ apiId, epId: ep.id, apiName: full.name, method: ep.method, label }))
      }
      if (push) {
        const path = ep ? `/apis/${apiId}/ep/${ep.id}` : `/apis/${apiId}`
        if (window.location.pathname !== path) window.history.pushState({}, '', path)
      }
      return full
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [labelMode])

  const selectApi = useCallback((apiId) => applySelection(apiId, null), [applySelection])
  const selectEndpoint = useCallback((ep) => {
    if (activeApi) applySelection(activeApi.id, ep.id)
  }, [activeApi, applySelection])
  const selectApiAndEndpoint = useCallback((apiId, epId) => applySelection(apiId, epId), [applySelection])

  const startResize = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = widthRef.current
    document.body.classList.add('resizing-sidebar')
    const onMove = (ev) => {
      const w = Math.min(640, Math.max(220, startW + ev.clientX - startX))
      setSidebarWidth(w)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('resizing-sidebar')
      localStorage.setItem('sidebar_width', String(widthRef.current))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Первая загрузка: deep link или первый API ──
  const firstLoad = useRef(true)
  const loadApis = useCallback(async () => {
    setLoading(true)
    try {
      const [data, tf] = await Promise.all([getApis(), getTreeFolders()])
      setApis(data)
      setTreeFolders(tf)
      if (firstLoad.current && data.length) {
        firstLoad.current = false
        const deep = parseDeepLink()
        const full = deep
          ? await applySelection(deep.apiId, deep.epId, { push: false })
          : null
        if (!full) await applySelection(data[0].id, null, { push: false })
      }
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [applySelection])

  useEffect(() => { loadApis() }, [loadApis])

  // Кнопки «назад/вперёд» браузера внутри портала (deep links)
  useEffect(() => {
    const onPop = () => {
      const deep = parseDeepLink()
      if (!deep) return
      const cur = selRef.current
      if (deep.apiId !== cur.apiId || deep.epId !== cur.epId) {
        applySelection(deep.apiId, deep.epId, { push: false })
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [applySelection])

  // Заголовок вкладки браузера = текущий контекст
  useEffect(() => {
    const t = activeEndpoint
      ? `${activeEndpoint.method} ${activeEndpoint.path}`
      : (activeApi?.title || activeApi?.name || 'API Портал')
    document.title = `${t} · API Портал`
  }, [activeEndpoint, activeApi])

  // Развернуть API без выбора (ленивая загрузка деталей)
  const expandApi = useCallback((apiId) => {
    setApiDetails(prev => {
      if (prev[apiId]) return prev
      getApi(apiId)
        .then(full => setApiDetails(m => (m[apiId] ? m : { ...m, [apiId]: full })))
        .catch(err => setError(err.message))
      return prev
    })
  }, [])

  // Перезагрузка активного API после изменений (папки, перемещения) — с сохранением выбора
  const reloadApi = useCallback(async () => {
    if (!activeApi) return
    try {
      const full = await getApi(activeApi.id)
      setActiveApi(full)
      setApiDetails(m => ({ ...m, [full.id]: full }))
      // Эндпоинт мог переехать в другую папку / исчезнуть
      if (activeEndpoint) {
        setActiveEndpoint(prev =>
          (full.endpoints || []).find(e => e.id === prev.id) || null)
      }
    } catch (err) { setError(err.message) }
  }, [activeApi, activeEndpoint])

  // ── Развернуть / свернуть всё дерево ──
  const expandAll = () => {
    const s = {}, fl = {}, g = {}
    apis.forEach(a => { s[a.id] = true; expandApi(a.id) })
    ;(activeApi?.folders || []).forEach(x => { fl[x.id] = true })
    treeFolders.forEach(x => { g[x.id] = true })
    setOpenSpecs(s); setOpenFolders(fl); setGOpen(g)
  }
  const collapseAll = () => {
    const s = {}, fl = {}, g = {}
    apis.forEach(a => { s[a.id] = false })
    ;(activeApi?.folders || []).forEach(x => { fl[x.id] = false })
    treeFolders.forEach(x => { g[x.id] = false })
    setOpenSpecs(s); setOpenFolders(fl); setGOpen(g)
  }

  // ── Хлебные крошки: API › папки › эндпоинт ──
  const crumbs = useMemo(() => {
    if (!activeApi) return null
    const apiName = activeApi.title || activeApi.name
    if (!activeEndpoint) return { api: apiName, folders: [], ep: null }
    const fmap = new Map((activeApi.folders || []).map(x => [x.id, x]))
    const chain = []
    let fid = activeEndpoint.folder_id ?? null
    while (fid != null && fmap.has(fid)) {
      const fo = fmap.get(fid)
      chain.unshift(fo.name)
      fid = fo.parent_id ?? null
    }
    return { api: apiName, folders: chain, ep: activeEndpoint.summary || activeEndpoint.path }
  }, [activeApi, activeEndpoint])

  return (
    <div className="portal-layout">
      <div className="portal-sidebar" style={{ width: sidebarWidth }}>
        <div className="search-bar">
          <input
            type="text" placeholder="🔍 Поиск эндпоинтов…   Ctrl+K — глобальный"
            value={search} onChange={e => setSearch(e.target.value)}
            aria-label="Поиск по дереву"
          />
          <button
            className={`label-mode-btn ${labelMode === 'name' ? 'on' : ''}`}
            onClick={toggleLabelMode}
            title={labelMode === 'path' ? 'Показывать названия вместо путей' : 'Показывать пути вместо названий'}
          >
            Aa
          </button>
          <button className="label-mode-btn" onClick={expandAll} title="Развернуть все папки">⊞</button>
          <button className="label-mode-btn" onClick={collapseAll} title="Свернуть все папки">⊟</button>
        </div>
        <Sidebar
          apis={apis}
          treeFolders={treeFolders}
          activeApi={activeApi}
          apiDetails={apiDetails}
          activeEndpoint={activeEndpoint}
          search={search}
          user={user}
          favorites={favorites}
          isFav={isFav}
          onToggleFav={toggleFav}
          labelMode={labelMode}
          recent={recent}
          openSpecs={openSpecs}
          setOpenSpecs={setOpenSpecs}
          openFolders={openFolders}
          setOpenFolders={setOpenFolders}
          gOpen={gOpen}
          setGOpen={setGOpen}
          onSelectApi={selectApi}
          onSelectEndpoint={selectEndpoint}
          onSelectEndpointOf={selectApiAndEndpoint}
          onExpandApi={expandApi}
          onApiChanged={reloadApi}
          onTreeChanged={loadApis}
        />
      </div>
      <div className="sidebar-resizer" onMouseDown={startResize} title="Потяните, чтобы изменить ширину" />
      <div className="portal-main">
        {loading && !apis.length ? (
          <PortalSkeleton />
        ) : (
          <>
            {error && <div className="error-banner" onClick={() => setError('')}>{error}</div>}

            {activeApi && crumbs && (
              <nav className="crumbs" aria-label="Хлебные крошки">
                <span className="crumb api" onClick={() => selectApi(activeApi.id)} title="К обзору API">
                  {crumbs.api}
                </span>
                {crumbs.folders.map((n, i) => (
                  <span key={i} className="crumb">{n}</span>
                ))}
                {crumbs.ep && <span className="crumb ep" title={activeEndpoint?.path}>{crumbs.ep}</span>}
              </nav>
            )}

            {activeEndpoint ? (
              <EndpointDetail
                key={activeEndpoint.id}
                ep={activeEndpoint}
                api={activeApi}
                isAdmin={!!user?.is_admin}
                isFav={!!activeApi && isFav(activeApi.id, activeEndpoint.id)}
                onToggleFav={() => activeApi && toggleFav(activeApi.id, activeEndpoint.id)}
              />
            ) : activeApi ? (
              <div className="api-overview">
                <h2>{activeApi.title}</h2>
                <div className="api-meta">
                  <span className="pill pill-version">{fmtVersion(activeApi.version)}</span>
                  <span className="pill pill-endpoints">
                    {activeApi.endpoints?.length || 0} эндпоинтов
                  </span>
                </div>
                {activeApi.description && (
                  <div className="api-desc">{activeApi.description}</div>
                )}
                <div className="api-server">
                  <strong>Server:</strong> <code>{activeApi.server_url}</code>
                </div>
                <a
                  className="btn-apidocs"
                  href={`/apidocs/${activeApi.id}?token=${encodeURIComponent(localStorage.getItem('portal_token') || '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  📖 Открыть Swagger UI
                </a>
                <p className="muted" style={{ marginTop: 18 }}>Выберите эндпоинт слева для просмотра деталей · <b>Ctrl+K</b> — быстрый поиск · <b>?</b> — горячие клавиши</p>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">🗂️</div>
                <h2>Нет доступных API</h2>
                <p>Обратитесь к администратору для получения прав доступа.</p>
              </div>
            )}
          </>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        apis={apis}
        apiDetails={apiDetails}
        onSelectApi={selectApi}
        onSelectEndpointOf={selectApiAndEndpoint}
      />
      <Onboarding ready={apis.length > 0} />
    </div>
  )
}
