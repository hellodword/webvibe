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

- `read-only`: relay info, sanitized environment inspection, project/code
  inspection, read-only filesystem tools, and stable read-only Git tools.
- `dev`: everything in `read-only`, plus batch workspace changeset tools,
  `git.commit_paths`, and fixed npm, Go, Rust, and Python task tools.

For ChatGPT Web coding work, use `dev` mode. Let the model read/search first,
starting with `env.inspect` when environment capability is unclear, then use
`repo.file_manifest`, `repo.preview_changeset`, and `repo.apply_changeset`.
Default dev mode applies a reviewed multi-file changeset in one write tool call
instead of exposing raw per-file write tools.

The default tool list is stable. If a named task cannot run in the current
workspace or host environment, the call returns `status: "unavailable"` and an
`unavailableReason` instead of disappearing from the tool list.

## Documents

- [Architecture](docs/architecture.md): relay boundary, modules, upstreams, and
  why this project does not fork Codex.
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
