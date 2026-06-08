# webvibe

`webvibe` is a policy-driven MCP relay for ChatGPT Web. It exposes a stable local
MCP/OAuth surface, connects configured upstream MCP servers, and only publishes
tools allowed by policy.

## Quick Start

```bash
npm install
npm run build
npm test
```

Run a local server:

```bash
npm run dev -- --config config.yaml
```

`config.yaml` contains the local listen address, public base URL, workspace root,
state directory, mode or custom policy path, and pairing code.

## Default Modes

- `read-only`: `context.get`, read-only file tools, read-only Git tools, and
  `diagnostics.health` through the compact ChatGPT Web tool surface.
- `dev`: everything in `read-only`, plus one-shot batch file changes,
  `git.commit`, and one `task.run` entrypoint for fixed npm, Go, Rust, and
  Python tasks.

For ChatGPT Web coding work, use `dev` mode. The model should call
`context.get` first, then read only relevant files, use `change.plan` to inspect
one complete batch file change, and use one `change.apply` call for the full
requested file change. Default dev mode does not expose raw per-file write tools
or arbitrary shell execution.

When ChatGPT Web blocks a write or a required local capability is unavailable,
dev mode uses `manual.gate`: the assistant shows exact manual instructions,
opens a local pending barrier, stops, and waits for the next user message to
start with `/resume`. `manual.resume` clears the barrier only after confirmation
or cancellation and does not run commands or write files.

The default tool list is stable. If a named task cannot run in the current
workspace or host environment, the call returns `status: "unavailable"` and an
`unavailableReason` instead of disappearing from the tool list.
Task availability and accepted task arguments are returned by `context.get`.

## Documents

- [Architecture](docs/architecture.md): relay boundary, modules, upstreams, and
  why this project does not fork Codex.
- [ChatGPT Web Workflow](docs/chatgpt-web-workflow.md): recommended tool order,
  one-shot file approval, tasks, and tool refresh behavior.
- [Policy](docs/policy.md): policy file shape, tool types, limits, and custom
  policies.
- [Security](docs/security.md): default-deny model, OAuth/pairing, path guards,
  narrow tasks, batch writes, redaction, and audit logging.

## Development

```bash
npm install
npm run build
npm test
npm run lint
```
