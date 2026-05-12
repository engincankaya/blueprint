import type { BlueprintGroupOverview, BlueprintGroupsOverviewResponse } from "@/lib/blueprint/api-types";
import { cn } from "@/lib/ui/utils";

interface BlueprintExplorerProps {
  overview: BlueprintGroupsOverviewResponse;
  activeGroupId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onGroupClick: (group: BlueprintGroupOverview) => void;
}

export function BlueprintExplorer({
  overview,
  activeGroupId,
  collapsed,
  onToggleCollapse,
  onGroupClick,
}: BlueprintExplorerProps) {
  return (
    <aside className="blueprint-explorer-column bg-zinc-950">
      <div className="flex h-full flex-col overflow-hidden">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex h-[48px] w-full shrink-0 items-center gap-2 border-b border-zinc-800 px-2.5 text-zinc-500 transition-colors hover:text-zinc-300"
          title={collapsed ? "Open Explorer" : "Close Explorer"}
        >
          <HamburgerIcon />
          {!collapsed && (
            <span className="truncate text-[12.5px] font-semibold tracking-wide text-zinc-400">
              Explorer
            </span>
          )}
        </button>

        {!collapsed && (
          <>
            <p className="shrink-0 px-3 py-1.5 text-[10.5px] text-zinc-700">
              {overview.totals.groups} groups · {overview.totals.files} files
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              <div className="flex flex-col gap-px px-1.5">
                {overview.groups.map((group) => {
                  const selected = activeGroupId === group.id;
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => onGroupClick(group)}
                      className={cn(
                        "flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                        selected
                          ? "bg-zinc-800 text-zinc-200"
                          : "text-zinc-600 hover:bg-zinc-800/60 hover:text-zinc-300",
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: getGroupDotColor(group.kind) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[11.5px]">{group.name}</span>
                      <span className="shrink-0 tabular-nums text-[10px] text-zinc-700">{group.fileCount}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function HamburgerIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="2" y="3.75" width="11" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="2" y="6.75" width="11" height="1.5" rx="0.75" fill="currentColor" />
      <rect x="2" y="9.75" width="11" height="1.5" rx="0.75" fill="currentColor" />
    </svg>
  );
}

function getGroupDotColor(kind?: string): string {
  const colors: Record<string, string> = {
    runtime: "#38bdf8",
    feature: "#a78bfa",
    infrastructure: "#71717a",
    test: "#34d399",
    legacy: "#fbbf24",
    operations: "#fb923c",
    documentation: "#60a5fa",
    integration: "#2dd4bf",
  };
  return colors[kind ?? ""] ?? "#52525b";
}
