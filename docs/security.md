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
- Audit: every `tools/call` writes JSONL with hashes and sizes, not raw inputs.
  Audit logs rotate to `audit.log.1` at `audit.maxLogBytes`.

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
- `change.apply`: apply the complete batch change in one write operation.

`replace`, `edit`, and `delete` require `expectedSha256`. Apply rejects conflicts
without partial writes. If an apply operation fails after writing starts, prior
paths are rolled back from snapshots. The confirmation point is the reviewed
batch change, not each individual file edit.

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
