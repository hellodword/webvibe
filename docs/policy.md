# Policy

Policy is the source of upstream server and public tool knowledge. Source code
does not publish upstream tools automatically.

Runtime configuration selects policy in one of two ways:

```text
server.mode   -> built-in policy from policies/read-only.yaml or policies/dev.yaml
server.policy -> explicit policy file
```

`server.mode` and `server.policy` are mutually exclusive. Policy files can use
`extends` to merge a base policy.

Important fields:

- `upstreams`: named MCP servers using `stdio`, `streamable-http`, or the
  built-in `local-task-runner`.
- `tools`: ChatGPT-facing tools. Types are `builtIn`, `passThrough`, and
  `workflow`.
- `workspace.protected`: generic path deny patterns.
- `limits`: output, HTTP body, tree/search/read/change/task/manual, and rate
  limits.
- `taskBundles`: controls which discovered project task families are reported as
  candidates.
- `audit`: JSONL audit logging switch and rotation size.

## Default Tool Surface

The built-in ChatGPT Web tool surface is intentionally compact:

- `workspace.context`
- `workspace.scan`
- `workspace.symbols`
- `fs.tree`
- `fs.search`
- `fs.read`
- `fs.read_many`
- `fs.stat`
- `fs.manifest`
- `change.preview` in dev mode
- `manual.gate` in dev mode
- `manual.resume` in dev mode
- `change.apply` in dev mode
- `task.list` in dev mode
- `task.run` in dev mode
- `task.result` in dev mode
- `git.status`
- `git.changed`
- `git.diff`
- `git.show`
- `git.blame`
- `git.commit_preview`
- `git.commit` in dev mode
- `diagnostics.health`

`workspace.context` is the first tool for coding work. It returns project manifests,
task availability, upstream health, tool surface version, warnings, and the
recommended workflow. All workspace tools except `diagnostics.health` require a
successful `workspace.context` call for the same caller and current tool surface.

If a workspace tool is called too early, webvibe returns a normal blocked tool
result with `code: "CONTEXT_REQUIRED"` and `nextTool: "workspace.context"`.

## Reading

`fs.*` tools are relay built-ins. The default policies do not expose raw
filesystem pass-through tools. This keeps path protection, output truncation,
and result shape under webvibe control. Host-side output truncation is still
possible; see [ChatGPT Web Known Limits](chatgpt-web-known-limits.md).

`fs.read` and `fs.read_many` read bounded UTF-8 byte chunks. Results include
continuation metadata before `content`: `offsetBytes`, `returnedBytes`,
optional `nextOffsetBytes`, and `truncated`. When `truncated` is true, call
`fs.read` again with `byteOffset` set to `nextOffsetBytes`. UTF-8 characters are
not split across chunk boundaries.

## Batch Changes

Default dev mode exposes one read-only preview tool and one write tool:

- `change.preview`: validate a complete batch change, detect conflicts, return
  a bounded diff, and save oversized diffs as artifacts without writing.
- `change.apply`: apply the complete user-requested file change in one write
  call after matching `previewHash`.

This matches ChatGPT Web's confirmation model. File operations require user
confirmation, so the default policy puts confirmation at one batch change
boundary instead of repeated per-file writes. Known confirmation limitations are
tracked in [ChatGPT Web Known Limits](chatgpt-web-known-limits.md).

Batch change limits default to policy `limits.change` values. Mutating
operations require `expectedSha256` where appropriate so stale model plans do
not overwrite newer workspace edits.

If ChatGPT Web blocks the write with the exact OpenAI
safety-check text, the model retries the same tool once with unchanged
arguments. If the identical retry is blocked again, the model shows manual
instructions in chat, calls `manual.gate` with `WEBVIBE_MANUAL_REQUIRED v1`
proof fields, stops the
assistant turn immediately, and waits for a later user message that starts with
`/resume`. Detailed manual instructions stay in the chat text, not in the
`manual.gate` call. While pending, webvibe blocks workspace tools except
`diagnostics.health` and `manual.resume`. `manual.resume` validates the
`/resume` command, accepts an optional workspace-relative manual log file path,
and verifies configured checks before the model continues the original
interrupted request.

## Tasks

`task.run` runs one policy-defined task by `taskId`. It does not accept
arbitrary shell commands or stdin. Callers may pass a workspace-relative `cwd`
to run a fixed task in a nested package or module. Available task IDs, timeout
defaults, cwd support, extra argument rules, and unavailable reasons are
returned by `workspace.context`.

The default dev policy configures npm, Go, Rust, and Python tasks through
`local-task-runner`. Task availability changes do not change the public tool
list, so ChatGPT Web does not need a manual tool refresh when a command is
missing.

`taskBundles` controls candidate discovery. `workspace.context` and `task.list`
report candidates from package scripts, Go and Rust manifests, Dart/Flutter
`pubspec.yaml`, frontend test/lint/typecheck configs, Prisma/Drizzle/buf/sqlc/
OpenAPI configs, and Make/just/Taskfile targets. Candidates are not arbitrary
shell execution: they are reported as fixed argv shapes, and `task.run` can only
run a candidate when there is a matching policy-defined task ID. Make/just/task
targets are listed by default but remain non-runnable unless policy explicitly
allows a target.

Task results store stdout/stderr in `.webvibe/task-logs/` and return bounded
head/tail/sha256/log-path summaries plus parsed diagnostics for common
TypeScript, ESLint, Vitest/Jest, Go, Rust, and Dart output.

If a required command has no matching task ID or needs arbitrary shell/Node,
the model must use the manual fallback flow instead of ending with an inability
statement. Manual commands and stdout/stderr are shown in chat and written by
the user's terminal to a workspace-relative log path. They are not sent through
`manual.gate`; the gate receives only `manualFormatVersion`,
`manualMessageHash`, `operation`, `reason`, and a low-risk `hostObservation`
summary.

## Git

Read-only Git tools are `git.status`, `git.changed`, `git.diff`, `git.show`,
and `git.blame`. `git.commit` is the only default Git mutation tool. It requires
explicit `paths` and `message`, rejects protected paths, refuses empty commits,
and commits only the named pathspecs so unrelated dirty files are not included.

## Diagnostics

`diagnostics.health` is for connector diagnostics, not coding preflight. It
returns relay mode, server version, active profile, policy hash, effective
limits, tool surface version/hash, instruction version/hash, upstream health,
and recent tool error summaries.

## Stable Tool Registration

Default policies avoid environment-dependent hiding for the public tool list.
Because ChatGPT Web tool refresh can leave the model reasoning over stale tools,
webvibe keeps the list stable and uses structured `unavailable` and
`CONTEXT_REQUIRED` results instead. Tool surface renames are hard cuts; users
must refresh connector tools in ChatGPT Web. See
[ChatGPT Web Known Limits](chatgpt-web-known-limits.md).
