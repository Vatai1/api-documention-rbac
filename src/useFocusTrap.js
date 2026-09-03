import { useEffect, useRef } from 'react'

/**
 * Ловушка фокуса для модалок: Tab зациклен внутри контейнера,
 * фокус возвращается на элемент, активный до открытия.
 */
export default function useFocusTrap(active) {
  const ref = useRef(null)

  useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return
    const prev = document.activeElement

    const focusables = () => Array.from(
      node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter(el => !el.disabled && el.offsetParent !== null)

    focusables()[0]?.focus()

    const onKey = (e) => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const i = list.indexOf(document.activeElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); list[list.length - 1].focus() }
      else if (!e.shiftKey && (i === list.length - 1 || i === -1)) { e.preventDefault(); list[0].focus() }
    }

    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      if (prev && typeof prev.focus === 'function') prev.focus()
    }
  }, [active])

  return ref
}
