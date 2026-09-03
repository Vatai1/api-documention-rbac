import React, { useState, useEffect, useMemo } from 'react'
import { getApi, getUsers, setUserAccesses } from './api.js'
import useFocusTrap from './useFocusTrap.js'
import { toast } from './toast.js'

/**
 * Модалка создания правила доступа:
 * пользователь + API + (полный доступ | выбор папок).
 * onSaved({ userId, accesses }) — итоговый список доступов пользователя.
 */
export default function RuleModal({ users, apis, onClose, onSaved }) {
  const ref = useFocusTrap(true)
  const [userId, setUserId] = useState(users[0]?.id || '')
  const [apiId, setApiId] = useState(apis[0]?.id || '')
  const [full, setFull] = useState(true)
  const [folders, setFolders] = useState(null)   // папки выбранного API (null — грузится)
  const [sel, setSel] = useState(() => new Set())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!apiId) { setFolders([]); return }
    let cancelled = false
    setFolders(null)
    setSel(new Set())
    getApi(apiId)
      .then(f => { if (!cancelled) setFolders(f.folders || []) })
      .catch(e => { setError(e.message); setFolders([]) })
    return () => { cancelled = true }
  }, [apiId])

  const subtreeOf = useMemo(() => {
    const build = (fid) => {
      const set = new Set([fid])
      let changed = true
      while (changed) {
        changed = false
        for (const fo of (folders || [])) {
          if (fo.parent_id != null && set.has(fo.parent_id) && !set.has(fo.id)) { set.add(fo.id); changed = true }
        }
      }
      return set
    }
    return build
  }, [folders])

  const toggleFolder = (fid) => {
    setSel(prev => {
      const sub = subtreeOf(fid)
      const had = [...sub].some(id => prev.has(id))
      const next = new Set(prev)
      if (had) { for (const id of sub) next.delete(id) }
      else { for (const id of sub) next.add(id) }
      return next
    })
  }

  const valid = userId && apiId && (full || sel.size > 0)

  const save = async () => {
    setSaving(true); setError('')
    try {
      // Текущие доступы пользователя берём с сервера (без несохранённых черновиков админки)
      const fresh = await getUsers()
      const u = fresh.find(x => x.id === userId)
      const list = (u?.accesses || [])
        .filter(a => a.api_id !== apiId)
        .map(a => ({
          api_id: a.api_id,
          folder_ids: a.folder_ids ?? null,
          endpoint_ids: Array.isArray(a.endpoint_ids) ? [...a.endpoint_ids] : []
        }))
      list.push({ api_id: apiId, folder_ids: full ? null : [...sel], endpoint_ids: [] })
      await setUserAccesses(userId, list)
      toast('Правило доступа создано', 'success')
      onSaved({ userId, accesses: list })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const byP = useMemo(() => {
    const m = new Map([['root', []]])
    for (const fo of (folders || [])) {
      const k = fo.parent_id ?? 'root'
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(fo)
    }
    for (const list of m.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    return m
  }, [folders])

  const renderFolders = (list) => list.map(fo => {
    const checked = sel.has(fo.id)
    const partial = !checked && [...subtreeOf(fo.id)].some(id => sel.has(id))
    return (
      <div key={fo.id} className="perms-folder-node">
        <label className="perms-folder">
          <input
            type="checkbox"
            checked={checked}
            ref={el => { if (el) el.indeterminate = partial }}
            onChange={() => toggleFolder(fo.id)}
          />
          <span className="perms-folder-icon">{checked || partial ? '📂' : '📁'}</span>
          <span className="perms-folder-name">{fo.name}</span>
        </label>
        <div className="perms-folder-children">
          {renderFolders(byP.get(fo.id) || [])}
        </div>
      </div>
    )
  })

  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div
        className="modal admin-modal rule-modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Новое правило доступа"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="am-head">
          <div className="am-icon">➕</div>
          <div className="am-head-text">
            <h3>Новое правило доступа</h3>
            <div className="am-sub">Выдать пользователю доступ к API целиком или выбранным папкам</div>
          </div>
          <button className="modal-close" onClick={() => onClose()}>✕</button>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="form-cols">
          <div className="form-row">
            <label>Пользователь</label>
            <select value={userId} onChange={e => setUserId(Number(e.target.value))}>
              {users.length === 0 && <option value="">— нет пользователей —</option>}
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.fullName || u.username} ({u.username})</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>API</label>
            <select value={apiId} onChange={e => setApiId(Number(e.target.value))}>
              {apis.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <label className={`perms-full rule-full ${full ? 'on' : ''}`}>
          <input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)} />
          Полный доступ к API (все папки)
        </label>

        {!full && (
          <div className="rule-folders">
            {folders === null ? (
              <p className="muted">Загрузка папок…</p>
            ) : folders.length === 0 ? (
              <p className="muted">В этом API нет папок.</p>
            ) : (
              renderFolders(byP.get('root') || [])
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => onClose()}>Отмена</button>
          <button className="btn-primary" onClick={save} disabled={!valid || saving || users.length === 0}>
            {saving ? 'Создание…' : 'Создать правило'}
          </button>
        </div>
      </div>
    </div>
  )
}
