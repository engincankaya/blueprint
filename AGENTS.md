# AGENTS.md

## Project Memory

This project uses Blueprint memory. Blueprint files are the first orientation
layer for every task, but they are not the source of truth.

Before working on any task:

1. Read `blueprint/brief.md` for the project map.
2. Identify the group or groups that may be relevant.
3. Search the Blueprint Markdown docs with task-specific keywords before reading
   source code.
4. Read only the smallest useful set of group docs, usually 1-3 files under
   `blueprint/groups/*.md`.
5. Inspect source code only where the docs are insufficient, where behavior must
   be verified, or where edits are needed.

Do not read the whole repository unless the task truly requires it.

## Blueprint Reading Strategy

After reading `blueprint/brief.md`, do not immediately read every candidate
group document end to end. First use targeted search over `blueprint/brief.md`
and `blueprint/groups/*.md` with task keywords.

Search for:

- function names
- file names
- tool names
- endpoint names
- service or class names
- domain terms from the user request
- error messages
- important words that describe the requested behavior

Use the search results to choose the smallest useful set of group documents.
Prefer targeted Markdown search plus selective group-doc reading over broad
source exploration.

Avoid broad group-doc reads. A group doc should usually be entered through
search-hit line ranges first, not from the top of the file.

Group docs are not just file indexes. Use them to understand:

- responsibilities and ownership boundaries
- runtime flow
- contracts and invariants
- change guides
- pitfalls and known risks
- test and debugging guidance

If the Markdown docs provide enough orientation, inspect source code only in the
narrow areas that need verification or edits. If the docs are missing, stale,
ambiguous, or conflict with source code, trust the source code.

When inspecting source code, avoid broad repository reads. Prefer:

- the group docs' `start files`
- paths and symbols found by Blueprint Markdown search
- targeted source `rg` searches
- nearby tests listed by the relevant group docs

## Token Discipline For Blueprint Reads

Blueprint memory is an orientation layer, not material to consume broadly.

After reading `blueprint/brief.md`:

1. Run targeted `rg` over `blueprint/brief.md` and `blueprint/groups/*.md`.
2. Do not open whole group docs or large line ranges by default.
3. Prefer reading narrow line windows around search hits, usually 20-60 lines.
4. Use the stable section headings to jump directly to the part you need, such
   as `Core Flow`, `Contracts & Invariants`, `Change Guide`, `Pitfalls`, or
   `Tests`.
5. Read a full group doc only when:
   - search hits are ambiguous
   - the task changes that group's architectural contract
   - the section structure is needed as an implementation checklist
   - source context remains unclear after targeted reads
6. Before reading more than two group docs, have a concrete reason for each
   additional doc.
7. Once the relevant source files are identified, switch to targeted source
   inspection instead of continuing Blueprint reading.

Default budget:

- `blueprint/brief.md`: always read.
- Blueprint Markdown search: always prefer early.
- Group docs: read targeted excerpts first.
- Full group docs: exception, not default.

## Group Doc Template

Files under `blueprint/groups/*.md` follow a stable template. Read the sections
intentionally:

- `Snapshot` gives quick orientation.
- `Responsibilities` defines ownership and out-of-scope areas.
- `Core Flow` explains runtime behavior and data flow.
- `Contracts & Invariants` lists behavior that must not be broken.
- `Key Files` points to the main source files for the group.
- `Change Guide` lists files or contracts that should change together.
- `Pitfalls` captures known risks and common mistakes.
- `Tests` identifies the most relevant verification.
- `Debugging` gives failure-mode hints.
- `Extension / Open Questions` records uncertainty and known gaps.

Use this structure as a checklist while planning and implementing changes.

## Source Of Truth

Blueprint files are orientation, not authority.

- Source code is the ground truth.
- If Blueprint docs conflict with source code, trust source code.
- After changing source behavior, update the relevant Blueprint group doc if the
  memory became stale.

## How To Use Blueprint

Use `blueprint/brief.md` to find:

- project overview
- architectural groups
- routing hints
- key files
- entrypoints
- group documentation paths

Use `blueprint/groups/*.md` to understand the relevant architecture before
editing source code. Do not duplicate large source details into Blueprint docs;
record stable architectural facts, contracts, pitfalls, and test guidance.

## Working Rules

- Keep changes scoped to the user's task.
- Prefer existing project patterns over new abstractions.
- Add or update tests when behavior changes.
- Run the smallest relevant verification first.
- Do not edit generated files unless the task explicitly requires it.
- Do not modify secrets, local environment files, or unrelated configuration.

## Build And Test

Use the commands documented in this project's Blueprint memory or package/tooling
files.

When unsure:

- inspect the nearest package manifest
- inspect CI workflow files
- prefer existing scripts over invented commands

## Blueprint Maintenance

Do not run Blueprint maintenance after every intermediate edit. Many changes are
drafts while the user is still reviewing direction.

Run Blueprint maintenance only when a task's changes are intended to remain, for
example after the user accepts the direction, asks to finalize, or the work is
otherwise clearly complete. If that is unclear, ask the user whether to update
Blueprint before running maintenance.

When a permanent change adds, moves, deletes, or substantially changes files:

- run `blueprint.refresh` so `blueprint/blueprint-output.json` and
  `blueprint/refresh-scan.json` are updated from the current filesystem
  snapshot
- if `blueprint.refresh` reports unassigned files or empty group candidates,
  use `blueprint.group.update` for those validated group decisions
- do not use `blueprint.group.update` for updated files that already belong to a
  real group; refresh has already updated deterministic JSON for those files
- update only the relevant `blueprint/groups/*.md` files when architectural
  responsibilities, contracts, pitfalls, or test guidance changed
- keep `blueprint/brief.md` aligned with the current Blueprint output through
  the project tools that generate it; do not hand-edit it as a substitute for
  deterministic maintenance
- avoid duplicating full source details in Markdown
- record stable architectural facts, contracts, pitfalls, and test guidance
- do not edit `blueprint/blueprint-output.json` manually; use the MCP tools for
  deterministic JSON maintenance
