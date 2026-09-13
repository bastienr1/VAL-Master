import { createContext, useContext } from 'react'

interface MatchSearchPanelControls {
  /** Opens the AppShell match search panel, optionally pre-filled (e.g. a map name). */
  open: (query?: string) => void
}

export const MatchSearchPanelContext = createContext<MatchSearchPanelControls>({
  open: () => {},
})

export function useMatchSearchPanel(): MatchSearchPanelControls {
  return useContext(MatchSearchPanelContext)
}
