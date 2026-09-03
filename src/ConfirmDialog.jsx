import React from 'react'
import useFocusTrap from './useFocusTrap.js'

/**
 * Диалог подтверждения опасного действия (вместо нативного confirm).
 */
export default function ConfirmDialog({ title, message, confirmLabel = 'Удалить', onConfirm, onClose }) {
  const ref = useFocusTrap(true)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal confirm-modal"
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="confirm-icon">⚠️</div>
        <h3>{title}</h3>
        <p className="confirm-msg">{message}</p>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn-secondary" onClick={onClose}>Отмена</button>
          <button className="btn-danger-lg" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
