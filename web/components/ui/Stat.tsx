import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'emerald' | 'amber' | 'red'
  className?: string
}

const valueTone: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-white',
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
}

export function Stat({ label, value, hint, tone = 'default', className = '' }: StatProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4 ${className}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${valueTone[tone]}`}>{value}</div>
      {hint !== undefined && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export default Stat
