# Architecture

`webvibe` is a relay at the boundary between ChatGPT Web and local or remote MCP tool providers.

```text
ChatGPT Web
  -> OAuth + MCP over HTTP
  -> webvibe policy registry
  -> built-ins, upstream MCP servers, or local-task-runner
  -> bounded tool result + audit record
```

The relay owns the connector-facing protocol, policy enforcement, tool registration, routing, output shaping, audit logging, bounded workspace changes, fixed local tasks, and manual completion state. It does not own the model runtime, ChatGPT Web's host-side review, or operating-system sandboxing.

Policies reduce the capabilities exposed through `webvibe`; they are not a replacement for an OS sandbox or a separate throwaway workspace.

## Startup

Startup is:

1. Parse `--config`.
2. Load app config.
3. Resolve `workspace.root`, `server.stateDir`, `server.publicBaseUrl`, `server.listen`, and policy path.
4. Resolve exactly one pairing-code source.
5. Load and compose policy, including `extends`, interpolation, active profile, limits, and task bundle settings.
6. Create `stateDir` with private permissions.
7. Initialize pairing manager and persisted OAuth store.
8. Connect configured upstreams.
9. Build the HTTP server, OAuth server, registry, router, and audit log.

`server.mode` selects a built-in policy from `policies/read-only.yaml` or `policies/dev.yaml`. `server.policy` selects an explicit policy file. They cannot be used together.

## HTTP and OAuth surface

The HTTP server exposes:

- `GET /` for a small liveness response.
- `GET /health`.
- `/.well-known/oauth-authorization-server`.
- `/.well-known/oauth-protected-resource`.
- `POST /oauth/register`.
- `GET|POST /oauth/authorize`.
- `POST /oauth/token`.
- `POST /mcp`.
- `GET /manual-artifacts/:id?t=<token>`.

OAuth uses dynamic client registration, pairing-code authorization, authorization-code exchange, optional PKCE verification, bearer access tokens, and refresh-token storage. OAuth clients and access tokens are persisted in `stateDir/oauth-store.json`; authorization codes are short-lived and in memory.

The pairing code itself is loaded from config, env, or file into memory. Pairing failures are rate-limited by the configured attempt count and time window.

## MCP surface

`/mcp` accepts JSON-RPC over HTTP POST and requires a bearer token. It supports single requests and JSON-RPC batches.

Handled methods:

- `initialize`: returns MCP protocol version, tool capability, server info, and server instructions.
- `notifications/initialized`: returns an empty success result.
- `tools/list`: returns the current policy registry.
- `tools/call`: routes one tool call through the policy router.

Tool results that are not already MCP-shaped are wrapped as text content plus `structuredContent`.

## Registry and tool types

No upstream tool is exposed automatically. The registry is built from policy.

Policy tool types:

- `builtIn`: implemented by `webvibe`.
- `passThrough`: maps a public tool to a configured upstream tool.
- `workflow`: runs fixed policy-defined upstream steps.

Optional unavailable upstreams are skipped unless the policy supplies enough local schema information to expose an unavailable wrapper. Required unavailable upstreams fail startup.

## Router pipeline

Every public tool call goes through the same high-level pipeline:

1. Public tool name must be in the registry.
2. Per-client rate limit is checked.
3. A pending manual barrier may block the call.
4. `workspace.context` preflight may block the call.
5. Input is validated against the tool schema.
6. The call is wrapped with a timeout.
7. The router executes a built-in, pass-through upstream call, or workflow.
8. Host risk is attached when missing.
9. Output is validated against the output schema.
10. Output is redacted, truncated if needed, and wrapped with metadata.
11. An audit record is written.

Before `workspace.context`, only `workspace.context`, `diagnostics.health`, `manual.status`, and `manual.resume` are allowed. While a manual action is pending, only `diagnostics.health`, `manual.status`, and `manual.resume` are allowed.

## Built-ins

Built-in tools cover these groups:

