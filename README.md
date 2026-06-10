# webvibe

`webvibe` is a policy-driven MCP relay for ChatGPT Web. It exposes a stable
local MCP/OAuth surface, connects configured upstream MCP servers, and publishes
only the tools allowed by policy.

The project goal is coding completion inside ChatGPT Web's real host
constraints: review prompts, black-box risk blocks, output truncation, and stale
tool descriptors. Default tools are shaped to reduce host friction, and manual
completion with `/resume` is a recovery path for finishing work when the host
refuses a tool call.

## Run

```bash
npm install
npm run build
npm test
npm run dev -- --config config.yaml
```

`config.yaml` sets the listen address, public base URL, workspace root, state
directory, built-in mode or custom policy path, and pairing code.

## Default Modes

- `read-only`: `workspace.context`, read-only `workspace.*`, `fs.*`, Git
  inspection tools, and `diagnostics.health`.
- `dev`: everything in `read-only`, plus `file.change_preview`, `file.change_apply`,
  `manual.prepare`, `manual.gate`, `manual.status`, `manual.resume`, `task.*`,
  and `git.commit`.

Default `dev` mode uses fixed policy-defined tasks and single-edit workspace
change tools. The configured `editMode` defaults to `single`, meaning models
should use one logical file operation at a time; policy can later expose
`batch.change_preview` / `batch.change_apply` for multi-file changes. The
default surface does not expose free-form
process execution, raw per-file write tools, or hidden prepared-payload
application.

`workspace.context` reports available tasks plus task candidates discovered from
npm/pnpm/yarn/bun scripts, Go, Rust, Dart/Flutter, Playwright/Cypress/Vitest/
Jest/ESLint/TypeScript configs, Prisma/Drizzle/buf/sqlc/OpenAPI configs, and
Make/just/Taskfile targets. Candidates are informational unless policy maps them
to a fixed task ID.

`diagnostics.health` reports server version, policy hash, effective limits, tool
surface version/hash, instruction version/hash, upstream health, and recent tool
errors.

## Development

```bash
npm test
npm run build
npm run lint
npx tsc -p tsconfig.json --noEmit
```

## Documents

- [Architecture](docs/architecture.md)
- [ChatGPT Web Constraint Adaptation](docs/chatgpt-web-known-limits.md)
- [ChatGPT Web Workflow](docs/chatgpt-web-workflow.md)
- [Policy](docs/policy.md)
- [Security](docs/security.md)
