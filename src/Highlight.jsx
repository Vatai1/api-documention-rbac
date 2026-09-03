import React from 'react'

/**
 * Подсветка совпадений поиска: <mark> вокруг вхождений query (регистронезависимо).
 */
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export default function Highlight({ text, query }) {
  const t = String(text ?? '')
  const q = (query || '').trim()
  if (!q) return t
  let parts
  try { parts = t.split(new RegExp(`(${escRe(q)})`, 'ig')) } catch { return t }
  if (parts.length === 1) return t
  return parts.map((p, i) =>
    p && p.toLowerCase() === q.toLowerCase()
      ? <mark key={i}>{p}</mark>
      : <React.Fragment key={i}>{p}</React.Fragment>
  )
}
