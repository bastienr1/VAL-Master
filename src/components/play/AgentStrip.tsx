import { useMemo } from 'react'
import { agentGradientCss, type GameAgent } from '../../lib/gameContent'
import type { Team } from '../../lib/playDoc'

export type AgentRole = 'Duelist' | 'Initiator' | 'Controller' | 'Sentinel'

interface AgentStripProps {
  /** Every registry agent, in any order: the strip sorts them. */
  agents: GameAgent[]
  /** The role filter, null for All. */
  role: AgentRole | null
  onRole(role: AgentRole | null): void
  /** The team a new agent is placed for. */
  team: Team
  onTeam(team: Team): void
  /** Lower-cased agent name → the teams it is on the map for in this step. */
  placed: Map<string, Team[]>
  /** The agent whose abilities are open, lit in the strip. */
  activeAgent: string | null
  onPick(agent: GameAgent): void
  /** One line next to the switch ("Comp is full"), or null. */
  hint: string | null
  /** False while there is no map to place on. */
  enabled: boolean
}

const ROLES: AgentRole[] = ['Duelist', 'Initiator', 'Controller', 'Sentinel']

const roleRank = (role: string | null) => {
  const i = ROLES.indexOf(role as AgentRole)
  return i === -1 ? ROLES.length : i
}

const TEAMS: { value: Team; label: string; on: string }[] = [
  { value: 'ally', label: 'Ally', on: 'bg-val-cyan/15 text-val-cyan' },
  { value: 'enemy', label: 'Enemy', on: 'bg-val-red/15 text-val-red' },
]

const RING: Record<Team, string> = {
  ally: 'ring-2 ring-[#53CADC]',
  enemy: 'ring-2 ring-val-red',
}

const chip = (on: boolean) =>
  `px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
    on ? 'bg-val-cyan/15 text-val-cyan' : 'text-text-secondary hover:text-text-primary'
  }`

/**
 * The bottom strip (docs/plays-editor-v2.md §2.3): every agent as a portrait
 * tile, sorted by role then name, with the role filter on the left (keys 1–4,
 * handled by the page) and the Ally / Enemy switch on the right. A tile whose
 * agent is on the map in this step is ringed in its team's colour.
 */
export default function AgentStrip(props: AgentStripProps) {
  const { agents, role, team, placed, activeAgent, hint, enabled } = props

  const shown = useMemo(
    () =>
      agents
        .filter(a => role === null || a.role === role)
        .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)),
    [agents, role],
  )

  return (
    <div className="h-16 flex items-center gap-3 px-3 border-t border-bg-elevated bg-bg-secondary min-w-0">
      <div role="group" aria-label="Role" className="hidden md:flex items-center gap-0.5 shrink-0">
        <button type="button" onClick={() => props.onRole(null)} aria-pressed={role === null} className={chip(role === null)}>
          All
        </button>
        {ROLES.map((r, i) => (
          <button
            key={r}
            type="button"
            onClick={() => props.onRole(role === r ? null : r)}
            aria-pressed={role === r}
            title={`${r} (${i + 1})`}
            className={chip(role === r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex items-center gap-1.5 py-1.5 px-0.5 w-max">
          {shown.map(agent => {
            const teams = placed.get(agent.name.toLowerCase()) ?? []
            const ring = teams.includes(team) ? RING[team] : teams.length > 0 ? RING[teams[0]] : ''
            const lit = activeAgent !== null && activeAgent.toLowerCase() === agent.name.toLowerCase()
            return (
              <button
                key={agent.uuid}
                type="button"
                onClick={() => props.onPick(agent)}
                disabled={!enabled}
                title={agent.name}
                aria-label={agent.name}
                aria-pressed={lit}
                style={{ background: agentGradientCss(agent) ?? '#1A1F2E' }}
                className={`relative shrink-0 w-10 h-10 rounded overflow-hidden transition-transform hover:-translate-y-0.5 disabled:opacity-40 disabled:pointer-events-none ${ring} ${
                  lit ? 'outline outline-2 outline-offset-2 outline-white/60' : ''
                }`}
              >
                {agent.displayIcon ? (
                  <img src={agent.displayIcon} alt="" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[9px] font-bold uppercase text-text-secondary">{agent.name.slice(0, 3)}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {hint && <span role="status" className="text-[11px] text-val-yellow whitespace-nowrap">{hint}</span>}
        <div role="group" aria-label="Team" className="inline-flex rounded-md border border-bg-elevated p-0.5">
          {TEAMS.map(t => (
            <button
              key={t.value}
              type="button"
              onClick={() => props.onTeam(t.value)}
              aria-pressed={team === t.value}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                team === t.value ? t.on : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
