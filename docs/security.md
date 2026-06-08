# Security

Security model:

- Default deny: upstream tools are hidden unless policy exposes them.
- Namespacing: public tool names are policy-chosen, not copied automatically.
- Protected paths: path fields are checked against workspace root and protected
  glob patterns.
- Narrow tasks: default dev tasks run only policy-defined executable/argument
  pairs through `local-task-runner`.
- Batch changes: default dev mode applies workspace edits through one
  `change.apply` call instead of exposing raw per-file write tools.
- Hash guards: update/delete changes require `expectedSha256`, and stale hashes
  fail without writing any file.
- Symlink guard: changeset writes reject symlink targets and symlink parents.
- Output limit: over-limit results are truncated and marked.
- Timeout: every public tool call is bounded by `limits.timeoutMs`.
- Rate limit: each client is bounded by `limits.maxCallsPerMinute`.
- Redaction: common bearer tokens, API keys, cloud secrets, and private keys are
  removed from output/audit material.
- Context preflight: `context.get` returns sanitized ENV/PATH categories,
  not raw secret values or raw PATH entries.
- Audit: in dev mode, audit is optimized for reproducibility and records
  redacted full inputs, raw tool outputs, client-visible outputs, manual gate
  events, host observations supplied by the model, widget confirmation events,
  and artifact downloads. Confirm tokens are never logged in plaintext. Audit
  logs rotate to `audit.log.1` at `audit.maxLogBytes`.

The relay intentionally does not expose raw arbitrary shell, command strings,
stdin, kill process, Git mutation tools, or raw filesystem write tools in
default policies. These defaults match ChatGPT Web's host-side safety model:
raw shell and patch-like surfaces are often blocked before local MCP code runs,
and file writes require confirmation that cannot be disabled like Codex.

## OAuth And Pairing

`webvibe` exposes:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/mcp`

`auth.pairingCode` is required in the config file, loaded into memory at startup,
and not persisted to `stateDir`. OAuth clients and tokens persist in
`stateDir/oauth-store.json`. Authorization codes are short-lived and in-memory.
Default access token TTL is 30 days.

## Narrow Local Tasks

`task.run` goes through `local-task-runner`, not a general process
control MCP server. This avoids broad capabilities commonly present in
desktop-commander style servers, including arbitrary command strings, process
control, wide file mutation, and session state. It also gives ChatGPT Web a
narrow named task call instead of a raw shell request. Policy must define each
task ID, executable, arguments, cwd, and timeout. A task call may pass a
workspace-relative cwd, which is checked against workspace and protected-path
rules before spawning. `context.get` reports available task IDs and argument
rules.

Some dependency tasks accept package/module names. Those are still not command
strings: policy must enable `allowExtraArgs`, set a maximum argument count, and
provide an allowlist or regular expression. Invalid arguments fail before a
process is spawned.

The default named tasks cover npm, Go, Rust, and Python only. The default policy
does not expose pnpm, bun, yarn, Poetry, JVM, .NET, Ruby, PHP, raw shell,
process control, `git push`, `git reset --hard`, or arbitrary checkout tools.

## Batch Changes

Default dev workspace edits go through:

- `change.plan`: validate and diff a complete proposed batch change without
  writing.
- `change.prepare`: validate the same complete batch change, create expiring
  relay-side prepared state, and optionally create generic review artifacts
  without writing workspace files.
- `change.apply`: apply the complete batch change in one write operation.

`replace`, `edit`, and `delete` require `expectedSha256`. Apply rejects conflicts
without partial writes. If an apply operation fails after writing starts, prior
paths are rolled back from snapshots. The confirmation point is the reviewed
batch change, not each individual file edit.

## Manual Completion Gate

The manual completion gate does not bypass ChatGPT Web safety checks. When
ChatGPT Web blocks a write action, `webvibe` does not retry the write, split the
write, encode the payload, or apply a prepared payload by id. Instead, the model
opens a generic widget that asks the user to complete the required step outside
ChatGPT and return to confirm. The same manual path is used when the best next
step requires unavailable arbitrary shell, an unavailable configured task, or
another tool capability limit. Confirmation records user intent, an optional
workspace-relative manual log file path, and optional post-completion checks; it
does not perform the blocked write.

Boundaries:

- `change.prepare` does not write workspace files.
- `manual.gate` does not write workspace files.
- `manual.confirm` does not write workspace files.
- `change.apply` remains the only default workspace write tool.
- There is no apply-by-id tool.
- Pending, prepared, and artifact state live in `stateDir` for UI, audit,
  troubleshooting, and expiry control.

`manual.confirm` is the authoritative transition from a pending manual action to
confirmed/cancelled/expired. It does not apply patches, delete files, run
commands, or mutate the workspace. It records that the user clicked the widget
after completing the manual step outside ChatGPT, stores an optional
workspace-relative manual log file path from the widget, optionally verifies
configured post-completion checks, writes an audit event, and lets the widget
ask ChatGPT to continue in a new turn.

`manual.confirm` exists because a widget button alone does not tell the local
relay what happened, `sendFollowUpMessage` alone creates no trusted server audit
transition, and a chat message saying "done" cannot be reliably correlated to a
specific `pendingId`, `preparedId`, host block, artifact, or widget session.
`manual.confirm` supplies correlation id, audit, expiry control, cancellation
control, and optional verification. It does not bypass ChatGPT Web safety
because it does not execute the blocked write.

If ChatGPT Web blocks a tool call before it reaches `/mcp`, the local relay
cannot log that blocked call directly. The model records the observed host
output by passing it to `manual.gate.hostObservation`.

The `manual.gate` tool result is intentionally lightweight. Long instructions,
artifact lists, and checks are not requested by the widget. ChatGPT Web shows
manual details in chat before opening the gate: commands include stdout/stderr
redirection to a workspace-relative log file, small prepared diffs are shown
inline, and large prepared diffs use the artifact download URL from
`change.prepare`. The widget only collects an optional workspace-relative log
file path, keeping ChatGPT Web widget hydration and widget-origin requests small
and avoiding leaking the confirm token into model-visible `structuredContent`.

In dev mode, audit is reproducibility-oriented. It records redacted full tool
inputs, raw tool outputs, client-visible outputs, manual gate lifecycle events,
artifact downloads, host observations supplied by the model, and widget
confirmation events. Confirm tokens are never logged in plaintext.
In dev mode, audit records redacted full tool inputs for troubleshooting.

## Context Preflight

`context.get` is read-only and intentionally lossy:

- ENV values are not returned except a small safe allowlist such as `CI`,
  `NODE_ENV`, `TERM`, and locale keys.
- Sensitive ENV keys matching token, secret, key, password, cookie, auth,
  credential, Kubernetes, Docker, and cloud-provider patterns are counted but
  their names and values are not returned.
- PATH is summarized by directory category such as `system`, `workspace`,
  `node-modules`, `nix-store`, `homebrew`, and `user-home`; raw directories are
  not returned.
- Container, devcontainer, CI, and editor detection returns confidence and
  sanitized evidence labels, not container IDs, pod names, hostnames, or user
  home paths.

This lets the model choose realistic tools without exposing local secrets or
high-cardinality machine identifiers.

## Git Commits

`git.commit` stages and commits only explicit workspace-relative paths.
It rejects protected paths, refuses empty commits, and uses `git commit --only`
so unrelated staged or unstaged files are not included. The default policy does
not expose `git push`, `reset --hard`, or arbitrary checkout.
