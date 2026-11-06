import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches, kept current as the window changes.
 *
 * Read synchronously on the first render, so a layout that depends on it paints
 * right the first time instead of flashing the other variant.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
