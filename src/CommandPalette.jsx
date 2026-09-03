import React, { useState, useEffect, useMemo, useRef } from 'react'
import Highlight from './Highlight.jsx'
import useFocusTrap from './useFocusTrap.js'

/**
 * Command palette (Ctrl+K): поиск по API и эндпоинтам с быстрым переходом.
 * items: [{ kind: 'api'|'endpoint', apiId, epId?, label, hint }]
 */
export default function CommandPalette({ open, onClose, apis, apiDetails, onSelectApi, onSelectEndpointOf }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const ref = useFocusTrap(open)

  useEffect(() => {
    if (open) {
      setQ(''); setIdx(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const items = useMemo(() => {
    const list = []
    for (const a of apis) {
      list.push({ kind: 'api', apiId: a.id, label: a.title || a.name, hint: `API · ${a.name}` })
      const det = apiDetails[a.id]
      if (det) {
        for (const ep of (det.endpoints || [])) {
          list.push({ kind: 'endpoint', apiId: a.id, epId: ep.id, label: ep.path, hint: `${ep.method} · ${ep.summary || ''}`, method: ep.method })
        }
      }
    }
    return list
  }, [apis, apiDetails])

  const f = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!f) return items.slice(0, 30)
    return items.filter(x =>
      x.label.toLowerCase().includes(f) || (x.hint || '').toLowerCase().includes(f)
    ).slice(0, 30)
  }, [items, f])

  useEffect(() => { setIdx(0) }, [q])

  const pick = (item) => {
    if (!item) return
    onClose()
    if (item.kind === 'api') onSelectApi(item.apiId)
    else onSelectEndpointOf(item.apiId, item.epId)
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[idx]) }
    else if (e.key === 'Escape') onClose()
  }

  useEffect(() => {
    const el = listRef.current?.children[idx]
    el?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!open) return null

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div
        className="cmdk"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Быстрый поиск"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-icon">🔍</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Поиск: API или эндпоинт…"
            aria-label="Поисковый запрос"
          />
          <span className="cmdk-esc">Esc</span>
        </div>
        <div className="cmdk-list" ref={listRef} role="listbox">
          {filtered.map((x, i) => (
            <div
              key={`${x.kind}-${x.apiId}-${x.epId ?? ''}`}
              className={`cmdk-item ${i === idx ? 'active' : ''}`}
              role="option"
              aria-selected={i === idx}
              onMouseEnter={() => setIdx(i)}
              onClick={() => pick(x)}
            >
              {x.kind === 'api'
                ? <span className="cmdk-badge api">API</span>
                : <span className={`cmdk-badge ep ${x.method?.toLowerCase()}`}>{x.method}</span>}
              <span className="cmdk-label"><Highlight text={x.label} query={q} /></span>
              <span className="cmdk-hint"><Highlight text={x.hint} query={q} /></span>
            </div>
          ))}
          {filtered.length === 0 && <div className="cmdk-empty">Ничего не найдено</div>}
        </div>
        <div className="cmdk-footer">
          <span>↑↓ навигация</span><span>↵ открыть</span><span>Ctrl+K вызвать</span>
        </div>
      </div>
    </div>
  )
}
