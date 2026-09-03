// Мини-система тостов: toast('текст', 'info' | 'success' | 'error')
let listeners = []
let seq = 0

export function toast(msg, type = 'info') {
  const item = { id: ++seq, msg, type }
  listeners.forEach(l => l(item))
}

export function subscribe(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(l => l !== fn) }
}
