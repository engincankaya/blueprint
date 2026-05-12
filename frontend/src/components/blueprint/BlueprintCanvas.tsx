import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type {
  BlueprintGroupConnection,
  BlueprintGroupOverview,
  BlueprintGroupsOverviewResponse,
} from "@/lib/blueprint/api-types";
import { cn } from "@/lib/ui/utils";

const kindStyles: Record<string, { badge: string; ring: string }> = {
  runtime: { badge: "bg-sky-900/60 text-sky-300 border-sky-700/40", ring: "ring-sky-500/30" },
  feature: { badge: "bg-violet-900/60 text-violet-300 border-violet-700/40", ring: "ring-violet-500/30" },
  infrastructure: { badge: "bg-zinc-800/80 text-zinc-400 border-zinc-700/40", ring: "ring-zinc-500/20" },
  test: { badge: "bg-emerald-900/60 text-emerald-300 border-emerald-700/40", ring: "ring-emerald-500/30" },
  legacy: { badge: "bg-amber-900/60 text-amber-300 border-amber-700/40", ring: "ring-amber-500/30" },
  operations: { badge: "bg-orange-900/60 text-orange-300 border-orange-700/40", ring: "ring-orange-500/30" },
  documentation: { badge: "bg-blue-900/60 text-blue-300 border-blue-700/40", ring: "ring-blue-500/30" },
  integration: { badge: "bg-teal-900/60 text-teal-300 border-teal-700/40", ring: "ring-teal-500/30" },
  other: { badge: "bg-zinc-800/80 text-zinc-500 border-zinc-700/40", ring: "ring-zinc-500/20" },
};

interface BlueprintCanvasProps {
  overview: BlueprintGroupsOverviewResponse;
  activeGroupId: string | null;
  onGroupClick: (group: BlueprintGroupOverview) => void;
}

type RoomState = "default" | "active" | "connected" | "dimmed";

export function BlueprintCanvas({ overview, activeGroupId, onGroupClick }: BlueprintCanvasProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftGroups, rightGroups] = useMemo(() => distributeGroups(overview.groups), [overview.groups]);
  const leftIds = useMemo(() => new Set(leftGroups.map((group) => group.id)), [leftGroups]);
  const adjacency = useMemo(() => buildAdjacency(overview.groups), [overview.groups]);
  const activeId = hoveredId ?? activeGroupId;
  const maxCount = useMemo(
    () => Math.max(1, ...overview.groups.flatMap((group) => group.connections.map((connection) => connection.count))),
    [overview.groups],
  );
  const connectedIds = useMemo(() => {
    if (!activeId) return new Set<string>();
    return new Set((adjacency.get(activeId) ?? []).map((connection) => connection.groupId));
  }, [activeId, adjacency]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    const rect = element.getBoundingClientRect();
    setCanvasSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  function getRoomState(groupId: string): RoomState {
    if (!activeId) return "default";
    if (groupId === activeId) return "active";
    if (connectedIds.has(groupId)) return "connected";
    return "dimmed";
  }

  return (
    <div ref={containerRef} className="relative h-full">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
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
      <div className="relative flex h-full gap-0 p-5">
        <RoomColumn groups={leftGroups} side="left" getState={getRoomState} onGroupClick={onGroupClick} setHoveredId={setHoveredId} />
        <div className="mx-3 shrink-0 border-l border-dashed border-zinc-800/70" />
        <RoomColumn groups={rightGroups} side="right" getState={getRoomState} onGroupClick={onGroupClick} setHoveredId={setHoveredId} />
      </div>
    </div>
  );
}

