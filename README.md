# Mindmap MCP Server

Architecture-aware memory for coding agents.

Mindmap MCP Server analyzes a project, groups its files by responsibility, and writes a compact Blueprint memory that LLM coding agents can use before touching source code. The result is a small, maintainable project map instead of repeated full-repository scans.

It is designed for teams that use MCP-capable agents with real codebases and want durable architectural context inside each project.

## What It Creates

After setup, a project gets a `blueprint/` directory containing:

- `brief.md`: a compact routing map for agents.
- `groups/*.md`: focused architecture notes for each area of the codebase.
- `blueprint-output.json`: structured project graph used by tools and UIs.
- `refresh-scan.json`: file hash snapshot used for deterministic maintenance.

These files become the project's memory layer. They are useful for onboarding, code review, agent routing, and focused implementation work.

## Why Use It

LLMs often lose time rediscovering the same codebase structure. This server gives them a stable first layer of context:

- Which files belong together.
- Where entry points and tests live.
- What contracts and pitfalls matter in each area.
- Which files are likely relevant for a specific task.
- What changed since the last Blueprint refresh.

Blueprint memory is not a replacement for source code. It is an orientation layer. Source remains the source of truth.

## Features

- MCP tools for scan, grouping, compose, refresh, group update, and task context.
- Tree-sitter based code analysis.
- Language normalizers for TypeScript/JavaScript, Python, Go, Rust, and Java.
- Deterministic refresh based on filesystem snapshots and content hashes.
- Markdown group notes designed for both humans and coding agents.
- Token-aware task context selection.
- Optional HTTP API for terminal query and Blueprint group inspection.

## Requirements

- Node.js 20 or newer.
- An MCP-capable client or coding agent.
- A project repository that the MCP client can read and write.

## Installation

After the package is published to npm:

```bash
npm install -g mindmap-mcp-server
```

For local development from source:

```bash
git clone <repo-url>
cd <repo-directory>
npm install
npm run build
```

The package exposes this executable:

```bash
mindmap-mcp-server
```

From source, the same server can be started with:

```bash
npm start
```

## MCP Configuration

Add the server to your MCP client configuration.

For a globally installed package:

```json
{
  "mcpServers": {
    "blueprint": {
      "command": "mindmap-mcp-server"
    }
  }
}
```

For a local checkout:

```json
{
  "mcpServers": {
    "blueprint": {
      "command": "node",
      "args": ["/absolute/path/to/blueprint/dist/index.js"]
    }
  }
}
```

Restart your MCP client after changing the configuration.

## Creating Blueprint Memory For A Project

Run the initial pipeline from your MCP client:

1. Call `blueprint.scan` with the absolute project root.
2. Call `blueprint.group` in `prepare` mode with the returned analysis artifact.
3. Ask the LLM to produce a compact `GroupingPlan` from the prepare packet.
4. Call `blueprint.group` in `apply` mode with that plan.
5. Call `blueprint.compose` with the grouping artifact.
6. Follow any required assistant next steps returned by `blueprint.compose`, especially group doc hydration.

This writes the project's Blueprint files under `blueprint/`.

## Using Blueprint During Agent Work

Add an `AGENTS.md` or equivalent project instruction that tells agents to read Blueprint first.

Example:

```md
Before working on any task:

1. Read `blueprint/brief.md`.
2. Search `blueprint/brief.md` and `blueprint/groups/*.md` with task-specific keywords.
3. Read only the smallest relevant group docs.
4. Inspect source code only where docs are insufficient or edits are needed.
5. Treat source code as the source of truth if it conflicts with Blueprint memory.
```

This keeps agent context focused and prevents broad, repeated repository reads.

## Keeping Memory Up To Date

After adding, moving, deleting, or substantially changing files:

1. Call `blueprint.refresh`.
2. If the refresh reports unassigned files, call `blueprint.group.update`.
3. Update only the relevant `blueprint/groups/*.md` notes if architectural responsibilities changed.

Do not edit `blueprint-output.json` manually. It is maintained by MCP tools.

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `blueprint.scan` | Builds a file inventory and code analysis artifact. |
| `blueprint.group` | Prepares grouping context or applies a grouping plan. |
| `blueprint.compose` | Writes final Blueprint JSON and group docs. |
| `blueprint.refresh` | Refreshes Blueprint state from the current filesystem snapshot. |
| `blueprint.group.update` | Assigns new unassigned files or creates/removes groups after refresh. |
| `blueprint.task_context` | Returns a compact context slice for a natural-language task. |

## Development

```bash
npm install
npm run build
npm run lint
npm run test
```

Useful scripts:

| Command | Description |
| --- | --- |
| `npm run build` | Compile TypeScript, copy Tree-sitter grammars, add executable shebang. |
| `npm run lint` | Run TypeScript checks without emitting files. |
| `npm run test` | Run the Vitest suite. |
| `npm start` | Start the MCP server over stdio from `dist/index.js`. |
| `npm run start:server` | Start the optional HTTP server. |

## Project Structure

```text
src/
  index.ts                 MCP server entry point
  tools/                   Blueprint MCP tools
  lib/                     Shared artifact, terminal, hashing, and doc helpers
  languages/               Tree-sitter normalizers
  server/                  Optional HTTP API
  services/                HTTP and maintenance services
tests/                     Vitest test suite
scripts/                   Build helper scripts
```

## Current Limits

- `ArtifactStore` is in memory; pipeline artifact IDs do not survive server restarts.
- Blueprint Markdown is guidance, not authority. Agents must verify behavior in source when making changes.
- New files are intentionally left unassigned by refresh until an explicit group update is made.
- Language support depends on available Tree-sitter grammars and normalizers.

## License

No license has been specified yet. Add one before publishing or accepting external contributions.
