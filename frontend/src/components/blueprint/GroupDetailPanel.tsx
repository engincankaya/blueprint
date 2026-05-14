'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/atlas/utils'
import { parseMarkdown, renderInlineMarkdown } from '@/lib/atlas/markdown'
import type { BlueprintGroupConnection, BlueprintGroupDetailResponse } from '@/lib/blueprint/api-types'

type DetailFile = BlueprintGroupDetailResponse['files'][number]

// ─── Kind badge ───────────────────────────────────────────────────────────────

const KIND_BADGE: Record<string, string> = {
  runtime:        'bg-sky-900/60 text-sky-300 border-sky-700/40',
  feature:        'bg-violet-900/60 text-violet-300 border-violet-700/40',
  infrastructure: 'bg-zinc-800/80 text-zinc-400 border-zinc-700/40',
  test:           'bg-emerald-900/60 text-emerald-300 border-emerald-700/40',
  legacy:         'bg-amber-900/60 text-amber-300 border-amber-700/40',
  operations:     'bg-orange-900/60 text-orange-300 border-orange-700/40',
  documentation:  'bg-blue-900/60 text-blue-300 border-blue-700/40',
  integration:    'bg-teal-900/60 text-teal-300 border-teal-700/40',
  other:          'bg-zinc-800/80 text-zinc-500 border-zinc-700/40',
}

// ─── File tree ────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string
  path: string
  kind: 'folder' | 'file'
  file?: DetailFile
  children: Map<string, TreeNode>
}

function buildTree(files: DetailFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', kind: 'folder', children: new Map() }
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let cursor = root
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1
      const childPath = cursor.path ? `${cursor.path}/${part}` : part
      if (isFile) {
        cursor.children.set(part, { name: part, path: childPath, kind: 'file', file, children: new Map() })
        return
      }
      if (!cursor.children.has(part)) {
        cursor.children.set(part, { name: part, path: childPath, kind: 'folder', children: new Map() })
      }
      cursor = cursor.children.get(part)!
    })
  }
  return root
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function collectFolderPaths(node: TreeNode, acc: Set<string> = new Set()): Set<string> {
  for (const child of node.children.values()) {
    if (child.kind === 'folder') {
      acc.add(child.path)
      collectFolderPaths(child, acc)
    }
  }
  return acc
}

// ─── Connection Diagram ───────────────────────────────────────────────────────

const NW = 104
const NH = 26
const GAP = 9
const PAD = 14
const VW = 420

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max) + '…' : s
}

function nodeY(index: number, total: number, svgH: number) {
  const totalH = total * NH + (total - 1) * GAP
  return svgH / 2 - totalH / 2 + index * (NH + GAP)
}

function centerEdgeY(index: number, total: number, centerY: number) {
  if (total === 1) return centerY
  const span = NH * 0.68
  const start = centerY - span / 2
  return start + (index / (total - 1)) * span
}

