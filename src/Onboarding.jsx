import React, { useState, useEffect } from 'react'
import useFocusTrap from './useFocusTrap.js'

const DONE_KEY = 'onboarding_done'

/**
 * Приветственное окно при первом входе (однократно, localStorage).
 * Показывается когда ready=true (портал загрузил данные).
 */
export default function Onboarding({ ready }) {
  const [open, setOpen] = useState(false)
  const ref = useFocusTrap(open)

  useEffect(() => {
    if (!ready) return
    let done = false
    try { done = !!localStorage.getItem(DONE_KEY) } catch { /* нет доступа */ }
    if (done) return
    const t = setTimeout(() => setOpen(true), 500)
    return () => clearTimeout(t)
  }, [ready])

  const close = () => {
    try { localStorage.setItem(DONE_KEY, '1') } catch { /* нет доступа */ }
    setOpen(false)
  }

  if (!open) return null

  const tips = [
    ['🗂️', <><b>Дерево слева</b> — все API и папки. Потяните разделитель, чтобы расширить панель</>],
    ['🔍', <><b>Ctrl + K</b> — мгновенный поиск по всем эндпоинтам</>],
    ['🕘', <><b>Недавние</b> — портал запоминает, что вы открывали</>],
    ['⭐', <><b>Звёздочка</b> — добавьте частые эндпоинты в избранное</>],
    ['🧪', <><b>Песочница</b> — тестовый запрос и копирование cURL прямо из карточки эндпоинта</>],
    ['⌨️', <><b>?</b> — список горячих клавиш</>],
  ]

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal onb-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Добро пожаловать"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') close() }}
      >
        <div className="onb-emoji">🗺️</div>
        <h3>Добро пожаловать в API Портал</h3>
        <p className="onb-sub">Краткий тур — займёт полминуты:</p>
        <ul className="onb-list">
          {tips.map(([ico, text], i) => (
            <li key={i}><span className="li-ico">{ico}</span><span>{text}</span></li>
          ))}
        </ul>
        <button className="btn-primary" style={{ width: '100%' }} onClick={close}>Начать работу</button>
      </div>
    </div>
  )
}
