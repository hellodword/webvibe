# webvibe

`webvibe` is a policy-driven MCP relay for ChatGPT Web. It exposes a stable
local MCP/OAuth surface, connects configured upstream MCP servers, and publishes
only the tools allowed by policy.

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

- `read-only`: `context.get`, read-only file tools, read-only Git tools, and
  `diagnostics.health`.
- `dev`: everything in `read-only`, plus `change.plan`, `change.prepare`,
  `change.apply`, `manual.gate`, `manual.resume`, `task.run`, and `git.commit`.

Default `dev` mode uses complete batch file changes and fixed policy-defined
tasks. It does not expose arbitrary shell execution, raw per-file write tools,
or hidden prepared-payload application.

## Development

```bash
npm test
npm run build
npm run lint
npx tsc -p tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters
```

## Documents

- [Architecture](docs/architecture.md)
- [ChatGPT Web Known Limits](docs/chatgpt-web-known-limits.md)
- [ChatGPT Web Workflow](docs/chatgpt-web-workflow.md)
- [Policy](docs/policy.md)
- [Security](docs/security.md)