- Workspace preflight and scanning: `workspace.context`, `workspace.scan`, `workspace.symbols`.
- Filesystem inspection: `fs.tree`, `fs.search`, `fs.read`, `fs.read_many`, `fs.stat`, `fs.manifest`.
- Workspace changes: `file.change_preview`, `file.change_apply`; custom policies may expose batch/alias change tools.
- Manual completion: `manual.prepare`, `manual.gate`, `manual.status`, `manual.resume`.
- Fixed tasks: `task.list`, `task.explain`, `task.run`, `task.result`.
- Git: `git.status`, `git.changed`, `git.diff`, `git.show`, `git.blame`, `git.commit_preview`, `git.commit`.
- Connector diagnostics: `diagnostics.health`.

The built-in `read-only` policy exposes inspection tools and `git.commit_preview`, but not apply, task execution, manual gate, or commit mutation. The built-in `dev` policy exposes the default write/task/manual/commit flow.

## Context and diagnostics

`workspace.context` is the coding preflight. It returns:

- tool surface version, hash, and current public tool list;
- active policy profile, policy hash, and effective limits;
- edit mode and batch availability;
- workspace mode, platform, architecture, container/CI/editor summaries;
- capabilities and host-constraint hints;
- project, Git, task, upstream, and warning summaries;
- recommended first calls.

It deliberately returns bounded and sanitized data. Environment values are limited to a small safe allowlist. Sensitive env keys are counted rather than revealed. PATH is categorized instead of returning raw directories. Command checks report availability and category without exposing executable paths.

`diagnostics.health` is for connector troubleshooting. It reports server version, policy hash, limits, tool surface hash, instruction hash, upstream health, and recent tool errors. It is not a replacement for `workspace.context`.

## Upstreams

Supported upstream transports:

- `stdio`: spawn a configured MCP server and speak JSON-RPC over stdin/stdout.
- `streamable-http`: POST JSON-RPC to a configured MCP endpoint.
- `local-task-runner`: run fixed policy-defined tasks.

The default `dev` policy uses `local-task-runner` for tasks. It accepts only known task IDs, resolves workspace-contained cwd values, checks executable/package-script/required-file availability, validates typed `extra` values, spawns with `shell: false`, captures bounded logs, and supports foreground or background mode.

## Workspace changes

Workspace mutation is centralized in changesets.

Preview validates paths, protected patterns, symlink ancestors, operation shapes, file hashes, file sizes, total size, and duplicate paths. It returns a diff, a `previewHash`, a `changeHash`, conflicts, warnings, artifacts, and risk metadata.

Apply requires a matching `previewHash`. It rebuilds the plan, refuses high host-risk plans before writing, skips conflicted plans, snapshots affected paths, applies changes, verifies results, and rolls back snapshots on failure.

Large diffs can be saved as tokenized manual artifacts. Artifact files and metadata are stored privately in `stateDir`; download URLs include a short-lived token.

## Manual completion state

Manual completion is a local barrier for steps ChatGPT Web blocks or cannot perform through the fixed tool surface.

The sequence is:

1. The assistant shows visible manual instructions in chat.
2. `manual.prepare` stores low-risk continuation metadata when possible.
3. `manual.gate` opens a pending barrier and tells the model to stop.
4. The user completes the step outside ChatGPT Web.
5. The next user message starts with `/resume`.
6. `manual.resume` confirms, cancels, expires, blocks, or fails verification.
7. Only confirmed resume allows the original workflow to continue.

The gate is not a hidden write path. It does not carry diffs, commands, source files, stdout, stderr, or logs in tool arguments.

## State and audit

Private server state lives under `server.stateDir`, including OAuth store, manual pending/prepared records, artifact data/metadata, and `audit.log`.

Workspace-local runtime logs live under `.webvibe/`, including task logs and suggested manual log paths.

Audit records are JSONL. Depending on policy, audit stores hashes only or full redacted payloads. Large payloads are summarized by byte count, sha256, head, and tail. Common bearer tokens, API keys, cloud secrets, private keys, and manual artifact tokens are redacted.

## Versioned surfaces

The project intentionally exposes versioned hashes to help with ChatGPT Web stale-tool behavior:

- tool surface version and hash;
- policy hash;
- instruction version and hash;
- preflight fingerprint;
- upstream health hash.

When tool descriptors, policy, or upstream availability change, start a fresh session or refresh connector tools before relying on prior model assumptions.
