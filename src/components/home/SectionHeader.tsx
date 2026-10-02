import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

interface SectionHeaderProps {
  title: string
  subtitle?: string
  /** Optional "View all" link on the right. */
  link?: { to: string; label: string }
}

/** Title row of a Home section: display-face title, one line of context, one link. */
export default function SectionHeader({ title, subtitle, link }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display italic font-bold uppercase text-3xl leading-none tracking-wide">{title}</h2>
        {subtitle && <p className="text-sm text-text-secondary mt-1.5">{subtitle}</p>}
      </div>
      {link && (
        <Link
          to={link.to}
          className="shrink-0 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-val-cyan transition-colors"
        >
          {link.label}
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}
