import React, { useState, useEffect, useCallback } from 'react'
import { getToken, setToken, getMe } from './api.js'
import { subscribe } from './toast.js'
import Login from './Login.jsx'
import Portal from './Portal.jsx'
import Admin from './Admin.jsx'
import HotkeysModal from './HotkeysModal.jsx'
import { AppSkeleton } from './Skeletons.jsx'

/* Тосты (глобальные уведомления) */
function Toaster() {
  const [items, setItems] = useState([])
  useEffect(() => subscribe(t => {
    setItems(prev => [...prev, t])
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), 4000)
  }), [])
  if (!items.length) return null
  return (
    <div className="toaster">
      {items.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
          </span>
          {t.msg}
        </div>
      ))}
    </div>
  )
}

function getInitialTheme() {
  const saved = localStorage.getItem('theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getPageFromPath() {
  return window.location.pathname.startsWith('/admin') ? 'admin' : 'portal'
}

function initialsOf(user) {
  const name = user?.fullName || user?.username || '?'
  return name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/* Экран 403 для не-админов на /admin */
function Forbidden({ onHome }) {
  return (
    <div className="forbidden">
      <div className="card forbidden-card">
        <div className="forbidden-code">403</div>
        <h2>Доступ запрещён</h2>
        <p className="muted" style={{ marginBottom: 20 }}>Раздел доступен только администраторам.</p>
        <button className="btn-primary" onClick={onHome}>← В портал</button>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(getPageFromPath)   // 'portal' | 'admin' — из URL
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(getInitialTheme)
  const [helpOpen, setHelpOpen] = useState(false)

  // Справка по горячим клавишам: клавиша «?» (вне полей ввода)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      setHelpOpen(o => !o)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  // Навигация без перезагрузки
  const navigate = useCallback((path) => {
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPage(getPageFromPath())
  }, [])

  // Кнопки «назад/вперёд» браузера
  useEffect(() => {
    const onPop = () => setPage(getPageFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const checkAuth = useCallback(async () => {
    if (!getToken()) { setUser(null); setChecked(true); return }
    try {
      const me = await getMe()
      setUser(me)
    } catch {
      setToken(null)
      setUser(null)
    }
    setChecked(true)
  }, [])

  useEffect(() => { checkAuth() }, [checkAuth])

  const logout = () => {
    setToken(null)
    setUser(null)
    if (window.location.pathname !== '/') window.history.replaceState({}, '', '/')
    setPage('portal')
  }

  if (!checked) return <AppSkeleton />
  if (!user) return <><Login onLogin={checkAuth} /><Toaster /></>

  const isAdminRoute = page === 'admin'

  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand" onClick={() => navigate('/')}>
          <span className="logo-mark">🗺️</span> API Портал
        </div>
        <div className="nav-links">
          <button className={!isAdminRoute ? 'active' : ''} onClick={() => navigate('/')}>Портал</button>
          {user.is_admin && (
            <button className={isAdminRoute ? 'active' : ''} onClick={() => navigate('/admin')}>Админка</button>
          )}
        </div>
        <div className="nav-user">
          <button
            className="btn-theme"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            aria-label="Переключить тему"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            className="btn-theme btn-help"
            onClick={() => setHelpOpen(true)}
            title="Горячие клавиши (?)"
            aria-label="Горячие клавиши"
          >
            ?
          </button>
          <div className="avatar" title={user.is_admin ? 'Администратор' : ''}>
            {initialsOf(user)}
          </div>
          <span className="user-name">{user.fullName || user.username}</span>
          <button className="btn-danger" onClick={logout}>Выйти</button>
        </div>
      </nav>
      <main className="content">
        {error && <div className="error-banner" onClick={() => setError('')}>{error}</div>}
        {isAdminRoute
          ? (user.is_admin
              ? <Admin />
              : <Forbidden onHome={() => navigate('/')} />)
          : <Portal user={user} />}
      </main>
      {helpOpen && <HotkeysModal onClose={() => setHelpOpen(false)} />}
      <Toaster />
    </div>
  )
}
