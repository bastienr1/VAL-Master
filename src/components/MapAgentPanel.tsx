import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import ArtSlot from './ArtSlot'
import { useGameContent } from '../hooks/useGameContent'
import { agentSlotKey } from '../lib/artSlots'
import { agentGradientCss, agentPortraitUrl, resolveAgentId } from '../lib/gameContent'
import { PORTRAIT_CLASS, PORTRAIT_FOCAL } from '../lib/agentPortrait'
import { BEST_AGENT_MIN_MATCHES, type AgentMapStats } from '../lib/mapStats'

interface MapAgentPanelProps {
  mapName: string
  /** Every agent played on the map, most played first. */
  agents: AgentMapStats[]
  /** The agent to feature, or null when none has a real sample on the map. */
  best: AgentMapStats | null
  /** The agent the shelves are narrowed to, if any. */
  selected: string | null
  onSelectAgent: (name: string | null) => void
  /** Where to go and study the map; null when it has no playbook. */
  playbooksLink: string | null
}

const matchCount = (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`
const winRateText = (rate: number | null) => (rate !== null ? `${rate}%` : '—')

/** The agent's portrait in the same art slot Home uses, so a swapped picture shows here too. */
function AgentArt({ agent, className }: { agent: AgentMapStats; className: string }) {
  const { registry } = useGameContent()
  const uuid = agent.id ?? resolveAgentId(agent.name)

  return (
    <ArtSlot
      slotKey={agentSlotKey(uuid ?? agent.name.toLowerCase())}
      apiDefault={uuid ? agentPortraitUrl(uuid) : null}
      apiFocal={PORTRAIT_FOCAL}
      gradientFallback={uuid ? agentGradientCss(registry?.agents.byId.get(uuid)) : null}
      scrim="bottom"
      defaultOverlay={0.3}
      className={className}
      apiImgClassName={PORTRAIT_CLASS}
    />
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className={`font-stats text-xl font-bold leading-tight ${accent ? 'text-val-cyan' : 'text-text-primary'}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-muted">{label}</div>
    </div>
  )
}

/**
 * The player's agents on one map: the best one featured, the rest beside it,
 * most played first. Picking another agent narrows the shelves below, the same
 * as the agent chips. Renders nothing for a map that hasn't been played.
 */
export default function MapAgentPanel({ mapName, agents, best, selected, onSelectAgent, playbooksLink }: MapAgentPanelProps) {
  if (agents.length === 0) return null

  // With no agent on a real sample yet, the most played one stands in, and the
  // title says so rather than calling it the best.
  const featured = best ?? agents[0]
  const others = agents.filter(agent => agent.name !== featured.name)

  return (
    <section className="bg-bg-card border border-bg-elevated rounded-xl overflow-hidden">
      <div className={`grid ${others.length > 0 ? 'lg:grid-cols-2' : ''}`}>
        <div className="flex">
          {/* Flush to the card's edge and as tall as the card, fading into it on the right. */}
          <div className="relative w-36 sm:w-56 shrink-0">
            <AgentArt agent={featured} className="absolute inset-0" />
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-bg-card to-transparent pointer-events-none" />
          </div>

          <div className="min-w-0 flex-1 p-5 flex flex-col justify-between gap-4">
            <h2
              className="font-display italic font-bold uppercase text-2xl leading-none tracking-wide"
              title={
                best
                  ? `Best win rate among agents with ${BEST_AGENT_MIN_MATCHES}+ matches on ${mapName}`
                  : `No agent has ${BEST_AGENT_MIN_MATCHES} matches on ${mapName} yet`
              }
            >
              {best ? 'Best agent' : 'Most played'} on {mapName}
            </h2>

            <div>
              <div className="font-display italic font-extrabold uppercase text-4xl leading-none tracking-wide truncate">
                {featured.name}
              </div>
              <div className="mt-1.5 font-stats text-xs text-text-secondary">
                <span className="text-val-cyan">{featured.wins}W</span>{' '}
                <span className="text-val-red">{featured.losses}L</span>
                {featured.draws > 0 && <> {featured.draws}D</>} · {matchCount(featured.total)}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Win rate" value={winRateText(featured.winRate)} accent />
              <Stat label="Avg KDA" value={featured.avgKda.toFixed(2)} />
              <Stat label="Avg ACS" value={String(featured.avgAcs)} />
              <Stat label="Avg HS%" value={`${featured.avgHsPct.toFixed(1)}%`} />
            </div>

            {playbooksLink && (
              <Link
                to={playbooksLink}
                className="self-start inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-val-cyan/40 text-sm text-val-cyan hover:bg-val-cyan/10 transition-colors"
              >
                View {mapName} playbooks
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>

        {others.length > 0 && (
          <div className="p-5 space-y-3 border-t lg:border-t-0 lg:border-l border-bg-elevated">
            <h3 className="text-[10px] uppercase tracking-wider text-text-muted">Other agents · most played first</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {others.map(agent => {
                const active = selected === agent.name
                return (
                  <button
                    key={agent.name}
                    type="button"
                    onClick={() => onSelectAgent(active ? null : agent.name)}
                    aria-pressed={active}
                    title={`${agent.name} · ${agent.wins}W ${agent.losses}L · ${matchCount(agent.total)}`}
                    className={`text-left rounded-lg overflow-hidden border transition-colors outline-none focus-visible:border-val-cyan ${
                      active ? 'border-val-cyan bg-val-cyan/10' : 'border-bg-elevated hover:border-val-cyan/50'
                    }`}
                  >
                    <AgentArt agent={agent} className="aspect-square" />
                    <div className="px-2 py-1.5">
                      <div className="font-heading font-bold text-sm leading-tight truncate">{agent.name}</div>
                      <div className="font-stats text-[11px] text-val-cyan">{winRateText(agent.winRate)} WR</div>
                      <div className="font-stats text-[11px] text-text-secondary">{agent.avgKda.toFixed(2)} KDA</div>
                      <div className="text-[10px] text-text-muted">{matchCount(agent.total)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
