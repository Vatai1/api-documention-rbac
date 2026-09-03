// Недавние эндпоинты (localStorage). Элементы: { apiId, epId, apiName, method, label, ts }
const KEY = 'recent_items'
const MAX = 10

export function getRecent() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function addRecent(item) {
  let list = []
  try { list = JSON.parse(localStorage.getItem(KEY) || '[]') } catch { /* пусто */ }
  list = list.filter(x => !(x.apiId === item.apiId && x.epId === item.epId))
  const next = [{ ...item, ts: Date.now() }, ...list].slice(0, MAX)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* переполнение — игнорируем */ }
  return next
}
