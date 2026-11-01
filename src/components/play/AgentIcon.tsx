import { agentIconUrl, resolveAgentId } from '../../lib/gameContent'

/**
 * An agent as a round icon. A name the registry does not know (a typo, or the
 * registry still loading) is a disc with its first three letters, so the comp
 * keeps its five slots instead of showing broken images.
 */
export default function AgentIcon({ name, size }: { name: string; size: number }) {
  const id = resolveAgentId(name)
  const style = { width: size, height: size }
  if (!id) {
    return (
      <span
        title={name}
        style={style}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-bg-elevated text-[9px] font-bold uppercase text-text-secondary"
      >
        {name.slice(0, 3)}
      </span>
    )
  }
  return (
    <img
      src={agentIconUrl(id)}
      alt={name}
      title={name}
      loading="lazy"
      style={style}
      className="shrink-0 rounded-full bg-bg-elevated object-cover"
    />
  )
}
