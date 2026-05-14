'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/atlas/utils'
import type { BlueprintGroupConnection, BlueprintGroupOverview, BlueprintGroupsOverviewResponse } from '@/lib/blueprint/api-types'

// ─── Kind renk sistemi ────────────────────────────────────────────────────────

const KIND_STYLES: Record<string, { badge: string; ring: string }> = {
  runtime:        { badge: 'bg-sky-900/60 text-sky-300 border-sky-700/40',          ring: 'ring-sky-500/30' },
  feature:        { badge: 'bg-violet-900/60 text-violet-300 border-violet-700/40', ring: 'ring-violet-500/30' },
  infrastructure: { badge: 'bg-zinc-800/80 text-zinc-400 border-zinc-700/40',       ring: 'ring-zinc-500/20' },
  test:           { badge: 'bg-emerald-900/60 text-emerald-300 border-emerald-700/40', ring: 'ring-emerald-500/30' },
  legacy:         { badge: 'bg-amber-900/60 text-amber-300 border-amber-700/40',    ring: 'ring-amber-500/30' },
  operations:     { badge: 'bg-orange-900/60 text-orange-300 border-orange-700/40', ring: 'ring-orange-500/30' },
  documentation:  { badge: 'bg-blue-900/60 text-blue-300 border-blue-700/40',       ring: 'ring-blue-500/30' },
  integration:    { badge: 'bg-teal-900/60 text-teal-300 border-teal-700/40',       ring: 'ring-teal-500/30' },
  other:          { badge: 'bg-zinc-800/80 text-zinc-500 border-zinc-700/40',       ring: 'ring-zinc-500/20' },
}

function getKindStyle(kind?: string) {
  return KIND_STYLES[kind ?? 'other'] ?? KIND_STYLES.other
}

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function distributeGroups(groups: BlueprintGroupOverview[]): [BlueprintGroupOverview[], BlueprintGroupOverview[]] {
  const left: BlueprintGroupOverview[] = []
  const right: BlueprintGroupOverview[] = []
  let leftTotal = 0
  let rightTotal = 0
  for (const group of groups) {
    if (leftTotal <= rightTotal) {
      left.push(group)
      leftTotal += group.fileCount
    } else {
      right.push(group)
      rightTotal += group.fileCount
    }
  }
  return [left, right]
}

function buildAdjacency(groups: BlueprintGroupOverview[]): Map<string, BlueprintGroupConnection[]> {
  const map = new Map<string, BlueprintGroupConnection[]>()
  for (const group of groups) {
    map.set(group.id, group.connections)
  }
  return map
}

