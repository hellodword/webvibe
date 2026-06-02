# Security

Security model:

- Default deny: upstream tools are hidden unless policy exposes them.
- Namespacing: public tool names are policy-chosen, not copied automatically.
- Protected paths: path fields are checked against workspace root and protected
  glob patterns.
- Narrow tasks: default dev tasks run only policy-defined executable/argument
  pairs through `local-task-runner`.
- Batch changesets: default dev mode applies workspace edits through one
  `repo.apply_changeset` call instead of exposing raw per-file write tools.
- Hash guards: update/delete changes require `expectedSha256`, and stale hashes
  fail without writing any file.
- Symlink guard: changeset writes reject symlink targets and symlink parents.
- Output limit: over-limit results are truncated and marked.
- Timeout: every public tool call is bounded by `limits.timeoutMs`.
- Rate limit: each client is bounded by `limits.maxCallsPerMinute`.
- Redaction: common bearer tokens, API keys, cloud secrets, and private keys are
  removed from output/audit material.
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

Default dev task tools go through `local-task-runner`, not a general process
control MCP server. This avoids broad capabilities commonly present in
desktop-commander style servers, including arbitrary command strings, process
control, wide file mutation, and session state. It also gives ChatGPT Web a
narrow named task call instead of a raw shell request. Policy must define each
task ID, executable, arguments, cwd, required files, script requirements, and
timeout.

## Batch Changesets

Default dev workspace edits go through:

- `repo.file_manifest`: read file existence, type, size, hash, and mtime.
- `repo.preview_changeset`: validate and diff a proposed changeset without
  writing.
- `repo.apply_changeset`: apply the complete changeset in one operation.

`replace`, `edit`, and `delete` require `expectedSha256`. Apply rejects conflicts
without partial writes. If an apply operation fails after writing starts, prior
paths are rolled back from snapshots. The confirmation point is the reviewed
changeset, not each individual file edit.
