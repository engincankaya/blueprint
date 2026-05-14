import type { ReactNode } from 'react'
import { createElement } from 'react'

export type MarkdownBlock =
  | { type: 'heading'; level: number; content: string }
  | { type: 'paragraph'; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; content: string; language?: string }
  | { type: 'quote'; content: string }

export function parseMarkdown(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    const fenceMatch = line.match(/^```(\w+)?\s*$/)
    if (fenceMatch) {
      const codeLines: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      blocks.push({ type: 'code', content: codeLines.join('\n'), language: fenceMatch[1] })
      continue
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] })
      i += 1
      continue
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/)
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/)
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch)
      const items: string[] = []
      while (i < lines.length) {
        const itemMatch = ordered
          ? lines[i].match(/^\s*\d+\.\s+(.+)$/)
          : lines[i].match(/^\s*[-*]\s+(.+)$/)
        if (!itemMatch) break
        items.push(itemMatch[1])
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      const quoteLines: string[] = []
      while (i < lines.length) {
        const current = lines[i].match(/^>\s?(.*)$/)
        if (!current) break
        quoteLines.push(current[1])
        i += 1
      }
      blocks.push({ type: 'quote', content: quoteLines.join('\n') })
      continue
    }

    const paragraphLines = [line]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,4}\s/) &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/) &&
      !lines[i].match(/^>/)
    ) {
      paragraphLines.push(lines[i])
      i += 1
    }
    blocks.push({ type: 'paragraph', content: paragraphLines.join('\n') })
  }

  return blocks
}

type SymbolType = 'file' | 'method' | 'class' | 'type' | 'variable' | 'mode'

const MODE_KEYWORDS = new Set([
  'prepare', 'apply', 'scan', 'document', 'explain', 'compose', 'analyze',
  'group', 'inspect', 'resolve', 'initiate', 'discover', 'generate',
])

function classifySymbol(s: string): SymbolType {
  if (/[/\\]/.test(s) || /\.(ts|tsx|js|jsx|json|md|css|scss|yml|yaml|env|py|go|rs|sh)$/.test(s)) return 'file'
  if (s.endsWith('()')) return 'method'
  if (/^[A-Z][a-zA-Z]*</.test(s)) return 'type'
  if (/^[A-Z][a-zA-Z]+$/.test(s)) return 'class'
  if (MODE_KEYWORDS.has(s)) return 'mode'
  return 'variable'
}

const SYMBOL_STYLES: Record<SymbolType, string> = {
  file:     'rounded border border-sky-700/30 bg-sky-950/50 px-1 py-0.5 font-mono text-[0.85em] text-sky-300',
  method:   'rounded border border-emerald-700/30 bg-emerald-950/40 px-1 py-0.5 font-mono text-[0.85em] text-emerald-300',
  class:    'rounded border border-violet-700/30 bg-violet-950/40 px-1 py-0.5 font-mono text-[0.85em] text-violet-300',
  type:     'rounded border border-rose-700/30 bg-rose-950/40 px-1 py-0.5 font-mono text-[0.85em] text-rose-300',
  variable: 'rounded border border-amber-700/30 bg-amber-950/30 px-1 py-0.5 font-mono text-[0.85em] text-amber-300',
  mode:     'rounded border border-teal-700/30 bg-teal-950/40 px-1 py-0.5 font-mono text-[0.85em] text-teal-300',
}

export function renderInlineMarkdown(content: string): ReactNode[] {
  const parts = content.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g)

  return parts.map((part, index) => {
    if (!part) return null

    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      const cls = SYMBOL_STYLES[classifySymbol(inner)]
      return createElement('code', { key: index, className: cls }, inner)
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return createElement('strong', { key: index, className: 'text-zinc-100 font-semibold' }, part.slice(2, -2))
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return createElement('em', { key: index, className: 'text-zinc-300' }, part.slice(1, -1))
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      return createElement(
        'a',
        { key: index, href: linkMatch[2], target: '_blank', rel: 'noreferrer', className: 'text-sky-300 underline decoration-sky-500/60 underline-offset-2' },
        linkMatch[1],
      )
    }
    return part
  })
}