function getRoomCenter(groupId: string, container: HTMLDivElement): { x: number; y: number } | null {
  const el = container.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`)
  if (!el) return null
  const cr = container.getBoundingClientRect()
  const er = el.getBoundingClientRect()
  return {
    x: er.left - cr.left + er.width / 2,
    y: er.top - cr.top + er.height / 2,
  }
}

// ─── EdgeOverlay ──────────────────────────────────────────────────────────────

function EdgeOverlay({
  activeId,
  adjacency,
  containerRef,
  leftIds,
  maxCount,
  canvasSize,
}: {
  activeId: string
  adjacency: Map<string, BlueprintGroupConnection[]>
  containerRef: React.RefObject<HTMLDivElement | null>
  leftIds: Set<string>
  maxCount: number
  canvasSize: { width: number; height: number }
}) {
  const container = containerRef.current
  if (!container) return null

  const activeConnections = adjacency.get(activeId) ?? []
  if (activeConnections.length === 0) return null

  const activeCenter = getRoomCenter(activeId, container)
  if (!activeCenter) return null

  const activeIsLeft = leftIds.has(activeId)
  const paths: React.ReactNode[] = []

  for (const connection of activeConnections) {
    const otherId = connection.groupId
    const otherCenter = getRoomCenter(otherId, container)
    if (!otherCenter) continue

    const t = connection.count / maxCount
    const strokeWidth = 0.5 + t * 2.5
    const opacity = 0.15 + t * 0.55
    const otherIsLeft = leftIds.has(otherId)
    const sameColumn = activeIsLeft === otherIsLeft

    let d: string
    if (sameColumn) {
      const cpX = activeIsLeft ? canvasSize.width * 0.55 : canvasSize.width * 0.45
      const cpY = (activeCenter.y + otherCenter.y) / 2
      d = `M ${activeCenter.x} ${activeCenter.y} Q ${cpX} ${cpY} ${otherCenter.x} ${otherCenter.y}`
    } else {
      const offset = 80
      const fromCpX = activeCenter.x + (activeIsLeft ? offset : -offset)
      const toCpX = otherCenter.x + (otherIsLeft ? offset : -offset)
      d = `M ${activeCenter.x} ${activeCenter.y} C ${fromCpX} ${activeCenter.y} ${toCpX} ${otherCenter.y} ${otherCenter.x} ${otherCenter.y}`
    }

    paths.push(
      <path
        key={`${activeId}-${connection.direction}-${connection.groupId}`}
        d={d}
        fill="none"
        stroke="rgb(161 161 170)"
        strokeWidth={strokeWidth}
        strokeOpacity={opacity}
        strokeLinecap="round"
      />,
    )
  }

  if (paths.length === 0) return null

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0"
      width={canvasSize.width}
      height={canvasSize.height}
    >
      {paths}
    </svg>
  )
}

// ─── RoomCard ─────────────────────────────────────────────────────────────────

type RoomState = 'default' | 'active' | 'connected' | 'dimmed'

function RoomCard({
  group,
  state,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  group: BlueprintGroupOverview
  state: RoomState
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const kindStyle = getKindStyle(group.kind)

  return (
    <motion.button
      type="button"
      data-group-id={group.id}
      style={{ flex: group.fileCount }}
      className={cn(
        'relative flex min-h-[96px] w-full flex-col justify-between overflow-hidden rounded border p-4 text-left',
        state === 'default' && 'border-zinc-700/40 bg-zinc-800/30 hover:border-zinc-600/60 hover:bg-zinc-800/50',
        state === 'active' && cn('border-zinc-500/70 bg-zinc-800/60', kindStyle.ring, 'ring-1'),
        state === 'connected' && 'border-zinc-600/50 bg-zinc-800/40',
        state === 'dimmed' && 'border-zinc-700/20 bg-zinc-800/15',
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      animate={{ opacity: state === 'dimmed' ? 0.35 : 1 }}
      whileHover={state !== 'dimmed' ? { scale: 1.012 } : {}}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      {/* Köşe dekorasyonları */}
      <span aria-hidden className="pointer-events-none absolute left-1.5 top-1.5 h-2.5 w-2.5 border-l border-t border-zinc-600/30" />
      <span aria-hidden className="pointer-events-none absolute right-1.5 top-1.5 h-2.5 w-2.5 border-r border-t border-zinc-600/30" />
      <span aria-hidden className="pointer-events-none absolute bottom-1.5 left-1.5 h-2.5 w-2.5 border-b border-l border-zinc-600/30" />
      <span aria-hidden className="pointer-events-none absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b border-r border-zinc-600/30" />

      <div className="min-w-0 space-y-2">
        {/* Kind badge */}
        {group.kind && (
          <span className={cn(
            'inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
            kindStyle.badge,
          )}>
            {group.kind}
          </span>
        )}

        {/* Grup adı */}
        <p className="truncate text-sm font-semibold leading-tight text-zinc-200">{group.name}</p>

        {/* Quick Summary quote */}
        {group.summary && (
          <p className="line-clamp-2 text-xs italic leading-5 text-zinc-500">{group.summary}</p>
        )}
      </div>

      {/* Dosya sayısı */}
      <p className="mt-3 tabular-nums text-[11px] text-zinc-600">{group.fileCount} files</p>
    </motion.button>
  )
}

// ─── BlueprintCanvas ──────────────────────────────────────────────────────────

interface BlueprintCanvasProps {
  overview: BlueprintGroupsOverviewResponse
  activeGroupId: string | null
  onGroupClick: (group: BlueprintGroupOverview) => void
}

export function BlueprintCanvas({ overview, activeGroupId, onGroupClick }: BlueprintCanvasProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const [leftGroups, rightGroups] = useMemo(
    () => distributeGroups(overview.groups),
    [overview.groups],
  )
  const leftIds = useMemo(() => new Set(leftGroups.map(g => g.id)), [leftGroups])
  const adjacency = useMemo(() => buildAdjacency(overview.groups), [overview.groups])
  const maxCount = useMemo(
    () => Math.max(1, ...overview.groups.flatMap(group => group.connections.map(connection => connection.count))),
    [overview.groups],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    const rect = el.getBoundingClientRect()
    setCanvasSize({ width: rect.width, height: rect.height })
    return () => observer.disconnect()
  }, [])

  const activeId = hoveredId ?? activeGroupId

  const connectedIds = useMemo(() => {
    if (!activeId) return new Set<string>()
    return new Set(
      (adjacency.get(activeId) ?? []).map(e =>
        e.groupId,
      ),
    )
  }, [activeId, adjacency])

  function getRoomState(groupId: string): RoomState {
    if (!activeId) return 'default'
    if (groupId === activeId) return 'active'
    if (connectedIds.has(groupId)) return 'connected'
    return 'dimmed'
  }

  return (
    <div ref={containerRef} className="relative h-full">
      {/* Nokta deseni */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Edge overlay */}
      {activeId && (
        <EdgeOverlay
          activeId={activeId}
          adjacency={adjacency}
          containerRef={containerRef}
          leftIds={leftIds}
          maxCount={maxCount}
          canvasSize={canvasSize}
        />
      )}

      <div className="relative flex h-full justify-center gap-6 p-5">
        <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
          {leftGroups.map((group, i) => (
            <motion.div
              key={group.id}
              className="w-full max-w-[420px]"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05, duration: 0.25 }}
            >
              <RoomCard
                group={group}
                state={getRoomState(group.id)}
                onClick={() => onGroupClick(group)}
                onMouseEnter={() => setHoveredId(group.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            </motion.div>
          ))}
        </div>

        <div className="shrink-0 border-l border-dashed border-zinc-800/70" />

        <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
          {rightGroups.map((group, i) => (
            <motion.div
              key={group.id}
              className="w-full max-w-[420px]"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 + 0.1, duration: 0.25 }}
            >
              <RoomCard
                group={group}
                state={getRoomState(group.id)}
                onClick={() => onGroupClick(group)}
                onMouseEnter={() => setHoveredId(group.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
