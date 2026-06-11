# webvibe

`webvibe` is a local, policy-driven MCP relay for ChatGPT Web coding sessions. It exposes a stable OAuth/MCP endpoint, loads a policy, and publishes only the tools that policy allows. The relay is not an agent runtime and does not expose a general shell by default.

The default surface is shaped around ChatGPT Web host constraints: tool descriptors can be stale, high-risk calls can be blocked before they reach the relay, outputs can be truncated by the host, and the UI may ask for confirmation. `webvibe` therefore favors sanitized preflight, read-first inspection, fixed task IDs, preview-then-apply file changes, and visible manual completion with `/resume`.

## Quick start

Requirements: Node.js 20 or newer, plus a workspace you are willing to expose through the configured policy.

```bash
npm install
npm run build
npm test

cp config.example.yaml config.yaml
export WEBVIBE_PAIRING_CODE="$(openssl rand -base64 24)"

npm run dev -- --config config.yaml
```

`server.publicBaseUrl` must be reachable by ChatGPT Web. For local development this is normally a tunnel URL that forwards to `server.listen`.

After the server starts, connect ChatGPT Web to the configured `publicBaseUrl`. The OAuth authorization page asks for the pairing code from `WEBVIBE_PAIRING_CODE` or from the configured pairing-code source.

For a built run:

```bash
npm run build
npm run start -- --config config.yaml
```

## Configuration

The example config is intentionally small:

```yaml
version: 1
server:
  listen: "127.0.0.1:3000"
  publicBaseUrl: "https://example.ngrok.app"
  stateDir: "~/.webvibe"
  mode: "dev"
workspace:
  root: "."
auth:
  pairingCodeEnv: "WEBVIBE_PAIRING_CODE"
  pairingFailures:
    maxAttempts: 5
    windowSeconds: 600
  accessTokenTtlDays: 30
```

Important rules:

- `--config <path>` is required.
- `server.mode` and `server.policy` are mutually exclusive.
- If neither is set, the server uses the built-in `read-only` policy.
- Exactly one pairing-code source must be configured: `auth.pairingCode`, `auth.pairingCodeEnv`, or `auth.pairingCodeFile`.
- The pairing code `123456` is rejected at startup.
- Runtime state goes under `server.stateDir`; workspace task logs go under `.webvibe/task-logs/`.

## Built-in modes

| Mode        | Default surface                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `read-only` | `workspace.context`, `workspace.scan`, `workspace.symbols`, `fs.*`, Git inspection and `git.commit_preview`, `diagnostics.health`. |
| `dev`       | Everything in `read-only`, plus `file.change_preview`, `file.change_apply`, `manual.*`, `task.*`, and `git.commit`.                |

Default `dev` mode uses one logical file change per preview/apply call. Batch change tools exist in the contract registry for custom policies, but the built-in `dev` policy does not expose them.

## Default coding flow

A normal ChatGPT Web session should:

1. Call `workspace.context`.
2. Inspect with `workspace.scan`, `fs.tree`, `fs.search`, `fs.read`, `fs.read_many`, and `fs.stat`.
3. Call `task.list` before `task.run`; use `task.explain` when routing is unclear.
4. Preview workspace writes with `file.change_preview`.
5. Apply only with the matching `file.change_apply` `previewHash`.
6. Use `git.commit_preview` before `git.commit`.
7. Use `manual.prepare`, visible user instructions, `manual.gate`, and `/resume` when the host blocks a required action or no fixed tool/task can perform it.

## Development commands

```bash
npm run build
npm test
npm run lint
npm run audit
npm run policy:schema
npm run generate:tools
```

`npm run generate:tools` produces exact tool contract reference files from `src/tools/contracts`. Those generated files are reference artifacts, not hand-authored narrative documentation.

## Documents

- [Architecture](docs/architecture.md)
- [Workflows](docs/workflows.md)
- [ChatGPT Web Host Limits](docs/chatgpt-web-known-limits.md)
- [Policy and Security](docs/policy-security.md)
