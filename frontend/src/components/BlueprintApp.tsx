import { useCallback, useEffect, useMemo, useState } from "react";
import { LayoutGrid, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { BlueprintCanvas } from "@/components/blueprint/BlueprintCanvas";
import { BlueprintExplorer } from "@/components/blueprint/BlueprintExplorer";
import { GroupDetailPanel } from "@/components/blueprint/GroupDetailPanel";
import {
  createDefaultBlueprintDataSource,
  type BlueprintDataSource,
} from "@/lib/blueprint/data-source";
import { cn } from "@/lib/ui/utils";
import type {
  BlueprintGroupDetailResponse,
  BlueprintGroupOverview,
  BlueprintGroupsOverviewResponse,
} from "@/lib/blueprint/api-types";

type Tab =
  | { id: "canvas"; type: "canvas" }
  | { id: string; type: "group"; group: BlueprintGroupOverview };

const defaultDataSource = createDefaultBlueprintDataSource();

export function BlueprintApp({ dataSource = defaultDataSource }: { dataSource?: BlueprintDataSource }) {
  const [overview, setOverview] = useState<BlueprintGroupsOverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, BlueprintGroupDetailResponse>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([{ id: "canvas", type: "canvas" }]);
  const [activeTabId, setActiveTabId] = useState("canvas");
  const [explorerOpen, setExplorerOpen] = useState(true);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await dataSource.getOverview());
      setOverviewError(null);
    } catch (error) {
      setOverviewError(error instanceof Error ? error.message : "Overview request failed");
    }
  }, [dataSource]);

  const loadGroupDetail = useCallback(async (groupId: string, force = false) => {
    if (!force && (details[groupId] || detailLoading[groupId])) return;
    setDetailLoading((prev) => ({ ...prev, [groupId]: true }));
    setDetailErrors((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });

    try {
      const detail = await dataSource.getGroup(groupId);
      setDetails((prev) => ({ ...prev, [groupId]: detail }));
    } catch (error) {
      setDetailErrors((prev) => ({
        ...prev,
        [groupId]: error instanceof Error ? error.message : "Detail request failed",
      }));
    } finally {
      setDetailLoading((prev) => ({ ...prev, [groupId]: false }));
    }
  }, [dataSource, detailLoading, details]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!dataSource.subscribe) return undefined;
    return dataSource.subscribe(() => {
      void loadOverview();
      for (const tab of tabs) {
        if (tab.type === "group") void loadGroupDetail(tab.group.id, true);
      }
    });
  }, [dataSource, loadGroupDetail, loadOverview, tabs]);

  function openGroup(group: BlueprintGroupOverview) {
    const tabId = `group-${group.id}`;
    setTabs((prev) => prev.some((tab) => tab.id === tabId) ? prev : [...prev, { id: tabId, type: "group", group }]);
    setActiveTabId(tabId);
    setActiveGroupId(group.id);
    void loadGroupDetail(group.id);
  }

  function closeTab(tabId: string, event: React.MouseEvent) {
    event.stopPropagation();
    const index = tabs.findIndex((tab) => tab.id === tabId);
    const fallback = tabs[index - 1]?.id ?? tabs[index + 1]?.id ?? "canvas";
    setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeTabId === tabId) setActiveTabId(fallback);
  }

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  if (overviewError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 px-6 text-sm text-red-300">
        {overviewError}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        Loading Blueprint...
      </div>
    );
  }

  return (
    <div
      className="blueprint-shell"
      style={!explorerOpen ? { gridTemplateColumns: "36px minmax(0, 1fr)" } : undefined}
    >
      <BlueprintExplorer
        overview={overview}
        activeGroupId={activeGroupId}
        collapsed={!explorerOpen}
        onToggleCollapse={() => setExplorerOpen((open) => !open)}
        onGroupClick={openGroup}
      />
      <section className="blueprint-workspace-column bg-zinc-950">
        <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-zinc-800 bg-zinc-900">
          <AnimatePresence initial={false}>
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <motion.div
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "group relative flex shrink-0 cursor-pointer select-none items-center gap-1.5 border-r border-zinc-800 px-3 text-xs transition-colors",
                    active
                      ? "bg-zinc-950 text-zinc-100"
                      : "bg-zinc-900 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="blueprint-tab-active"
                      className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-zinc-400"
                    />
                  )}
                  {tab.type === "canvas" ? (
                    <>
                      <LayoutGrid size={12} className="shrink-0" />
                      <span>Canvas</span>
                    </>
                  ) : (
                    <>
                      <span className="max-w-[180px] truncate">{tab.group.name}</span>
                      <button
                        type="button"
                        onClick={(event) => closeTab(tab.id, event)}
                        className={cn(
                          "ml-0.5 rounded p-0.5 transition-opacity hover:bg-zinc-700",
                          active ? "opacity-50 hover:opacity-100" : "opacity-0 group-hover:opacity-50 group-hover:hover:opacity-100",
                        )}
                      >
                        <X size={10} />
                      </button>
                    </>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        <main className="blueprint-workspace-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full"
            >
              {activeTab.type === "canvas" ? (
                <BlueprintCanvas overview={overview} activeGroupId={activeGroupId} onGroupClick={openGroup} />
              ) : details[activeTab.group.id] ? (
                <GroupDetailPanel detail={details[activeTab.group.id]} />
              ) : (
                <div className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
                  {detailErrors[activeTab.group.id]
                    ?? (detailLoading[activeTab.group.id] ? "Loading group..." : "Waiting for group data...")}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </section>
    </div>
  );
}
