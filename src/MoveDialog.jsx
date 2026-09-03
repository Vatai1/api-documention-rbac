import React, { useMemo } from 'react'
import useFocusTrap from './useFocusTrap.js'

/**
 * Модалка «Переместить в…».
 * folders — все папки; excludeId — перемещаемая папка (её и потомков нельзя выбрать);
 * currentParentId — текущий родитель (пометка); onSelect(folderId | null) — выбор цели;
 * rootLabel — подпись корневого пункта (по умолчанию «Корень API»).
 */
export default function MoveDialog({ title, folders, excludeId, currentParentId, onSelect, onClose, rootLabel }) {
  const ref = useFocusTrap(true)
  // Дерево: parent_id (null → 'root') → children
  const byParent = useMemo(() => {
    const m = new Map([['root', []]])
    for (const f of folders) {
      const key = f.parent_id ?? 'root'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(f)
    }
    for (const list of m.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    return m
  }, [folders])

  // Запрещённые: сама папка и все её потомки
  const disabled = useMemo(() => {
    if (excludeId == null) return new Set()
    const set = new Set([excludeId])
    let changed = true
    while (changed) {
      changed = false
      for (const f of folders) {
        if (f.parent_id != null && set.has(f.parent_id) && !set.has(f.id)) { set.add(f.id); changed = true }
      }
    }
    return set
  }, [folders, excludeId])

  const renderRow = (folder, depth) => {
    const isDisabled = disabled.has(folder.id)
    const isCurrent = (folder.id === currentParentId)
    return (
      <div key={folder.id}>
        <button
          className={`move-row ${isDisabled ? 'disabled' : ''} ${isCurrent ? 'current' : ''}`}
          style={{ paddingLeft: 14 + depth * 20 }}
          disabled={isDisabled}
          onClick={() => onSelect(folder.id)}
        >
          <span className="icon">📁</span>
          <span className="name">{folder.name}</span>
          {isCurrent && <span className="tag">текущая</span>}
        </button>
        {(byParent.get(folder.id) || []).map(ch => renderRow(ch, depth + 1))}
      </div>
    )
  }

  const rootDisabled = currentParentId === null
  const rootSelected = rootDisabled

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Переместить в…'}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <h3>{title || 'Переместить в…'}</h3>
        <div className="move-list">
          <button
            className={`move-row ${rootSelected ? 'current' : ''}`}
            disabled={rootDisabled}
            onClick={() => onSelect(null)}
          >
            <span className="icon">🗂️</span>
            <span className="name">{rootLabel || 'Корень API'}</span>
            {rootSelected && <span className="tag">текущая</span>}
          </button>
          {(byParent.get('root') || []).map(f => renderRow(f, 0))}
        </div>
        <button className="btn-secondary" onClick={onClose}>Отмена</button>
      </div>
    </div>
  )
}
