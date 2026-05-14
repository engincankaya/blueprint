# Blueprint MCP

Blueprint gives AI coding agents a durable architecture memory for your repository.

It turns a codebase into a structured project map: responsibilities, relationships, entry points, risks, and the context an agent should read before changing code.

Instead of loading an entire repository into context, an agent can focus on the parts of the system that matter for the task. Developers also get a visual frontend for exploring the generated architecture map.

Use Blueprint when you want AI coding agents to work with less guesswork, tighter context, and a clearer understanding of how your project is actually put together.

## Why Blueprint?

- Gives agents a task-focused way to understand large codebases before editing.
- Groups the system by responsibility, data flow, and ownership boundaries.
- Produces detailed group documentation that agents can read selectively.
- Reduces wasted context by routing each task to the most relevant project areas.
- Keeps the architecture memory refreshable as the repository changes.
- Provides a visual viewer so developers can inspect the same project map.

Blueprint does not replace source code as the source of truth. It gives both agents and developers a better starting point before they inspect the source.

## Install

```bash
npm install -g blueprint-mcp
```

Requires Node.js 20 or newer.

Global installation makes the `blueprint` command available in your shell:

```bash
blueprint open --watch
```

If you install Blueprint only inside a project with `npm install blueprint-mcp`, run it through an npm script or `node_modules/.bin`; local npm binaries are not added to your interactive shell path automatically.

## MCP Configuration

Add Blueprint to your MCP client:

```json
{
  "mcpServers": {
    "blueprint": {
      "command": "blueprint-mcp"
    }
  }
}
```

Restart your MCP client after changing the configuration.

## Quick Start

Open your project in the coding agent you already use, such as Codex or Claude Code, and ask it to create a Blueprint:

```txt
Create a blueprint for this project.
```

The agent will scan the repository, group the codebase by responsibility, and write the architecture memory for future tasks.

Blueprint writes documentation in English by default. To use another language, ask for it naturally:

```txt
Create a Turkish blueprint for this project.
```

## What It Creates

Blueprint writes local project memory under `.blueprint/`:

| File | Purpose |
| --- | --- |
| `brief.md` | A compact routing index agents read first. |
| `groups/*.md` | Human-readable architecture notes for each project area. |
| `blueprint-output.json` | Structured project graph for tools and viewers. |
| `refresh-scan.json` | Filesystem snapshot used for deterministic refreshes. |

Teams can decide whether to commit `.blueprint/` or keep it local.

## Tools

| Tool | Purpose |
| --- | --- |
| `blueprint.scan` | Builds file inventory and code analysis artifacts. |
| `blueprint.group` | Prepares or applies semantic file grouping. |
| `blueprint.compose` | Writes the final Blueprint output and Markdown notes. |
| `blueprint.refresh` | Refreshes Blueprint state from the current filesystem snapshot. |
| `blueprint.group.update` | Assigns unassigned files or manages empty groups after refresh. |

## Viewer

Blueprint includes a static viewer for exploring generated memory. Open it in watch mode while working:

```bash
blueprint open --watch
```

Watch mode keeps the static viewer regenerated when Blueprint memory changes. If you only want to open the viewer once, remove `--watch` from the command.

## Language Support

Blueprint uses Tree-sitter analysis for:

- TypeScript / JavaScript
- Python
- Go
- Rust
- Java

Other files are still included in the inventory, but deeper symbol and import analysis depends on language support.

## License

MIT
