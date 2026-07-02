import type { HTMLAttributes } from 'react'

type Tone = 'default' | 'emerald' | 'amber' | 'red' | 'sky' | 'slate' | 'violet'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  emerald: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  sky: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  slate: 'bg-zinc-700/40 text-zinc-300 border-zinc-600/40',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
}

export function Badge({ tone = 'default', className = '', children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
