import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import ContextMenu from './ContextMenu.jsx'
import MoveDialog from './MoveDialog.jsx'
import AccessModal from './AccessModal.jsx'
import Highlight from './Highlight.jsx'
import { toast } from './toast.js'
import {
  createFolder, updateFolder, deleteFolder, moveEndpointTo, reorderFolder, updateApi,
  createTreeFolder, updateTreeFolder, deleteTreeFolder, reorderTreeFolder, moveApiToFolder
} from './api.js'

const METHOD_CLASS = {
  GET: 'm-get', POST: 'm-post', PUT: 'm-put',
  DELETE: 'm-delete', PATCH: 'm-patch'
}

/* Inline-инпут для создания/переименования папки прямо в дереве */
function TreeInput({ initial, onCommit, onCancel }) {
  const [val, setVal] = useState(initial)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      className="tree-input"
      value={val}
      placeholder="Название папки"
      onClick={e => e.stopPropagation()}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onCommit(val.trim())
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onCancel}
    />
  )
}

export default function Sidebar({
  apis, treeFolders, activeApi, apiDetails, activeEndpoint, search, user,
  favorites, isFav, onToggleFav, labelMode, recent,
  openSpecs, setOpenSpecs, openFolders, setOpenFolders, gOpen, setGOpen,
  onSelectApi, onSelectEndpoint, onSelectEndpointOf, onExpandApi, onApiChanged, onTreeChanged
}) {
  const isAdmin = !!user?.is_admin
  const [menu, setMenu] = useState(null)             // { x, y, items }
  const [creating, setCreating] = useState(null)     // { scope: 'api'|'global', parentId }
  const [renaming, setRenaming] = useState(null)     // { scope: 'api'|'global', id }
  const [renamingApi, setRenamingApi] = useState(null) // id API
  const [moveDlg, setMoveDlg] = useState(null)       // { scope: 'folder'|'endpoint'|'global'|'api', id }
  const [accessDlg, setAccessDlg] = useState(null)   // { kind: 'api'|'folder', api, folder? }
  const [dropHint, setDropHint] = useState(null)     // { key, mode: 'into'|'before'|'after' }
  const [dragging, setDragging] = useState(null)     // { type: 'folder'|'endpoint'|'global'|'api', id }
  const [multiSel, setMultiSel] = useState(() => new Set()) // Ctrl+клик: выбранные эндпоинты активного API

  // Подпись эндпоинта: путь или название (режим имён)
  const epLabel = (ep) => labelMode === 'name'
    ? (ep.summary || ep.path)
    : ep.path

  const folders = activeApi?.folders || []
  const endpoints = activeApi?.endpoints || []
  const f = search.toLowerCase()

  // ── Индексы: папки эндпоинтов ──
  const byParent = useMemo(() => {
    const m = new Map([['root', []]])
    for (const fo of folders) {
      const key = fo.parent_id ?? 'root'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(fo)
    }
    for (const list of m.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    return m
  }, [folders])

  const epsByFolder = useMemo(() => {
    const m = new Map()
    for (const ep of endpoints) {
      const key = ep.folder_id ?? 'root'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(ep)
    }
    return m
  }, [endpoints])

  const subtreeIds = useCallback((fid) => {
    const set = new Set([fid])
    let changed = true
    while (changed) {
      changed = false
      for (const fo of folders) {
        if (fo.parent_id != null && set.has(fo.parent_id) && !set.has(fo.id)) { set.add(fo.id); changed = true }
      }
    }
    return set
  }, [folders])

  const countInSubtree = useCallback((fid) => {
    const sub = subtreeIds(fid)
    return endpoints.filter(ep => sub.has(ep.folder_id)).length
  }, [subtreeIds, endpoints])

  // ── Индексы: глобальные папки ──
  const gByParent = useMemo(() => {
    const m = new Map([['root', []]])
    for (const fo of treeFolders) {
      const key = fo.parent_id ?? 'root'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(fo)
    }
    for (const list of m.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0) || a.id - b.id)
    return m
  }, [treeFolders])

  const apisByGFolder = useMemo(() => {
    const m = new Map([['root', []]])
    for (const a of apis) {
      const key = a.folder_id ?? 'root'
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(a)
    }
    return m
  }, [apis])

  const gSubtreeIds = useCallback((fid) => {
    const set = new Set([fid])
    let changed = true
    while (changed) {
      changed = false
      for (const fo of treeFolders) {
        if (fo.parent_id != null && set.has(fo.parent_id) && !set.has(fo.id)) { set.add(fo.id); changed = true }
      }
    }
    return set
  }, [treeFolders])

  const gCountApis = useCallback((fid) => {
    const sub = gSubtreeIds(fid)
    return apis.filter(a => a.folder_id != null && sub.has(a.folder_id)).length
  }, [gSubtreeIds, apis])

  // ── Поиск ──
  const epMatch = (ep) => !f ||
    ep.path?.toLowerCase().includes(f) ||
    ep.summary?.toLowerCase().includes(f) ||
    ep.method?.toLowerCase().includes(f)

  const folderHasMatch = (fo) => {
    if (!f) return true
    if (fo.name.toLowerCase().includes(f)) return true
    const sub = subtreeIds(fo.id)
    if (endpoints.some(ep => sub.has(ep.folder_id) && epMatch(ep))) return true
    return folders.some(x => x.id !== fo.id && sub.has(x.id) && x.name.toLowerCase().includes(f))
  }

  const gFolderHasMatch = (fo) => {
    if (!f) return true
    if (fo.name.toLowerCase().includes(f)) return true
    const sub = gSubtreeIds(fo.id)
    if (apis.some(a => a.folder_id != null && sub.has(a.folder_id) &&
      (a.name?.toLowerCase().includes(f) || a.title?.toLowerCase().includes(f)))) return true
    return treeFolders.some(x => x.id !== fo.id && sub.has(x.id) && x.name.toLowerCase().includes(f))
  }

  const apiMatch = (a) => !f ||
    a.name?.toLowerCase().includes(f) ||
    a.title?.toLowerCase().includes(f)

  // ── Недавние: свёрнутость секции (по умолчанию свёрнута) ──
  const [recentOpen, setRecentOpen] = useState(() => {
    try { return localStorage.getItem('recent_open') === '1' } catch { return false }
  })
  const toggleRecent = () => {
    setRecentOpen(o => {
      const next = !o
      try { localStorage.setItem('recent_open', next ? '1' : '0') } catch { /* нет доступа */ }
      return next
    })
  }

  // ── Клавиатурная навигация: плоский список видимых строк дерева ──
  // Ключи совпадают с data-key строк рендера: a{id}, g{id}, f{id}, e{epId}
  const treeRef = useRef(null)
  const [cursor, setCursor] = useState(-1)

  const flatItems = useMemo(() => {
    const out = []
    const walkEps = (fid) => {
      for (const ep of (epsByFolder.get(fid) || []).filter(epMatch)) {
        out.push({ key: `e${ep.id}`, kind: 'ep', ep })
      }
    }
    const walkFolders = (pid) => {
      for (const fo of (byParent.get(pid) || [])) {
        if (f && !folderHasMatch(fo)) continue
        out.push({ key: `f${fo.id}`, kind: 'folder', fo })
        if (f || openFolders[fo.id] !== false) { walkFolders(fo.id); walkEps(fo.id) }
      }
    }
    const walkApi = (a) => {
      if (f && !apiMatch(a)) return
      out.push({ key: `a${a.id}`, kind: 'api', api: a })
      const open = !!f || openSpecs[a.id] !== false
      if (!open || a.id !== activeApi?.id) return
      walkFolders('root')
      walkEps('root')
    }
    const walkG = (pid) => {
      for (const fo of (gByParent.get(pid) || [])) {
        if (f && !gFolderHasMatch(fo)) continue
        out.push({ key: `g${fo.id}`, kind: 'gfolder', fo })
        if (f || gOpen[fo.id] !== false) {
          walkG(fo.id)
          for (const a of (apisByGFolder.get(fo.id) || [])) walkApi(a)
        }
      }
    }
    walkG('root')
    for (const a of (apisByGFolder.get('root') || [])) walkApi(a)
    return out
  }, [f, apis, activeApi, apiDetails, treeFolders, openSpecs, openFolders, gOpen,
    byParent, epsByFolder, gByParent, apisByGFolder, epMatch, folderHasMatch, gFolderHasMatch, apiMatch])

  const idxMap = useMemo(() => new Map(flatItems.map((x, i) => [x.key, i])), [flatItems])

  const scrollIdx = (i) => {
    treeRef.current?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  // Курсор следует за активным эндпоинтом
  useEffect(() => {
    if (activeEndpoint == null) return
    setCursor(c => {
      const i = idxMap.get(`e${activeEndpoint.id}`)
      return i != null ? i : c
    })
  }, [activeEndpoint?.id, idxMap])

  const onTreeKeyDown = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (!flatItems.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => {
        const n = e.key === 'ArrowDown'
          ? Math.min(c + 1, flatItems.length - 1)
          : Math.max(c - 1, 0)
        scrollIdx(n)
        return n
      })
    } else if (e.key === 'Home') {
      e.preventDefault(); setCursor(0); scrollIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault(); setCursor(flatItems.length - 1); scrollIdx(flatItems.length - 1)
    } else if (e.key === 'Enter') {
      const it = flatItems[cursor]
      if (!it) return
      e.preventDefault()
      if (it.kind === 'ep') onSelectEndpoint(it.ep)
      else if (it.kind === 'folder') { if (!f) toggleFolder(it.fo.id) }
      else if (it.kind === 'gfolder') { if (!f) toggleGFolder(it.fo.id) }
      else if (it.kind === 'api') {
        const a = it.api
        const isClosed = openSpecs[a.id] === false
        if (isClosed) {
          setOpenSpecs(s => ({ ...s, [a.id]: true }))
          onExpandApi?.(a.id)
          if (activeApi?.id !== a.id) onSelectApi(a.id)
        } else {
          setOpenSpecs(s => ({ ...s, [a.id]: false }))
        }
      }
    }
  }

  // Подсветка совпадений поиска в подписях
  const hl = (text) => (f ? <Highlight text={text} query={search} /> : text)

  // Пустой результат поиска (учитываем и read-only деревья других API)
  const anyHit = useMemo(() => {
    if (!f) return true
    if (apis.some(apiMatch) || treeFolders.some(fo => fo.name.toLowerCase().includes(f))) return true
    const detHit = d =>
      (d.folders || []).some(x => x.name.toLowerCase().includes(f)) ||
      (d.endpoints || []).some(epMatch)
    if (activeApi && detHit(activeApi)) return true
    return Object.values(apiDetails).some(detHit)
  }, [f, apis, treeFolders, apiDetails, activeApi, epMatch, apiMatch])

  const rowCls = (key, extra = '') => {
    const i = idxMap.get(key)
    return `${extra} ${i != null && i === cursor ? 'kb-cursor' : ''}`
  }
  const rowIdx = (key) => idxMap.get(key)

  // ── Действия ──
  const toggleSpec = (id) => setOpenSpecs(s => ({ ...s, [id]: s[id] === false }))
  const toggleFolder = (fid) => !f && setOpenFolders(s => ({ ...s, [fid]: s[fid] === false }))
  const toggleGFolder = (fid) => !f && setGOpen(s => ({ ...s, [fid]: s[fid] === false }))

  const doCreate = async (name, parentId) => {
    if (!name) return
    try {
      await createFolder(activeApi.id, name, parentId)
      toast(`Папка «${name}» создана`, 'success')
      onApiChanged()
    } catch (err) { toast('Ошибка: ' + err.message, 'error') }
  }

  const doCreateGlobal = async (name, parentId) => {
    if (!name) return
    try {
      await createTreeFolder(name, parentId)
      toast(`Папка «${name}» создана`, 'success')
      onTreeChanged()
    } catch (err) { toast('Ошибка: ' + err.message, 'error') }
  }

  // ── Контекстные меню ──
  // stopPropagation (synthetic + native): событие не долетает до document-слушателей ContextMenu
  const menuOpen = (e) => {
    e.preventDefault(); e.stopPropagation()
    e.nativeEvent.stopPropagation()
  }

  const rootAreaMenu = (e) => {
    if (!isAdmin) return
    menuOpen(e)
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Создать папку', icon: '📁', onClick: () => setCreating({ scope: 'global', parentId: null }) },
      ]
    })
  }

  const gFolderMenu = (e, fo) => {
    if (!isAdmin) return
    menuOpen(e)
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Создать подпапку', icon: '📂', onClick: () => { setGOpen(s => ({ ...s, [fo.id]: true })); setCreating({ scope: 'global', parentId: fo.id }) } },
        { label: 'Переименовать', icon: '✏️', onClick: () => setRenaming({ scope: 'global', id: fo.id }) },
        { label: 'Переместить в…', icon: '➡️', onClick: () => setMoveDlg({ scope: 'global', id: fo.id }) },
        { separator: true },
        {
          label: 'Изменить права доступа…', icon: '🔐',
          onClick: () => {
            const sub = gSubtreeIds(fo.id)
            const apiItems = apis
              .filter(a => a.folder_id != null && sub.has(a.folder_id))
              .map(a => ({ id: a.id, name: a.name }))
            setAccessDlg({ kind: 'gfolder', folder: fo, apiItems })
          }
        },
        { separator: true },
        {
          label: 'Удалить', icon: '🗑', danger: true,
          onClick: async () => {
            if (!confirm(`Удалить папку «${fo.name}»?\nAPI и подпапки поднимутся на уровень выше.`)) return
            try { await deleteTreeFolder(fo.id); onTreeChanged() }
            catch (err) { toast('Ошибка: ' + err.message, 'error') }
          }
        },
      ]
    })
  }

  const apiMenu = (e, api) => {
    if (!isAdmin) return
    menuOpen(e)
    const items = []
    if (api.id === activeApi?.id) {
      items.push({ label: 'Создать папку', icon: '📁', onClick: () => setCreating({ scope: 'api', parentId: null }) })
    }
    items.push({ label: 'Переименовать', icon: '✏️', onClick: () => setRenamingApi(api.id) })
    items.push({ label: 'Переместить API в…', icon: '➡️', onClick: () => setMoveDlg({ scope: 'api', id: api.id }) })
    items.push({ separator: true })
    items.push({ label: 'Изменить права доступа…', icon: '🔐', onClick: () => setAccessDlg({ kind: 'api', api }) })
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const folderMenu = (e, fo) => {
    if (!isAdmin) return
    menuOpen(e)
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Создать подпапку', icon: '📂', onClick: () => { setOpenFolders(s => ({ ...s, [fo.id]: true })); setCreating({ scope: 'api', parentId: fo.id }) } },
        { label: 'Переименовать', icon: '✏️', onClick: () => setRenaming({ scope: 'api', id: fo.id }) },
        { label: 'Переместить в…', icon: '➡️', onClick: () => setMoveDlg({ scope: 'folder', id: fo.id }) },
        { separator: true },
        { label: 'Изменить права доступа…', icon: '🔐', onClick: () => setAccessDlg({ kind: 'folder', api: activeApi, folder: fo }) },
        { separator: true },
        {
          label: 'Удалить', icon: '🗑', danger: true,
          onClick: async () => {
            if (!confirm(`Удалить папку «${fo.name}»?\nСодержимое поднимется на уровень выше.`)) return
            try { await deleteFolder(activeApi.id, fo.id); onApiChanged() }
            catch (err) { toast('Ошибка: ' + err.message, 'error') }
          }
        },
      ]
    })
  }

  const endpointMenu = (e, ep) => {
    if (!isAdmin) return
    menuOpen(e)
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Переместить в папку…', icon: '➡️', onClick: () => setMoveDlg({ scope: 'endpoint', id: ep.id }) },
        { label: 'Изменить права доступа…', icon: '🔐', onClick: () => setAccessDlg({ kind: 'endpoint', api: activeApi }) },
      ]
    })
  }

  // ── Зоны падения: верх/низ/центр ──
  const zoneOf = (e, positional) => {
    if (!positional || (dragging?.type !== 'folder' && dragging?.type !== 'global')) return 'into'
    const rect = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientY - rect.top) / Math.max(1, rect.height)
    if (rel < 0.3) return 'before'
    if (rel > 0.7) return 'after'
    return 'into'
  }

  const setHint = (key, mode) => setDropHint(prev => (prev && prev.key === key && prev.mode === mode ? prev : { key, mode }))
  const clearDrop = (key) => setDropHint(h => (h?.key === key ? null : h))
  const hintClass = (key) => {
    const h = dropHint?.key === key ? dropHint : null
    if (!h) return ''
    return h.mode === 'before' ? 'drop-before' : h.mode === 'after' ? 'drop-after' : 'drop-target'
  }

  // ── DnD: дерево эндпоинтов активного API ──
  const onFolderDragStart = (e, fo) => {
    setDragging({ type: 'folder', id: fo.id })
    e.dataTransfer.setData('application/x-folder', String(fo.id))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onEndpointDragStart = (e, ep) => {
    setDragging({ type: 'endpoint', id: ep.id })
    e.dataTransfer.setData('application/x-endpoint', String(ep.id))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragEnd = () => setDragging(null)

  const handleDragOver = (e, key, targetFolderId, positional) => {
    if (!isAdmin || !dragging) return
    if (dragging.type !== 'folder' && dragging.type !== 'endpoint') return
    const mode = zoneOf(e, positional)
    if (dragging.type === 'folder' && targetFolderId != null) {
      if (targetFolderId === dragging.id || subtreeIds(dragging.id).has(targetFolderId)) return
    }
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setHint(key, mode)
  }

  const handleDrop = async (e, targetFolderId, positional) => {
    e.preventDefault(); e.stopPropagation()
    if (!isAdmin || !activeApi || !dragging) return
    if (dragging.type !== 'folder' && dragging.type !== 'endpoint') return
    const mode = zoneOf(e, positional)
    setDropHint(null)

    // Перестановка папки до/после другой
    if (dragging.type === 'folder' && mode !== 'into' && targetFolderId != null) {
      try {
        const target = folders.find(x => x.id === targetFolderId)
        await reorderFolder(activeApi.id, dragging.id, targetFolderId, mode)
        const np = target?.parent_id ?? null
        if (np != null) setOpenFolders(s => ({ ...s, [np]: true }))
        onApiChanged()
      } catch (err) {
        toast('Ошибка: ' + err.message, 'error')
      } finally {
        setDragging(null)
      }
      return
    }

    const target = targetFolderId ?? null
    try {
      if (dragging.type === 'folder') {
        const fo = folders.find(x => x.id === dragging.id)
        if (!fo || fo.parent_id === target) return
        await updateFolder(activeApi.id, dragging.id, { parent_id: target })
        toast(`Папка «${fo.name}» перемещена`, 'success')
      } else {
        // Мульти-перенос: если тащат один из выбранных (Ctrl+клик) — переносим всех выбранных
        const ids = (multiSel.has(dragging.id) && multiSel.size > 1) ? [...multiSel] : [dragging.id]
        const ep = endpoints.find(x => x.id === dragging.id)
        if (!ep || (ep.folder_id ?? null) === target) return
        await Promise.all(ids.map(id => moveEndpointTo(activeApi.id, id, target)))
        toast(`Перемещено эндпоинтов: ${ids.length}`, 'success')
        setMultiSel(new Set())
      }
      if (target != null) setOpenFolders(s => ({ ...s, [target]: true }))
      onApiChanged()
    } catch (err) {
      toast('Ошибка: ' + err.message, 'error')
    } finally {
      setDragging(null)
    }
  }

  // ── DnD: глобальное дерево (папки вне API + сами API) ──
  const onGFolderDragStart = (e, fo) => {
    setDragging({ type: 'global', id: fo.id })
    e.dataTransfer.setData('application/x-gfolder', String(fo.id))
    e.dataTransfer.effectAllowed = 'move'
  }
  const onApiDragStart = (e, api) => {
    setDragging({ type: 'api', id: api.id })
    e.dataTransfer.setData('application/x-api', String(api.id))
    e.dataTransfer.effectAllowed = 'move'
  }

  const gDragOver = (e, key, targetFid, positional) => {
    if (!isAdmin || !dragging) return
    if (dragging.type !== 'global' && dragging.type !== 'api') return
    const mode = dragging.type === 'global' ? zoneOf(e, positional) : 'into'
    if (dragging.type === 'global' && targetFid != null) {
      if (targetFid === dragging.id || gSubtreeIds(dragging.id).has(targetFid)) return
    }
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setHint(key, mode)
  }

  const gDrop = async (e, targetFid, positional) => {
    e.preventDefault(); e.stopPropagation()
    if (!isAdmin || !dragging) return
    if (dragging.type !== 'global' && dragging.type !== 'api') return
    const mode = dragging.type === 'global' ? zoneOf(e, positional) : 'into'
    setDropHint(null)
    const target = targetFid ?? null
    try {
      if (dragging.type === 'global') {
        if (mode !== 'into' && targetFid != null) {
          await reorderTreeFolder(dragging.id, targetFid, mode)
        } else {
          const fo = treeFolders.find(x => x.id === dragging.id)
          if (!fo || fo.parent_id === target) return
          await updateTreeFolder(dragging.id, { parent_id: target })
        }
      } else {
        const api = apis.find(x => x.id === dragging.id)
        if (!api || (api.folder_id ?? null) === target) return
        await moveApiToFolder(dragging.id, target)
      }
      if (targetFid != null) setGOpen(s => ({ ...s, [targetFid]: true }))
      onTreeChanged()
    } catch (err) {
      toast('Ошибка: ' + err.message, 'error')
    } finally {
      setDragging(null)
    }
  }

  // ── Рендер: дерево эндпоинтов ──
  const toggleMultiSel = (epId) => {
    setMultiSel(prev => {
      const next = new Set(prev)
      if (next.has(epId)) next.delete(epId)
      else next.add(epId)
      return next
    })
  }

  const renderEndpoints = (parentId) => {
    const eps = (epsByFolder.get(parentId ?? 'root') || []).filter(epMatch)
    return eps.map(ep => {
      const dKey = `e${ep.id}`
      const selected = multiSel.has(ep.id)
      return (
        <div
          key={dKey}
          data-key={dKey}
          data-idx={rowIdx(dKey)}
          role="treeitem"
          aria-selected={activeEndpoint?.id === ep.id}
          className={`tree-ep ${activeEndpoint?.id === ep.id ? 'active' : ''} ${hintClass(dKey)} ${selected ? 'multi' : ''} ${rowCls(dKey)}`}
          onClick={e => {
            if ((e.ctrlKey || e.metaKey) && isAdmin) { e.stopPropagation(); toggleMultiSel(ep.id); return }
            onSelectEndpoint(ep)
          }}
          onContextMenu={e => { onSelectEndpoint(ep); endpointMenu(e, ep) }}
          draggable={isAdmin}
          onDragStart={e => onEndpointDragStart(e, ep)}
          onDragEnd={onDragEnd}
          onDragOver={e => handleDragOver(e, dKey, ep.folder_id ?? null)}
          onDragLeave={() => clearDrop(dKey)}
          onDrop={e => handleDrop(e, ep.folder_id ?? null)}
        >
          <span className={`badge ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
          <span className="ep-path" title={ep.path}>{hl(epLabel(ep))}</span>
          {multiSel.size > 0 && selected && <span className="multi-count">{multiSel.size}</span>}
          <span
            className={`ep-star ${isFav?.(activeApi?.id, ep.id) ? 'on' : ''}`}
            title={isFav?.(activeApi?.id, ep.id) ? 'Убрать из избранного' : 'В избранное'}
            onClick={e => { e.stopPropagation(); onToggleFav?.(activeApi?.id, ep.id) }}
          >
            {isFav?.(activeApi?.id, ep.id) ? '★' : '☆'}
          </span>
        </div>
      )
    })
  }

  const renderCreateInput = (parentId) => (
    <div className="tree-folder-head creating">
      <span className="arrow" />
      <span className="icon">📁</span>
      <TreeInput
        initial=""
        onCommit={v => { setCreating(null); doCreate(v, parentId) }}
        onCancel={() => setCreating(null)}
      />
    </div>
  )

  const renderFolder = (fo) => {
    if (f && !folderHasMatch(fo)) return null
    const open = !!f || openFolders[fo.id] !== false
    const dKey = `f${fo.id}`
    const isRenaming = renaming?.scope === 'api' && renaming.id === fo.id
    return (
      <div key={dKey} className="tree-folder">
        <div
          data-key={dKey}
          data-idx={rowIdx(dKey)}
          role="treeitem"
          aria-expanded={open}
          className={`tree-folder-head ${hintClass(dKey)} ${rowCls(dKey)}`}
          onClick={() => toggleFolder(fo.id)}
          onContextMenu={e => folderMenu(e, fo)}
          draggable={isAdmin && !isRenaming}
          onDragStart={e => onFolderDragStart(e, fo)}
          onDragEnd={onDragEnd}
          onDragOver={e => handleDragOver(e, dKey, fo.id, true)}
          onDragLeave={() => clearDrop(dKey)}
          onDrop={e => handleDrop(e, fo.id, true)}
        >
          <span className="arrow">{open ? '▼' : '▶'}</span>
          <span className="icon">{open ? '📂' : '📁'}</span>
          {isRenaming ? (
            <TreeInput
              initial={fo.name}
              onCommit={async v => {
                setRenaming(null)
                if (v && v !== fo.name) {
                  try { await updateFolder(activeApi.id, fo.id, { name: v }); onApiChanged() }
                  catch (err) { toast('Ошибка: ' + err.message, 'error') }
                }
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="name">{hl(fo.name)}</span>
          )}
          <span className="count">{countInSubtree(fo.id)}</span>
        </div>
        {open && (
          <div className="tree-folder-children">
            {creating && creating.scope === 'api' && creating.parentId === fo.id && renderCreateInput(fo.id)}
            {(byParent.get(fo.id) || []).map(ch => renderFolder(ch))}
            {renderEndpoints(fo.id)}
          </div>
        )}
      </div>
    )
  }

  // ── Рендер: глобальное дерево ──
  const renderGCreateInput = (parentId) => (
    <div className="tree-folder-head creating">
      <span className="arrow" />
      <span className="icon">📁</span>
      <TreeInput
        initial=""
        onCommit={v => { setCreating(null); doCreateGlobal(v, parentId) }}
        onCancel={() => setCreating(null)}
      />
    </div>
  )

  // Read-only дерево для развернутого, но не активного API
  const renderReadOnlyTree = (det) => {
    const fol = det.folders || []
    const eps = det.endpoints || []
    const byP = new Map([['root', []]])
    for (const fo of fol) {
      const k = fo.parent_id ?? 'root'
      if (!byP.has(k)) byP.set(k, [])
      byP.get(k).push(fo)
    }
    const epsByF = new Map([['root', []]])
    for (const ep of eps) {
      const k = ep.folder_id ?? 'root'
      if (!epsByF.has(k)) epsByF.set(k, [])
      epsByF.get(k).push(ep)
    }
    const renderEp = (ep) => (
      <div
        key={`ro-e${ep.id}`}
        className={`tree-ep ${activeApi?.id === det.id && activeEndpoint?.id === ep.id ? 'active' : ''}`}
        onClick={() => onSelectEndpointOf?.(det.id, ep.id)}
        title={ep.path}
      >
        <span className={`badge ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
        <span className="ep-path">{hl(epLabel(ep))}</span>
      </div>
    )
    const renderF = (fo) => (
      <div key={`ro-f${fo.id}`} className="tree-folder">
        <div className="tree-folder-head readonly">
          <span className="arrow">▼</span>
          <span className="icon">📂</span>
          <span className="name">{fo.name}</span>
        </div>
        <div className="tree-folder-children">
          {(byP.get(fo.id) || []).map(renderF)}
          {(epsByF.get(fo.id) || []).filter(epMatch).map(renderEp)}
        </div>
      </div>
    )
    return (
      <>
        {(byP.get('root') || []).map(renderF)}
        {(epsByF.get('root') || []).filter(epMatch).map(renderEp)}
      </>
    )
  }

  const renderApiHead = (api) => {
    if (f && !apiMatch(api)) return null
    const isOpen = !!f || openSpecs[api.id] !== false
    const isActive = activeApi?.id === api.id
    const details = apiDetails?.[api.id] || (isActive ? activeApi : null)
    return (
      <div key={`a${api.id}`} className="tree-spec">
        <div
          data-key={`a${api.id}`}
          data-idx={rowIdx(`a${api.id}`)}
          role="treeitem"
          aria-expanded={isOpen}
          className={`tree-spec-head ${isActive ? 'selected' : ''} ${hintClass('root')} ${rowCls(`a${api.id}`)}`}
          onClick={() => {
            if (renamingApi === api.id) return
            const isClosed = openSpecs[api.id] === false
            if (isClosed) {
              setOpenSpecs(s => ({ ...s, [api.id]: true }))
              onExpandApi?.(api.id)
              if (activeApi?.id !== api.id) onSelectApi(api.id)
            } else {
              setOpenSpecs(s => ({ ...s, [api.id]: false }))
            }
          }}
          onContextMenu={e => apiMenu(e, api)}
          draggable={isAdmin && renamingApi !== api.id}
          onDragStart={e => onApiDragStart(e, api)}
          onDragEnd={onDragEnd}
          onDragOver={e => handleDragOver(e, 'root', null)}
          onDragLeave={() => clearDrop('root')}
          onDrop={e => handleDrop(e, null)}
        >
          <span
            className="arrow"
            onClick={e => { e.stopPropagation(); toggleSpec(api.id); onExpandApi?.(api.id) }}
          >
            {isOpen ? '▼' : '▶'}
          </span>
          <span className="icon">📄</span>
          {renamingApi === api.id ? (
            <TreeInput
              initial={api.name}
              onCommit={async v => {
                setRenamingApi(null)
                if (v && v !== api.name) {
                  try { await updateApi(api.id, { name: v }); toast('API переименован', 'success'); onTreeChanged() }
                  catch (err) { toast('Ошибка: ' + err.message, 'error') }
                }
              }}
              onCancel={() => setRenamingApi(null)}
            />
          ) : (
            <span className="name">{hl(api.name)}</span>
          )}
          <span className="count">{api.endpoint_count}</span>
        </div>

        {isOpen && details && (
          <div className="tree-body">
            {isActive ? (
              <>
                {creating && creating.scope === 'api' && creating.parentId === null && renderCreateInput(null)}
                {(byParent.get('root') || []).map(fo => renderFolder(fo))}
                {renderEndpoints(null)}
              </>
            ) : renderReadOnlyTree(details)}
          </div>
        )}
      </div>
    )
  }

  const renderGlobalFolder = (fo) => {
    if (f && !gFolderHasMatch(fo)) return null
    const open = !!f || gOpen[fo.id] !== false
    const dKey = `g${fo.id}`
    const isRenaming = renaming?.scope === 'global' && renaming.id === fo.id
    return (
      <div key={dKey} className="tree-folder">
        <div
          data-key={dKey}
          data-idx={rowIdx(dKey)}
          role="treeitem"
          aria-expanded={open}
          className={`tree-folder-head global ${hintClass(dKey)} ${rowCls(dKey)}`}
          onClick={() => toggleGFolder(fo.id)}
          onContextMenu={e => gFolderMenu(e, fo)}
          draggable={isAdmin && !isRenaming}
          onDragStart={e => onGFolderDragStart(e, fo)}
          onDragEnd={onDragEnd}
          onDragOver={e => gDragOver(e, dKey, fo.id, true)}
          onDragLeave={() => clearDrop(dKey)}
          onDrop={e => gDrop(e, fo.id, true)}
        >
          <span className="arrow">{open ? '▼' : '▶'}</span>
          <span className="icon">{open ? '📂' : '📁'}</span>
          {isRenaming ? (
            <TreeInput
              initial={fo.name}
              onCommit={async v => {
                setRenaming(null)
                if (v && v !== fo.name) {
                  try { await updateTreeFolder(fo.id, { name: v }); onTreeChanged() }
                  catch (err) { toast('Ошибка: ' + err.message, 'error') }
                }
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <span className="name">{hl(fo.name)}</span>
          )}
          <span className="count">{gCountApis(fo.id)}</span>
        </div>
        {open && (
          <div className="tree-folder-children">
            {creating && creating.scope === 'global' && creating.parentId === fo.id && renderGCreateInput(fo.id)}
            {(gByParent.get(fo.id) || []).map(ch => renderGlobalFolder(ch))}
            {(apisByGFolder.get(fo.id) || []).map(api => renderApiHead(api))}
          </div>
        )}
      </div>
    )
  }

  // ── Модалка перемещения ──
  const moveFolder = folders.find(x => x.id === moveDlg?.id)
  const moveEndpoint = endpoints.find(x => x.id === moveDlg?.id)
  const moveGFolder = treeFolders.find(x => x.id === moveDlg?.id)
  const moveApi = apis.find(x => x.id === moveDlg?.id)

  const renderMoveDialog = () => {
    if (!moveDlg) return null
    // Перемещение внутри дерева эндпоинтов
    if (moveDlg.scope === 'folder' || moveDlg.scope === 'endpoint') {
      if (!activeApi) return null
      return (
        <MoveDialog
          title={moveDlg.scope === 'folder'
            ? `Переместить папку «${moveFolder?.name}»`
            : `Переместить «${moveEndpoint?.method} ${moveEndpoint?.path}»`}
          folders={folders}
          excludeId={moveDlg.scope === 'folder' ? moveDlg.id : null}
          currentParentId={moveDlg.scope === 'folder'
            ? moveFolder?.parent_id ?? null
            : moveEndpoint?.folder_id ?? null}
          onSelect={async targetId => {
            const m = moveDlg
            setMoveDlg(null)
            try {
              if (m.scope === 'folder') await updateFolder(activeApi.id, m.id, { parent_id: targetId })
              else await moveEndpointTo(activeApi.id, m.id, targetId)
              if (targetId != null) setOpenFolders(s => ({ ...s, [targetId]: true }))
              onApiChanged()
            } catch (err) { toast('Ошибка: ' + err.message, 'error') }
          }}
          onClose={() => setMoveDlg(null)}
        />
      )
    }
    // Перемещение в глобальном дереве
    return (
      <MoveDialog
        rootLabel="Вне папок (корень)"
        title={moveDlg.scope === 'global'
          ? `Переместить папку «${moveGFolder?.name}»`
          : `Переместить API «${moveApi?.name}»`}
        folders={treeFolders}
        excludeId={moveDlg.scope === 'global' ? moveDlg.id : null}
        currentParentId={moveDlg.scope === 'global'
          ? moveGFolder?.parent_id ?? null
          : moveApi?.folder_id ?? null}
        onSelect={async targetId => {
          const m = moveDlg
          setMoveDlg(null)
          try {
            if (m.scope === 'global') await updateTreeFolder(m.id, { parent_id: targetId })
            else await moveApiToFolder(m.id, targetId)
            if (targetId != null) setGOpen(s => ({ ...s, [targetId]: true }))
            onTreeChanged()
          } catch (err) { toast('Ошибка: ' + err.message, 'error') }
        }}
        onClose={() => setMoveDlg(null)}
      />
    )
  }

  // ── Избранное: разрешение эндпоинта из кэшей ──
  const favItems = useMemo(() => {
    const out = []
    for (const fav of (favorites || [])) {
      const det = apiDetails?.[fav.api_id] || (activeApi?.id === fav.api_id ? activeApi : null)
      const ep = det?.endpoints?.find(e => e.id === fav.ep_id)
      if (ep) out.push({ apiId: fav.api_id, ep, apiName: det.name })
    }
    return out
  }, [favorites, apiDetails, activeApi])

  return (
    <div
      className="tree"
      role="tree"
      aria-label="Дерево API и эндпоинтов"
      tabIndex={0}
      ref={treeRef}
      onKeyDown={onTreeKeyDown}
      onContextMenu={rootAreaMenu}
      onDragOver={e => gDragOver(e, 'groot', null)}
      onDragLeave={() => clearDrop('groot')}
      onDrop={e => gDrop(e, null)}
    >
      {favItems.length > 0 && (
        <div className="fav-section">
          <div className="fav-head">⭐ Избранное</div>
          {favItems.map(({ apiId, ep, apiName }) => (
            <div
              key={`fav-${apiId}-${ep.id}`}
              className={`tree-ep fav ${activeApi?.id === apiId && activeEndpoint?.id === ep.id ? 'active' : ''}`}
              onClick={() => onSelectEndpointOf?.(apiId, ep.id)}
              title={apiName}
            >
              <span className={`badge ${METHOD_CLASS[ep.method] || 'm-get'}`}>{ep.method}</span>
              <span className="ep-path">{epLabel(ep)}</span>
            </div>
          ))}
        </div>
      )}

      {!f && (recent || []).length > 0 && (
        <div className="fav-section">
          <div
            className="fav-head collapsible"
            role="button"
            aria-expanded={recentOpen}
            onClick={toggleRecent}
            title={recentOpen ? 'Свернуть недавние' : 'Развернуть недавние'}
          >
            <span className="arrow">{recentOpen ? '▼' : '▶'}</span> 🕘 Недавние
          </div>
          {recentOpen && (recent || []).slice(0, 6).map(r => (
            <div
              key={`rec-${r.apiId}-${r.epId}`}
              className={`tree-ep fav ${activeApi?.id === r.apiId && activeEndpoint?.id === r.epId ? 'active' : ''}`}
              onClick={() => onSelectEndpointOf?.(r.apiId, r.epId)}
              title={`${r.apiName} · ${r.method} ${r.label}`}
            >
              <span className={`badge ${METHOD_CLASS[r.method] || 'm-get'}`}>{r.method}</span>
              <span className="ep-path">{r.label}</span>
            </div>
          ))}
        </div>
      )}

      {!anyHit && (
        <div className="tree-empty">
          <div className="tree-empty-icon">🔍</div>
          <div className="tree-empty-title">Ничего не найдено по «{search}»</div>
          <div className="tree-empty-hint">Попробуйте Ctrl+K — поиск по всем API</div>
        </div>
      )}

      {anyHit && creating && creating.scope === 'global' && creating.parentId === null && renderGCreateInput(null)}
      {anyHit && (gByParent.get('root') || []).map(fo => renderGlobalFolder(fo))}
      {anyHit && (apisByGFolder.get('root') || []).map(api => renderApiHead(api))}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {renderMoveDialog()}
      {accessDlg && <AccessModal target={accessDlg} onClose={() => setAccessDlg(null)} />}
    </div>
  )
}
