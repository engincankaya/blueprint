import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

type FamilyColor = 'orange' | 'purple' | 'teal' | 'yellow' | 'zinc'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export function familyTypeToColor(type: string | undefined): FamilyColor {
  const map: Record<string, FamilyColor> = {
    layer: 'orange',
    feature: 'purple',
    domain: 'teal',
    infrastructure: 'yellow',
    other: 'zinc',
  }
  return map[type ?? ''] ?? 'zinc'
}

export function getTypeColor(type: string | undefined): string {
  const map: Record<string, string> = {
    layer: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
    feature: 'bg-violet-500/10 text-violet-400 border border-violet-500/20',
    domain: 'bg-teal-500/10 text-teal-400 border border-teal-500/20',
    infrastructure: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    other: 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20',
  }
  return map[type ?? ''] ?? map['other']!
}
