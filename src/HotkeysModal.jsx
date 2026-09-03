import React from 'react'
import useFocusTrap from './useFocusTrap.js'

/**
 * Справка по горячим клавишам. Открывается по клавише «?» и кнопкой в топбаре.
 */
export default function HotkeysModal({ onClose }) {
  const ref = useFocusTrap(true)

  const rows = [
    { keys: ['Ctrl', 'K'], desc: 'Быстрый поиск по всем API и эндпоинтам' },
    { keys: ['↑', '↓'], desc: 'Навигация по дереву слева (клик по дереву — затем стрелки)' },
    { keys: ['Enter'], desc: 'Открыть выбранный элемент дерева' },
    { keys: ['Esc'], desc: 'Закрыть окно, меню или палитру' },
    { keys: ['?'], desc: 'Показать эту справку' },
    { keys: ['Ctrl', 'клик'], desc: 'Мультивыбор эндпоинтов для переноса (админ)' },
  ]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal hotkeys-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Горячие клавиши"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="modal-head">
          <h3>⌨️ Горячие клавиши</h3>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="hk-list">
          {rows.map((r, i) => (
            <div key={i} className="hk-row">
              <span className="hk-keys">
                {r.keys.map((k, j) => <kbd key={j}>{k}</kbd>)}
              </span>
              <span className="hk-desc">{r.desc}</span>
            </div>
          ))}
        </div>
        <div className="hk-extra muted">
          🤏 Ширина сайдбара регулируется перетаскиванием разделителя ·
          режим «путь / название» — кнопка Aa в поиске
        </div>
      </div>
    </div>
  )
}
