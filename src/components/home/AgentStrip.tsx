import { Link } from 'react-router-dom'
import ArtSlot from '../ArtSlot'
import ScrollRow from '../ScrollRow'
import SectionHeader from './SectionHeader'
import { agentSlotKey } from '../../lib/artSlots'
import {
  agentGradientCss,
  agentPortraitUrl,
  resolveAgentId,
  type GameContentRegistry,
} from '../../lib/gameContent'
import { PORTRAIT_CLASS, PORTRAIT_FOCAL } from '../../lib/agentPortrait'
import type { HomeScope, StatGroup } from '../../lib/homeStats'

interface AgentStripProps {
  /** Agents played in the period, most played first. */
  agents: StatGroup[]
  /** The agent to outline: best win rate on a real sample, or null. */
  edgeAgent: StatGroup | null
  scope: HomeScope
  registry: GameContentRegistry | null
}

/** Explore Agents: one card per agent played, opening the Match Library filtered to them. */
export default function AgentStrip({ agents, edgeAgent, scope, registry }: AgentStripProps) {
  if (agents.length === 0) return null

  return (
    <section className="space-y-5">
      <SectionHeader title="Explore Agents" subtitle="Understand your tendencies. Find your edge." />
      <ScrollRow label="Agents" className="p-1">
        {agents.map(agent => {
          const uuid = agent.id ?? resolveAgentId(agent.name)
          const isEdge = edgeAgent?.name === agent.name

          // The same filter the numbers on the card were counted with.
          const params = new URLSearchParams({ agent: agent.name })
          if (scope.kind === 'act') params.set('act', scope.act.code)

          return (
            <Link
              key={agent.name}
              to={`/matches?${params}`}
              title={isEdge ? `${agent.name} — your best win rate on 5+ matches` : agent.name}
              className={`group snap-start shrink-0 w-40 rounded-xl overflow-hidden border transition-colors outline-none focus-visible:border-val-cyan ${
                isEdge ? 'border-val-red ring-2 ring-val-red' : 'border-bg-elevated hover:border-val-cyan/50'
              }`}
            >
              <ArtSlot
                slotKey={agentSlotKey(uuid ?? agent.name.toLowerCase())}
                apiDefault={uuid ? agentPortraitUrl(uuid) : null}
                apiFocal={PORTRAIT_FOCAL}
                gradientFallback={uuid ? agentGradientCss(registry?.agents.byId.get(uuid)) : null}
                scrim="bottom"
                defaultOverlay={0.9}
                className="aspect-square"
                apiImgClassName={PORTRAIT_CLASS}
              >
                <div className="absolute inset-x-0 bottom-0 p-3">
                  <div className="font-heading font-bold text-base leading-tight">{agent.name}</div>
                  <div className="font-stats text-xs text-val-cyan">
                    {agent.winRate !== null ? `${agent.winRate}% WR` : '— WR'}
                  </div>
                  <div className="text-[11px] text-text-secondary">
                    {agent.total} {agent.total === 1 ? 'match' : 'matches'}
                  </div>
                </div>
              </ArtSlot>
            </Link>
          )
        })}
      </ScrollRow>
    </section>
  )
}