function ConnectionDiagram({
  group,
  connections,
}: {
  group: BlueprintGroupDetailResponse['group']
  connections: BlueprintGroupConnection[]
}) {
  const incoming = connections.filter(connection => connection.direction === 'incoming')
  const outgoing = connections.filter(connection => connection.direction === 'outgoing')
  const maxCount = Math.max(1, ...connections.map(connection => connection.count))

  const sideCount = Math.max(incoming.length, outgoing.length, 1)
  const svgH = Math.max(sideCount * (NH + GAP) - GAP + PAD * 2, NH + PAD * 2)

  const cnx = VW / 2 - NW / 2
  const cny = svgH / 2 - NH / 2
  const cy = svgH / 2

  const lx = PAD
  const rx = VW - PAD - NW
  const mid = `arr-${group.id}`

  return (
    <svg viewBox={`0 0 ${VW} ${svgH}`} width="100%" style={{ height: 'auto', display: 'block' }} aria-hidden>
      <defs>
        <marker id={`${mid}-in`} markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="rgba(34,211,238,0.55)" />
        </marker>
        <marker id={`${mid}-out`} markerWidth="4" markerHeight="4" refX="3.5" refY="2" orient="auto">
          <path d="M0,0 L4,2 L0,4 Z" fill="rgba(167,139,250,0.55)" />
        </marker>
      </defs>

      {incoming.map((connection, i) => {
        const ny = nodeY(i, incoming.length, svgH)
        const ncy = ny + NH / 2
        const tcy = centerEdgeY(i, incoming.length, cy)
        const t = connection.count / maxCount
        return (
          <g key={`incoming-${connection.groupId}`}>
            <rect x={lx} y={ny} width={NW} height={NH} rx={3} fill="rgb(8 47 73/0.45)" stroke="rgb(6 182 212/0.28)" strokeWidth={0.75} />
            <text x={lx + 7} y={ncy} fontSize={9} fill="rgb(103 232 249)" dominantBaseline="middle">{truncate(connection.groupName, 13)}</text>
            <text x={lx + NW - 5} y={ny + NH - 5} fontSize={8} fill="rgb(6 182 212/0.6)" textAnchor="end">{connection.count}</text>
            <path d={`M ${lx + NW} ${ncy} C ${lx + NW + 36} ${ncy} ${cnx - 36} ${tcy} ${cnx} ${tcy}`}
              fill="none" stroke="rgb(34 211 238)" strokeWidth={0.5 + t * 1.6} strokeOpacity={0.25 + t * 0.5}
              markerEnd={`url(#${mid}-in)`} />
          </g>
        )
      })}

      {outgoing.map((connection, i) => {
        const ny = nodeY(i, outgoing.length, svgH)
        const ncy = ny + NH / 2
        const scy = centerEdgeY(i, outgoing.length, cy)
        const t = connection.count / maxCount
        return (
          <g key={`outgoing-${connection.groupId}`}>
            <rect x={rx} y={ny} width={NW} height={NH} rx={3} fill="rgb(46 16 101/0.4)" stroke="rgb(139 92 246/0.28)" strokeWidth={0.75} />
            <text x={rx + 7} y={ncy} fontSize={9} fill="rgb(196 181 253)" dominantBaseline="middle">{truncate(connection.groupName, 13)}</text>
            <text x={rx + NW - 5} y={ny + NH - 5} fontSize={8} fill="rgb(139 92 246/0.6)" textAnchor="end">{connection.count}</text>
            <path d={`M ${cnx + NW} ${scy} C ${cnx + NW + 36} ${scy} ${rx - 36} ${ncy} ${rx} ${ncy}`}
              fill="none" stroke="rgb(167 139 250)" strokeWidth={0.5 + t * 1.6} strokeOpacity={0.25 + t * 0.5}
              markerEnd={`url(#${mid}-out)`} />
          </g>
        )
      })}

      <rect x={cnx} y={cny} width={NW} height={NH} rx={4} fill="rgb(28 25 23)" stroke="rgb(251 146 60/0.55)" strokeWidth={1} />
      <text x={VW / 2} y={cy} fontSize={9.5} fontWeight="600" fill="rgb(253 186 116)" textAnchor="middle" dominantBaseline="middle">
        {truncate(group.name, 16)}
      </text>
    </svg>
  )
}

// ─── Markdown section render ──────────────────────────────────────────────────

function SectionContent({ content }: { content: string }) {
  const blocks = parseMarkdown(content)
  return (
    <div className="space-y-2 text-sm leading-6 text-zinc-300">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <p key={index} className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {renderInlineMarkdown(block.content)}
            </p>
          )
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return (
            <ListTag key={index} className={block.ordered ? 'list-decimal space-y-1 pl-5' : 'list-disc space-y-1 pl-5'}>
              {block.items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-400">{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          )
        }
        if (block.type === 'code') {
          return (
            <pre key={index} className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100">
              <code>{block.content}</code>
            </pre>
          )
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index} className="border-l-2 border-zinc-700 pl-3 italic text-zinc-400">
              {renderInlineMarkdown(block.content)}
            </blockquote>
          )
        }
        return (
          <p key={index} className="whitespace-pre-wrap text-zinc-400">
            {renderInlineMarkdown(block.content)}
          </p>
        )
      })}
    </div>
  )
}

