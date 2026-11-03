import { useState } from 'react'
import type { PlayTemplate } from '../../lib/playTemplates'

interface TemplateStripProps {
  templates: PlayTemplate[]
  /** The map's sites, A / B / C, for the templates played around one. */
  sites: string[]
  onApply(template: PlayTemplate, site: string | null): void
}

const SIDE_CHIP: Record<PlayTemplate['side'], { label: string; className: string }> = {
  attack: { label: 'Attack', className: 'text-val-red bg-val-red/10' },
  defense: { label: 'Defense', className: 'text-val-cyan bg-val-cyan/10' },
}

const smallButton =
  'px-2.5 py-1 rounded-md text-xs font-medium text-val-cyan border border-val-cyan/25 bg-val-cyan/10 hover:bg-val-cyan/20 transition-colors'

/**
 * "Start from a template": one card per template. A template played around a
 * site opens its site chips first. Shown only while the play has nothing
 * drawn, so applying one never replaces work.
 */
export default function TemplateStrip({ templates, sites, onApply }: TemplateStripProps) {
  /** The site template whose chips are open. */
  const [siteFor, setSiteFor] = useState<PlayTemplate['id'] | null>(null)

  const pick = (template: PlayTemplate) => {
    if (template.needsSite) setSiteFor(open => (open === template.id ? null : template.id))
    else {
      setSiteFor(null)
      onApply(template, null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-text-secondary">Start from a template</div>
      <div className="grid grid-cols-2 gap-2">
        {templates.map(t => {
          const side = SIDE_CHIP[t.side]
          return (
            <div key={t.id} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => pick(t)}
                aria-expanded={t.needsSite ? siteFor === t.id : undefined}
                className="flex-1 w-full text-left rounded-lg border border-bg-elevated bg-bg-primary px-3 py-2 hover:border-val-cyan/50 transition-colors space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${side.className}`}>
                    {side.label}
                  </span>
                </div>
                <div className="text-[11px] text-text-muted">{t.steps.map(s => s.name).join(' · ')}</div>
                <div className="text-xs text-text-secondary">{t.description}</div>
              </button>
              {t.needsSite && siteFor === t.id && (
                <div role="group" aria-label={`${t.name} site`} className="flex flex-wrap items-center gap-1.5">
                  {sites.length === 0 ? (
                    <span className="text-xs text-text-muted">This map lists no sites</span>
                  ) : (
                    sites.map(site => (
                      <button
                        key={site}
                        type="button"
                        onClick={() => {
                          setSiteFor(null)
                          onApply(t, site)
                        }}
                        className={smallButton}
                      >
                        {site}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
