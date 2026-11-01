/** The dashed line a list shows when it has nothing in it yet: what is missing and how to add it. */
export default function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-bg-elevated rounded-xl px-4 py-5 text-sm text-text-muted">{children}</div>
  )
}