function SnapshotHeaderContent({ content }: { content: string }) {
  const blocks = parseMarkdown(content)
  const items = blocks.flatMap((block) => {
    if (block.type === 'list') return block.items
    if (block.type === 'paragraph') return [block.content]
    return []
  }).filter(item => item.trim().length > 0)

  return (
    <ul className="space-y-1.5 rounded-md border-l-2 border-amber-500/45 bg-zinc-900/45 px-4 py-3 text-[13px] leading-5 text-zinc-300 shadow-sm shadow-black/10">
      {items.map((item, index) => (
        <li key={index} className="ml-4 list-disc marker:text-amber-400/70">
          {renderInlineMarkdown(item)}
        </li>
      ))}
    </ul>
  )
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({
  title,
  content,
  accent,
  defaultOpen = false,
  index = 0,
}: {
  title: string
  content: string
  accent?: 'amber' | 'red' | 'green' | 'blue' | 'zinc'
  defaultOpen?: boolean
  index?: number
}) {
  const [open, setOpen] = useState(defaultOpen)

  const accentClasses = {
    amber: 'border-amber-700/30 bg-amber-950/20',
    red:   'border-red-700/30 bg-red-950/20',
    green: 'border-emerald-700/30 bg-emerald-950/20',
    blue:  'border-blue-700/30 bg-blue-950/20',
    zinc:  'border-zinc-700/30 bg-zinc-900/40',
  }

  const titleAccent = {
    amber: 'text-amber-400',
    red:   'text-red-400',
    green: 'text-emerald-400',
    blue:  'text-blue-400',
    zinc:  'text-zinc-300',
  }

  const borderClass = accentClasses[accent ?? 'zinc']
  const titleClass = titleAccent[accent ?? 'zinc']

  // Önizleme için ilk 120 karakter (kod bloğu değilse)
  const preview = content.replace(/```[\s\S]*?```/g, '').slice(0, 120).trimEnd()

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      className={cn('rounded-lg border', borderClass)}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <span className={cn('text-xs font-semibold uppercase tracking-wider', titleClass)}>
          {title}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          className="shrink-0 text-zinc-600"
        >
          <ChevronDown size={14} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {!open && preview && (
          <motion.p
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="px-4 pb-3 text-xs leading-5 text-zinc-600 line-clamp-1"
          >
            {preview}{preview.length < content.replace(/```[\s\S]*?```/g, '').length ? '…' : ''}
          </motion.p>
        )}
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              <SectionContent content={content} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Open Questions Cards ─────────────────────────────────────────────────────

function OpenQuestionsCards({ content, startIndex }: { content: string; startIndex: number }) {
  // Her soruyu ayrı kart olarak göster
  const questions: string[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) {
      questions.push(trimmed.slice(2))
    } else if (trimmed.endsWith('?') && trimmed.length > 10 && !trimmed.startsWith('-')) {
      // Prose içindeki soru cümleleri
      const parts = trimmed.split(/(?<=[?])\s+/)
      questions.push(...parts.filter(p => p.includes('?')))
    }
  }

  if (questions.length === 0) {
    // Prose formatında gelen sorular
    const sentences = content.split(/[.?]/).map(s => s.trim()).filter(s => s.length > 20)
    questions.push(...sentences.slice(0, 5))
  }

  return (
    <div className="space-y-2">
      {questions.map((q, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: (startIndex + i) * 0.04 }}
          className="flex items-start gap-3 rounded-lg border border-blue-700/20 bg-blue-950/15 px-4 py-3"
        >
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400/60" />
          <p className="text-sm leading-6 text-zinc-400">{renderInlineMarkdown(q.trim())}</p>
        </motion.div>
      ))}
    </div>
  )
}

// ─── Sub-tab bileşeni ─────────────────────────────────────────────────────────

type SubTab = 'overview' | 'architecture' | 'guide' | 'files' | 'connections'

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'overview', label: 'Genel Bakış' },
  { id: 'architecture', label: 'Mimari' },
  { id: 'guide', label: 'Rehber' },
  { id: 'files', label: 'Dosyalar' },
  { id: 'connections', label: 'Bağlantılar' },
]