function RoomColumn({
  groups,
  side,
  getState,
  onGroupClick,
  setHoveredId,
}: {
  groups: BlueprintGroupOverview[];
  side: "left" | "right";
  getState: (groupId: string) => RoomState;
  onGroupClick: (group: BlueprintGroupOverview) => void;
  setHoveredId: (groupId: string | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {groups.map((group, index) => (
        <motion.div
          key={group.id}
          initial={{ opacity: 0, x: side === "left" ? -12 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.05 + (side === "right" ? 0.1 : 0), duration: 0.25 }}
        >
          <RoomCard
            group={group}
            state={getState(group.id)}
            onClick={() => onGroupClick(group)}
            onMouseEnter={() => setHoveredId(group.id)}
            onMouseLeave={() => setHoveredId(null)}
          />
        </motion.div>
      ))}
    </div>
  );
}

function RoomCard({
  group,
  state,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  group: BlueprintGroupOverview;
  state: RoomState;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const style = kindStyles[group.kind ?? "other"] ?? kindStyles.other;
  return (
    <motion.button
      type="button"
      data-group-id={group.id}
      style={{ flex: group.fileCount }}
      className={cn(
        "relative flex min-h-[96px] w-full flex-col justify-between overflow-hidden rounded border p-4 text-left",
        state === "default" && "border-zinc-700/40 bg-zinc-800/30 hover:border-zinc-600/60 hover:bg-zinc-800/50",
        state === "active" && cn("border-zinc-500/70 bg-zinc-800/60 ring-1", style.ring),
        state === "connected" && "border-zinc-600/50 bg-zinc-800/40",
        state === "dimmed" && "border-zinc-700/20 bg-zinc-800/15",
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      animate={{ opacity: state === "dimmed" ? 0.35 : 1 }}
      whileHover={state !== "dimmed" ? { scale: 1.012 } : {}}
      transition={{ type: "spring", stiffness: 400, damping: 28 }}
    >
      <div className="min-w-0 space-y-2">
        {group.kind && (
          <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider", style.badge)}>
            {group.kind}
          </span>
        )}
        <p className="truncate text-sm font-semibold leading-tight text-zinc-200">{group.name}</p>
        {group.summary && <p className="max-h-10 overflow-hidden text-xs italic leading-5 text-zinc-500">{group.summary}</p>}
      </div>
      <p className="mt-3 tabular-nums text-[11px] text-zinc-600">{group.fileCount} files</p>
    </motion.button>
  );
}

function EdgeOverlay({
  activeId,
  adjacency,
  containerRef,
  leftIds,
  maxCount,
  canvasSize,
}: {
  activeId: string;
  adjacency: Map<string, BlueprintGroupConnection[]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  leftIds: Set<string>;
  maxCount: number;
  canvasSize: { width: number; height: number };
}) {
  const container = containerRef.current;
  if (!container) return null;
  const activeCenter = getRoomCenter(activeId, container);
  if (!activeCenter) return null;
  const activeIsLeft = leftIds.has(activeId);
  const paths = (adjacency.get(activeId) ?? []).flatMap((connection) => {
    const otherCenter = getRoomCenter(connection.groupId, container);
    if (!otherCenter) return [];
    const t = connection.count / maxCount;
    const otherIsLeft = leftIds.has(connection.groupId);
    const sameColumn = activeIsLeft === otherIsLeft;
    const d = sameColumn
      ? `M ${activeCenter.x} ${activeCenter.y} Q ${activeIsLeft ? canvasSize.width * 0.55 : canvasSize.width * 0.45} ${(activeCenter.y + otherCenter.y) / 2} ${otherCenter.x} ${otherCenter.y}`
      : `M ${activeCenter.x} ${activeCenter.y} C ${activeCenter.x + (activeIsLeft ? 80 : -80)} ${activeCenter.y} ${otherCenter.x + (otherIsLeft ? 80 : -80)} ${otherCenter.y} ${otherCenter.x} ${otherCenter.y}`;
    return (
      <path
        key={`${activeId}-${connection.direction}-${connection.groupId}`}
        d={d}
        fill="none"
        stroke="rgb(161 161 170)"
        strokeWidth={0.5 + t * 2.5}
        strokeOpacity={0.15 + t * 0.55}
        strokeLinecap="round"
      />
    );
  });
  return <svg aria-hidden className="pointer-events-none absolute inset-0" width={canvasSize.width} height={canvasSize.height}>{paths}</svg>;
}

function distributeGroups(groups: BlueprintGroupOverview[]): [BlueprintGroupOverview[], BlueprintGroupOverview[]] {
  const left: BlueprintGroupOverview[] = [];
  const right: BlueprintGroupOverview[] = [];
  let leftTotal = 0;
  let rightTotal = 0;
  for (const group of groups) {
    if (leftTotal <= rightTotal) {
      left.push(group);
      leftTotal += group.fileCount;
    } else {
      right.push(group);
      rightTotal += group.fileCount;
    }
  }
  return [left, right];
}

function buildAdjacency(groups: BlueprintGroupOverview[]): Map<string, BlueprintGroupConnection[]> {
  const map = new Map<string, BlueprintGroupConnection[]>();
  for (const group of groups) map.set(group.id, group.connections);
  return map;
}

function getRoomCenter(groupId: string, container: HTMLDivElement): { x: number; y: number } | null {
  const element = container.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`);
  if (!element) return null;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return {
    x: elementRect.left - containerRect.left + elementRect.width / 2,
    y: elementRect.top - containerRect.top + elementRect.height / 2,
  };
}
