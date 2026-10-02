import NoteMarkdown from './NoteMarkdown'
import { guideMarkdown } from '../lib/guideMarkdown'

/**
 * What the video argues, in the note-taker's two or three sentences.
 *
 * Sits between the header and the player so it is read before pressing play:
 * the chapters say where things are, this says what to watch them for.
 */
export default function GuideEssence({ essence }: { essence: string }) {
  return (
    <section
      aria-label="Essence"
      className="bg-bg-card border border-bg-elevated border-l-2 border-l-val-cyan rounded-xl px-4 py-3"
    >
      <h2 className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Essence</h2>
      <div className="max-w-5xl">
        <NoteMarkdown>{guideMarkdown(essence)}</NoteMarkdown>
      </div>
    </section>
  )
}