// ─── GroupDetailPanel ─────────────────────────────────────────────────────────

interface GroupDetailPanelProps {
  detail: BlueprintGroupDetailResponse
}

export function GroupDetailPanel({ detail }: GroupDetailPanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview')
  const { group, doc, files, connections } = detail

  const roleBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const file of files) {
      if (file.role) map.set(file.role, (map.get(file.role) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [files])

  const fileTree = useMemo(() => buildTree(files), [files])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => collectFolderPaths(buildTree(files)),
  )

  useEffect(() => {
    setExpandedFolders(collectFolderPaths(fileTree))
    setActiveSubTab('overview')
  }, [fileTree])

  function toggleFolder(path: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function renderNode(node: TreeNode, depth = 0): ReactNode {
    if (node.kind === 'file') {
      const file = node.file!
      return (
        <div
          key={node.path}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-800"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <FileCode2 size={13} className="shrink-0 text-zinc-500" />
          <span className="shrink-0 font-mono text-xs text-zinc-300">{node.name}</span>
          {file.summary && (
            <span className="min-w-0 flex-1 truncate font-mono text-xs" style={{ color: '#4d7c5f' }}>
              // {file.summary}
            </span>
          )}
          {!file.summary && <span className="flex-1" />}
          {file.role && (
            <span className="shrink-0 text-[10px] text-zinc-600">{file.role}</span>
          )}
        </div>
      )
    }

    const isOpen = expandedFolders.has(node.path)
    const children = sortNodes([...node.children.values()])
    return (
      <div key={node.path}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800"
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => toggleFolder(node.path)}
          aria-expanded={isOpen}
        >
          <ChevronRight size={13} className={cn('shrink-0 text-zinc-500 transition-transform', isOpen && 'rotate-90')} />
          {isOpen
            ? <FolderOpen size={13} className="shrink-0 text-zinc-400" />
            : <Folder size={13} className="shrink-0 text-zinc-400" />
          }
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200">{node.name}</span>
        </button>
        {isOpen && <div>{children.map(child => renderNode(child, depth + 1))}</div>}
      </div>
    )
  }

  const rootEntries = sortNodes([...fileTree.children.values()])
  const s = doc.sections

  const kindBadgeClass = KIND_BADGE[group.kind ?? 'other'] ?? KIND_BADGE.other

  // lastReviewedAt formatla
  const reviewedAt = doc.frontmatter.lastReviewedAt
    ? new Date(doc.frontmatter.lastReviewedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Sabit Header ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-950 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {group.kind && (
              <span className={cn(
                'mb-2 inline-flex items-center rounded border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider',
                kindBadgeClass,
              )}>
                {group.kind}
              </span>
            )}
            <h1 className="text-base font-semibold text-zinc-100">{group.name}</h1>

            {/* Quick Summary */}
            {s.snapshot && (
              <div className="mt-3 max-w-4xl">
                <SnapshotHeaderContent content={s.snapshot} />
              </div>
            )}

            {/* Meta */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-600">
              <span>{files.length} dosya</span>
              {connections.length > 0 && (
                <>
                  <span>·</span>
                  <span>{connections.length} bağlantı</span>
                </>
              )}
              {reviewedAt && (
                <>
                  <span>·</span>
                  <span>{reviewedAt}</span>
                </>
              )}
              {doc.frontmatter.status === 'draft' && (
                <>
                  <span>·</span>
                  <span className="text-amber-500">draft</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Alt sekmeler ─────────────────────────────────────── */}
        <div className="mt-4 flex gap-0 border-b border-zinc-800/60">
          {SUB_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                'relative px-3 pb-2.5 text-xs font-medium transition-colors',
                activeSubTab === tab.id ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {tab.label}
              {activeSubTab === tab.id && (
                <motion.span
                  layoutId={`subtab-indicator-${group.id}`}
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-zinc-300"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab İçeriği ──────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${group.id}-${activeSubTab}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="p-6"
          >
            {/* ── OVERVIEW ─────────────────────────────────────── */}
            {activeSubTab === 'overview' && (
              <div className="space-y-3">
                {!s.snapshot && group.summary ? (
                  <div className="rounded-lg border border-zinc-700/30 bg-zinc-900/40 px-4 py-3">
                    <p className="text-sm leading-6 text-zinc-400">{group.summary}</p>
                  </div>
                ) : null}

                {s.responsibilities && (
                  <SectionCard title="Sorumluluklar" content={s.responsibilities} defaultOpen index={0} />
                )}

                {s.keyFiles && (
                  <SectionCard title="Ana Dosyalar" content={s.keyFiles} index={1} />
                )}

                {s.extensionOpenQuestions && (
                  <div>
                    <motion.p
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.12 }}
                      className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-blue-400"
                    >
                      Açık Sorular
                    </motion.p>
                    <OpenQuestionsCards content={s.extensionOpenQuestions} startIndex={2} />
                  </div>
                )}

                {!doc.exists && (
                  <p className="text-sm text-zinc-600">Bu grup için dokümantasyon henüz mevcut değil.</p>
                )}
              </div>
            )}

            {/* ── ARCHITECTURE ─────────────────────────────────── */}
            {activeSubTab === 'architecture' && (
              <div className="space-y-3">
                {s.coreFlow && (
                  <SectionCard title="Çekirdek Akış" content={s.coreFlow} defaultOpen index={0} />
                )}
                {s.contractsAndInvariants && (
                  <SectionCard title="Kontratlar ve Değişmezler" content={s.contractsAndInvariants} defaultOpen index={1} />
                )}
                {s.keyFiles && (
                  <SectionCard title="Ana Dosyalar" content={s.keyFiles} index={2} />
                )}
                {!doc.exists && (
                  <p className="text-sm text-zinc-600">Bu grup için dokümantasyon henüz mevcut değil.</p>
                )}
              </div>
            )}

            {/* ── GUIDE ────────────────────────────────────────── */}
            {activeSubTab === 'guide' && (
              <div className="space-y-3">
                {s.changeGuide && (
                  <SectionCard title="Değiştirirken" content={s.changeGuide} defaultOpen index={0} />
                )}
                {s.contractsAndInvariants && (
                  <SectionCard title="Değişmezler" content={s.contractsAndInvariants} accent="red" index={1} />
                )}
                {s.pitfalls && (
                  <SectionCard title="Tuzaklar" content={s.pitfalls} accent="amber" index={2} />
                )}
                {s.tests && (
                  <SectionCard title="Testler" content={s.tests} index={3} />
                )}
                {s.debugging && (
                  <SectionCard title="Hata Ayıklama" content={s.debugging} index={4} />
                )}
                {s.extensionOpenQuestions && (
                  <SectionCard title="Genişletme / Açık Sorular" content={s.extensionOpenQuestions} accent="green" index={5} />
                )}
                {!doc.exists && (
                  <p className="text-sm text-zinc-600">Bu grup için dokümantasyon henüz mevcut değil.</p>
                )}
              </div>
            )}

            {/* ── FILES ────────────────────────────────────────── */}
            {activeSubTab === 'files' && (
              <div className="space-y-5">
                {roleBreakdown.length > 0 && (
                  <div>
                    <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Roller</p>
                    <div className="flex flex-wrap gap-1.5">
                      {roleBreakdown.map(([role, count]) => (
                        <span key={role} className="rounded border border-zinc-700/50 bg-zinc-800/50 px-2 py-0.5 text-xs text-zinc-300">
                          {role}
                          <span className="ml-1.5 text-zinc-500">{count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Dosyalar ({files.length})
                  </p>
                  <div className="space-y-0.5">
                    {rootEntries.map(entry => renderNode(entry))}
                  </div>
                </div>
              </div>
            )}

            {/* ── CONNECTIONS ──────────────────────────────────── */}
            {activeSubTab === 'connections' && (
              <div>
                {connections.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/30 px-2 py-2">
                    <ConnectionDiagram group={group} connections={connections} />
                  </div>
                ) : (
                  <p className="text-sm text-zinc-600">Bu grubun bağlantısı bulunmuyor.</p>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
