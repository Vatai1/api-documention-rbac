import React from 'react'

/* Скелетон-заглушки вместо текста «Загрузка…» */

function Shimmer({ className, style }) {
  return <div className={`skel ${className || ''}`} style={style} />
}

/* Полный каркас приложения: топбар + сайдбар + контент */
export function AppSkeleton() {
  return (
    <div className="app">
      <nav className="topbar">
        <div className="brand"><span className="logo-mark">🗺️</span> API Портал</div>
      </nav>
      <main className="content">
        <div className="portal-layout">
          <div className="portal-sidebar">
            <div className="search-bar"><Shimmer className="skel-search" /></div>
            <div className="skel-tree">
              {Array.from({ length: 12 }).map((_, i) => (
                <Shimmer
                  key={i}
                  className="skel-row"
                  style={{ width: `${88 - ((i * 13) % 42)}%`, marginLeft: i % 4 === 0 ? 0 : 18 }}
                />
              ))}
            </div>
          </div>
          <div className="sidebar-resizer" />
          <div className="portal-main">
            <Shimmer className="skel-title" />
            <Shimmer className="skel-card" />
            <Shimmer className="skel-card short" />
          </div>
        </div>
      </main>
    </div>
  )
}

/* Заглушка основной области портала */
export function PortalSkeleton() {
  return (
    <div>
      <Shimmer className="skel-title" />
      <Shimmer className="skel-card" />
      <Shimmer className="skel-card short" />
    </div>
  )
}

/* Каркас админ-панели: навигация + статистика */
export function AdminSkeleton() {
  return (
    <div className="admin-layout">
      <aside className="admin-nav">
        <Shimmer className="skel-navbrand" />
        {Array.from({ length: 5 }).map((_, i) => <Shimmer key={i} className="skel-navitem" />)}
      </aside>
      <main className="admin-content">
        <Shimmer className="skel-title" />
        <div className="stat-grid">
          {Array.from({ length: 4 }).map((_, i) => <Shimmer key={i} className="skel-stat" />)}
        </div>
      </main>
    </div>
  )
}
