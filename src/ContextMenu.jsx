import React, { useState, useEffect, useRef } from 'react'

/**
 * Контекстное меню. items: [{ label, icon?, danger?, disabled?, onClick }, ..., { separator: true }]
 * Закрытие: mousedown/ПКМ вне меню, Esc, скролл, resize. Клик внутри меню закрыть не может.
 */
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })

  // Корректировка позиции, чтобы меню не выходило за экран
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x, ny = y
    if (x + rect.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - rect.width - 8)
    if (y + rect.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - rect.height - 8)
    setPos({ x: nx, y: ny })
  }, [x, y])

  useEffect(() => {
    const el = ref.current
    const outside = (e) => el && !el.contains(e.target)
    const onDown = (e) => { if (outside(e)) onClose() }
    const onCtx = (e) => { if (outside(e)) { e.preventDefault(); onClose() } }
    const onEsc = (e) => { if (e.key === 'Escape') onClose() }
    const onScroll = (e) => { if (outside(e)) onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('contextmenu', onCtx)
    document.addEventListener('keydown', onEsc)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('keydown', onEsc)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  if (!items || items.length === 0) return null

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => { onClose(); it.onClick && it.onClick() }}
          >
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        )
      )}
    </div>
  )
}
