import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, FolderOpen } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { BlueprintGroupDetailResponse } from "@/lib/blueprint/api-types";
import { parseMarkdown, renderInlineMarkdown } from "@/lib/ui/markdown";
import { cn } from "@/lib/ui/utils";

type DetailFile = BlueprintGroupDetailResponse["files"][number];

const kindBadge: Record<string, string> = {
  runtime: "bg-sky-900/60 text-sky-300 border-sky-700/40",
  feature: "bg-violet-900/60 text-violet-300 border-violet-700/40",
  infrastructure: "bg-zinc-800/80 text-zinc-400 border-zinc-700/40",
  test: "bg-emerald-900/60 text-emerald-300 border-emerald-700/40",
  legacy: "bg-amber-900/60 text-amber-300 border-amber-700/40",
  operations: "bg-orange-900/60 text-orange-300 border-orange-700/40",
  documentation: "bg-blue-900/60 text-blue-300 border-blue-700/40",
  integration: "bg-teal-900/60 text-teal-300 border-teal-700/40",
  other: "bg-zinc-800/80 text-zinc-500 border-zinc-700/40",
};

interface TreeNode {
  name: string;
  path: string;
  kind: "folder" | "file";
  file?: DetailFile;
  children: Map<string, TreeNode>;
}

export function GroupDetailPanel({ detail }: { detail: BlueprintGroupDetailResponse }) {
  const [expandedSections, setExpandedSections] = useState(() => new Set(["snapshot", "responsibilities", "coreFlow"]));
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => collectFolderPaths(buildTree(detail.files)));
  const tree = useMemo(() => buildTree(detail.files), [detail.files]);
  const sections = [
    ["snapshot", "Snapshot"],
    ["responsibilities", "Responsibilities"],
    ["coreFlow", "Core Flow"],
    ["contracts", "Contracts & Invariants"],
    ["changeGuide", "Change Guide"],
    ["pitfalls", "Pitfalls"],
    ["tests", "Tests"],
    ["debugging", "Debugging"],
  ] as const;

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="grid h-full grid-cols-[minmax(260px,28%)_minmax(0,1fr)] overflow-hidden bg-zinc-950">
      <aside className="min-w-0 overflow-hidden border-r border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          {detail.group.kind && (
            <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider", kindBadge[detail.group.kind] ?? kindBadge.other)}>
              {detail.group.kind}
            </span>
          )}
          <h1 className="mt-3 truncate text-lg font-semibold text-zinc-100">{detail.group.name}</h1>
          {detail.group.summary && <p className="mt-2 text-xs leading-5 text-zinc-500">{detail.group.summary}</p>}
        </div>
        <div className="min-h-0 overflow-y-auto p-2">
          <TreeRows
            nodes={sortNodes([...tree.children.values()])}
            depth={0}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
          />
        </div>
      </aside>

      <section className="min-w-0 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-5">
          <div className="mb-5 grid gap-2 border-b border-zinc-800 pb-4 text-xs text-zinc-500 sm:grid-cols-3">
            <span>{detail.files.length} files</span>
            <span>{detail.connections.length} connections</span>
            <span>{detail.doc.exists ? "Docs ready" : "Docs missing"}</span>
          </div>

          <div className="space-y-2">
            {sections.map(([id, title]) => {
              const content = detail.doc.sections[id];
              if (!content) return null;
              const open = expandedSections.has(id);
              return (
                <section key={id} className="overflow-hidden rounded border border-zinc-800 bg-zinc-900/40">
                  <button
                    type="button"
                    onClick={() => toggleSection(id)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800/60"
                  >
                    <span>{title}</span>
                    <ChevronDown size={14} className={cn("transition-transform", open ? "rotate-180" : "")} />
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-zinc-800 px-4 py-3">
                          <SectionContent content={content} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </section>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function TreeRows({
  nodes,
  depth,
  expandedFolders,
  onToggleFolder,
}: {
  nodes: TreeNode[];
  depth: number;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}) {
  return (
    <div className="space-y-px">
      {nodes.map((node) => {
        if (node.kind === "folder") {
          const open = expandedFolders.has(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                onClick={() => onToggleFolder(node.path)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11.5px] text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
                style={{ paddingLeft: 8 + depth * 12 }}
              >
                <ChevronRight size={12} className={cn("transition-transform", open ? "rotate-90" : "")} />
                {open ? <FolderOpen size={13} /> : <Folder size={13} />}
                <span className="truncate">{node.name}</span>
              </button>
              {open && (
                <TreeRows
                  nodes={sortNodes([...node.children.values()])}
                  depth={depth + 1}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                />
              )}
            </div>
          );
        }
        return (
          <div
            key={node.path}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-[11.5px] text-zinc-600"
            style={{ paddingLeft: 22 + depth * 12 }}
            title={node.file?.summary}
          >
            <FileCode2 size={13} className="shrink-0" />
            <span className="truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function SectionContent({ content }: { content: string }) {
  const blocks = parseMarkdown(content);
  return (
    <div className="space-y-2 text-sm leading-6 text-zinc-300">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h2 key={index} className="text-sm font-semibold text-zinc-100">{renderInlineMarkdown(block.content)}</h2>;
        }
        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index} className={block.ordered ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5"}>
              {block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}
            </ListTag>
          );
        }
        if (block.type === "code") {
          return <pre key={index} className="overflow-x-auto rounded bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100"><code>{block.content}</code></pre>;
        }
        if (block.type === "quote") {
          return <blockquote key={index} className="border-l-2 border-zinc-700 pl-3 italic opacity-90">{renderInlineMarkdown(block.content)}</blockquote>;
        }
        return <p key={index} className="whitespace-pre-wrap">{renderInlineMarkdown(block.content)}</p>;
      })}
    </div>
  );
}

function buildTree(files: DetailFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let cursor = root;
    parts.forEach((part, index) => {
      const fileNode = index === parts.length - 1;
      const childPath = cursor.path ? `${cursor.path}/${part}` : part;
      if (fileNode) {
        cursor.children.set(part, { name: part, path: childPath, kind: "file", file, children: new Map() });
        return;
      }
      if (!cursor.children.has(part)) {
        cursor.children.set(part, { name: part, path: childPath, kind: "folder", children: new Map() });
      }
      cursor = cursor.children.get(part)!;
    });
  }
  return root;
}

function collectFolderPaths(node: TreeNode, acc = new Set<string>()): Set<string> {
  for (const child of node.children.values()) {
    if (child.kind === "folder") {
      acc.add(child.path);
      collectFolderPaths(child, acc);
    }
  }
  return acc;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
