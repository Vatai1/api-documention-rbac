import React, { useState, useEffect, useMemo } from 'react'
import { getUsers, setUserAccesses, getApi } from './api.js'
import useFocusTrap from './useFocusTrap.js'

function initials(s) {
  return String(s || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

/**
 * Модалка «Изменить права доступа» — матрица пользователи × цели.
 * target:
 *   { kind: 'api',     api: { id, name } }                          — колонки: папки этого API
 *   { kind: 'folder',  api: полныйApi, folder: { id, name } }       — то же, колонка папки подсвечена
 *   { kind: 'endpoint', api: полныйApi }                            — колонки: эндпоинты этого API
 *   { kind: 'gfolder', folder: { id, name }, apiItems: [{id,name}] }— колонки: API внутри папки
 */
export default function AccessModal({ target, onClose }) {
  const ref = useFocusTrap(true)
  const isFolder = target.kind === 'folder'
  const isGFolder = target.kind === 'gfolder'
  const isEndpoint = target.kind === 'endpoint'
  const apiId = target.api?.id

  const [users, setUsers] = useState([])
  const [fullOrig, setFullOrig] = useState({})   // userId → полный список доступов (все API)
  const [fullDraft, setFullDraft] = useState({}) // редактируемая копия
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  // Папки API: для 'folder' уже есть в target.api, для 'api' догружаем (лёгкий объект без папок)
  const [apiFolders, setApiFolders] = useState(
    (target.kind === 'folder' || target.kind === 'endpoint') ? (target.api?.folders || []) : []
  )
  const apiEndpoints = target.api?.endpoints || []
  const [foldersLoaded, setFoldersLoaded] = useState(target.kind !== 'api')

  useEffect(() => {
    if (target.kind !== 'api' || !target.api?.id) return
    let cancelled = false
    getApi(target.api.id)
      .then(full => { if (!cancelled) { setApiFolders(full.folders || []); setFoldersLoaded(true) } })
      .catch(e => { setError(e.message); setFoldersLoaded(true) })
    return () => { cancelled = true }
  }, [])

  // ── Колонки матрицы ──
  const columns = useMemo(() => {
    if (isGFolder) {
      return (target.apiItems || []).map(a => ({ kind: 'api', id: a.id, name: a.name, depth: 0 }))
    }
    const byP = new Map([['root', []]])
    for (const fo of apiFolders) {
      const k = fo.parent_id ?? 'root'
      if (!byP.has(k)) byP.set(k, [])
      byP.get(k).push(fo)
    }
    if (isEndpoint) {
      // Эндпоинты по порядку обхода дерева папок; отступ = глубина папки
      const epsByF = new Map()
      for (const ep of apiEndpoints) {
        const k = ep.folder_id ?? 'root'
        if (!epsByF.has(k)) epsByF.set(k, [])
        epsByF.get(k).push(ep)
      }
      const flat = []
      const walk = (pid, depth) => {
        for (const fo of (byP.get(pid) || [])) {
          for (const ep of (epsByF.get(fo.id) || [])) {
            flat.push({ kind: 'ep', id: ep.id, name: `${ep.method} ${ep.path}`, depth })
          }
          walk(fo.id, depth + 1)
        }
      }
      walk('root', 0)
      for (const ep of (epsByF.get('root') || [])) {
        flat.push({ kind: 'ep', id: ep.id, name: `${ep.method} ${ep.path}`, depth: 0 })
      }
      return flat
    }
    const flat = []
    const walk = (pid, depth) => {
      for (const fo of (byP.get(pid) || [])) {
        flat.push({ kind: 'folder', id: fo.id, name: fo.name, depth })
        walk(fo.id, depth + 1)
      }
    }
    walk('root', 0)
    return flat
  }, [apiFolders, isEndpoint, isGFolder, target, apiEndpoints])

  // Поддеревья папочных колонок (отметка папки включает вложенные)
  const colSubtree = useMemo(() => {
    const m = new Map()
    if (isGFolder) return m
    for (const col of columns) {
      if (col.kind !== 'folder') continue
      const set = new Set([col.id])
      let changed = true
      while (changed) {
        changed = false
        for (const fo of apiFolders) {
          if (fo.parent_id != null && set.has(fo.parent_id) && !set.has(fo.id)) { set.add(fo.id); changed = true }
        }
      }
      m.set(col.id, set)
    }
    return m
  }, [columns, apiFolders, isGFolder])

  useEffect(() => {
    let cancelled = false
    getUsers()
      .then(us => {
        if (cancelled) return
        const nonAdmins = us.filter(u => !u.is_admin)
        const m = {}
        nonAdmins.forEach(u => {
          m[u.id] = (u.accesses || []).map(a => ({
            api_id: a.api_id,
            folder_ids: Array.isArray(a.folder_ids) ? [...a.folder_ids] : a.folder_ids,
            endpoint_ids: Array.isArray(a.endpoint_ids) ? [...a.endpoint_ids] : []
          }))
        })
        setUsers(nonAdmins)
        setFullOrig(JSON.parse(JSON.stringify(m)))
        setFullDraft(m)
      })
      .catch(e => setError(e.message))
    return () => { cancelled = true }
  }, [])

  // ── Состояние доступа ──
  const entryOf = (list) => (list || []).find(a => a.api_id === apiId)
  const isFull = (list) => { const a = entryOf(list); return !!a && a.folder_ids == null }
  const hasApiAccess = (list) => !!entryOf(list)

  const subOfFolder = useMemo(() => (fid) => {
    const set = new Set([fid])
    let changed = true
    while (changed) {
      changed = false
      for (const fo of apiFolders) {
        if (fo.parent_id != null && set.has(fo.parent_id) && !set.has(fo.id)) { set.add(fo.id); changed = true }
      }
    }
    return set
  }, [apiFolders])

  const epVisible = (list, ep) => {
    const acc = entryOf(list)
    if (!acc) return false
    if (acc.folder_ids == null) return true
    const F = ep.folder_id ?? null
    if (F != null && acc.folder_ids.some(r => subOfFolder(r).has(F))) return true
    return (acc.endpoint_ids || []).includes(ep.id)
  }

  const cellChecked = (list, col) => {
    if (col.kind === 'api') return (list || []).some(a => a.api_id === col.id)
    if (col.kind === 'ep') {
      const ep = apiEndpoints.find(x => x.id === col.id)
      return ep ? epVisible(list, ep) : false
    }
    const acc = entryOf(list)
    if (!acc) return false
    if (acc.folder_ids == null) return true
    const sub = colSubtree.get(col.id)
    return acc.folder_ids.some(id => sub.has(id))
  }

  const cellTitle = (list, col) => {
    if (col.kind === 'api') {
      const a = (list || []).find(x => x.api_id === col.id)
      return !a ? 'Нет доступа' : (a.folder_ids == null ? 'Полный доступ' : 'Выборочный доступ')
    }
    if (!entryOf(list)) return 'Нет доступа к API'
    return isFull(list) ? 'Полный доступ к API' : 'Доступ (с вложенными / к эндпоинту)'
  }

  // ── Изменения ──
  const cloneList = (userId) => (fullDraft[userId] || []).map(a => ({
    api_id: a.api_id,
    folder_ids: Array.isArray(a.folder_ids) ? [...a.folder_ids] : a.folder_ids,
    endpoint_ids: Array.isArray(a.endpoint_ids) ? [...a.endpoint_ids] : []
  }))

  const toggleCell = (userId, col) => {
    setFullDraft(prev => {
      const list = cloneList(userId)
      if (col.kind === 'api') {
        const i = list.findIndex(a => a.api_id === col.id)
        if (i >= 0) list.splice(i, 1)
        else list.push({ api_id: col.id, folder_ids: null, endpoint_ids: [] })
        return { ...prev, [userId]: list }
      }
      if (col.kind === 'ep') {
        const ep = apiEndpoints.find(x => x.id === col.id)
        if (!ep) return prev
        const F = ep.folder_id ?? null
        let acc = list.find(a => a.api_id === apiId)
        if (!acc) {
          list.push({ api_id: apiId, folder_ids: [], endpoint_ids: [ep.id] })
          return { ...prev, [userId]: list }
        }
        const full = acc.folder_ids == null
        const folderCovers = F != null && (full || (acc.folder_ids || []).some(r => subOfFolder(r).has(F)))
        const epGranted = (acc.endpoint_ids || []).includes(ep.id)
        if (folderCovers || epGranted) {
          // Снимаем: сужаем доступ, сохраняя видимость всего остального
          const roots = full ? apiFolders.map(f => f.id) : [...(acc.folder_ids || [])]
          const newRoots = []
          const newEps = new Set(acc.endpoint_ids || [])
          if (full) {
            // корневые эндпоинты были видны «полным» доступом — фиксируем индивидуально
            for (const e2 of apiEndpoints) if ((e2.folder_id ?? null) === null) newEps.add(e2.id)
          }
          for (const r of roots) {
            if (F != null && subOfFolder(r).has(F)) {
              // вместо гранта ветки: подпапки по отдельности + эндпоинты папки F кроме снимаемого
              for (const fo of apiFolders) if (fo.id !== F && subOfFolder(r).has(fo.id)) newRoots.push(fo.id)
              for (const e2 of apiEndpoints) if (e2.folder_id === F && e2.id !== ep.id) newEps.add(e2.id)
            } else newRoots.push(r)
          }
          newEps.delete(ep.id)
          acc.folder_ids = newRoots
          acc.endpoint_ids = [...newEps]
        } else {
          if (!Array.isArray(acc.endpoint_ids)) acc.endpoint_ids = []
          if (!acc.endpoint_ids.includes(ep.id)) acc.endpoint_ids.push(ep.id)
        }
        return { ...prev, [userId]: list }
      }
      let acc = list.find(a => a.api_id === apiId)
      if (!acc) { acc = { api_id: apiId, folder_ids: [], endpoint_ids: [] }; list.push(acc) }
      const sub = colSubtree.get(col.id)
      const full = acc.folder_ids == null
      const had = full || (Array.isArray(acc.folder_ids) && acc.folder_ids.some(id => sub.has(id)))
      if (had) {
        acc.folder_ids = full
          ? apiFolders.map(f => f.id).filter(id => !sub.has(id))
          : acc.folder_ids.filter(id => !sub.has(id))
      } else {
        if (!Array.isArray(acc.folder_ids)) acc.folder_ids = []
        for (const id of sub) if (!acc.folder_ids.includes(id)) acc.folder_ids.push(id)
      }
      return { ...prev, [userId]: list }
    })
  }

  const toggleFull = (userId) => {
    setFullDraft(prev => {
      const list = cloneList(userId)
      const acc = list.find(a => a.api_id === apiId)
      if (!acc) return prev
      acc.folder_ids = acc.folder_ids == null ? [] : null
      return { ...prev, [userId]: list }
    })
  }

  const changed = users.filter(u =>
    JSON.stringify(fullOrig[u.id] || []) !== JSON.stringify(fullDraft[u.id] || []))
  const dirty = changed.length > 0

  const save = async () => {
    setSaving(true); setError('')
    try {
      for (const u of changed) await setUserAccesses(u.id, fullDraft[u.id] || [])
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  // ── Подпись ──
  const subtitle = isGFolder
    ? `Папка «${target.folder.name}» — доступ к столбцу = полный доступ к API`
    : isEndpoint
      ? `API «${target.api.name}» — доступ к отдельным эндпоинтам`
      : isFolder
        ? `Папка «${target.folder.name}» в API «${target.api.name}»`
        : `API «${target.api.name}» — отметьте доступные папки`

  const fq = q.trim().toLowerCase()
  const filtered = users.filter(u => !fq ||
    u.username?.toLowerCase().includes(fq) ||
    u.fullName?.toLowerCase().includes(fq) ||
    u.email?.toLowerCase().includes(fq))

  const colCount = columns.length + (isGFolder ? 0 : 1)

  // Ширина модалки растёт с числом колонок — чтобы не скроллить по горизонтали
  const modalWidth = useMemo(() => {
    const need = 260 + (isGFolder ? 0 : 100) + columns.length * 155
    const maxW = Math.min(1560, window.innerWidth - 48)
    return Math.max(600, Math.min(need, maxW))
  }, [columns, isGFolder])

  return (
    <div className="modal-overlay" onClick={() => onClose()}>
      <div
        className="modal am-modal"
        style={{ width: modalWidth }}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Права доступа"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
      >
        <div className="am-head">
          <div className="am-icon">🔐</div>
          <div className="am-head-text">
            <h3>Права доступа</h3>
            <div className="am-sub" title={subtitle}>{subtitle}</div>
          </div>
          <button className="modal-close" onClick={() => onClose()}>✕</button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {users.length === 0 ? (
          <p className="muted" style={{ padding: '12px 0' }}>
            Нет обычных пользователей — права назначать некому.
            Создайте пользователя без прав администратора в разделе «Админка → Пользователи».
          </p>
        ) : (
          <>
            <div className="am-toolbar">
              <div className="admin-search">
                <span className="search-ico">🔍</span>
                <input
                  placeholder="Поиск пользователей…"
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  autoFocus
                />
              </div>
              <span className="am-hint">
                {!foldersLoaded ? 'Загрузка папок…' : 'Отметка папки включает вложенные подпапки'}
              </span>
            </div>

            <div className="am-wrap">
              <table className="am-table">
                <thead>
                  <tr>
                    <th className="am-user-col">Пользователь</th>
                    {!isGFolder && <th className="am-full-col" title="Доступ ко всему API без ограничений по папкам">★ Полный</th>}
                    {columns.map(col => (
                      <th
                        key={col.id}
                        className={isFolder && col.id === target.folder.id ? 'am-target' : ''}
                        title={col.name}
                      >
                        <div style={{ paddingLeft: col.depth * 10 }}>
                          {col.kind === 'folder' ? '📁' : col.kind === 'ep' ? '🔌' : '📄'} {col.name}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => {
                    const list = fullDraft[u.id] || []
                    return (
                      <tr key={u.id}>
                        <td className="am-user-col">
                          <div className="am-user">
                            <div className="avatar small">{initials(u.fullName || u.username)}</div>
                            <div className="am-user-text">
                              <b>{u.fullName || u.username}</b>
                              <span className="muted">{u.username}</span>
                            </div>
                          </div>
                        </td>
                        {!isGFolder && (
                          <td className="am-full-col">
                            <input
                              type="checkbox"
                              checked={isFull(list)}
                              disabled={!hasApiAccess(list)}
                              onChange={() => toggleFull(u.id)}
                              title="Полный доступ к API"
                            />
                          </td>
                        )}
                        {columns.map(col => (
                          <td key={col.id} className={isFolder && col.id === target.folder.id ? 'am-target' : ''}>
                            <input
                              type="checkbox"
                              checked={cellChecked(list, col)}
                              onChange={() => toggleCell(u.id, col)}
                              title={cellTitle(list, col)}
                            />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={colCount + 1} className="am-empty">
                        Пользователи не найдены — измените запрос
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="modal-actions">
              <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>
                {dirty ? `Изменений: ${changed.length}` : 'Без изменений'}
              </span>
              <button className="btn-secondary" onClick={() => onClose()}>Отмена</button>
              <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
