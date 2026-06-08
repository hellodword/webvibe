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
- `limits`: output byte limit, tool-call timeout, per-client call rate, and
  batch change size limits.
- `audit`: JSONL audit logging switch and rotation size.

## Default Tool Surface

The built-in ChatGPT Web tool surface is intentionally compact:

- `context.get`
- `read.tree`
- `read.search`
- `read.files`
- `read.stat`
- `change.plan` in dev mode
- `change.prepare` in dev mode
- `manual.gate` in dev mode
- `manual.resume` in dev mode
- `change.apply` in dev mode
- `task.run` in dev mode
- `git.status`
- `git.diff`
- `git.history`
- `git.show`
- `git.commit` in dev mode
- `diagnostics.health`

`context.get` is the first tool for coding work. It returns project manifests,
task availability, upstream health, tool surface version, warnings, and the
recommended workflow. All workspace tools except `diagnostics.health` require a
successful `context.get` call for the same caller and current tool surface.

If a workspace tool is called too early, webvibe returns a normal blocked tool
result with `code: "CONTEXT_REQUIRED"` and `nextTool: "context.get"`.

## Reading

`read.*` tools are relay built-ins. The default policies do not expose raw
filesystem pass-through tools. This keeps path protection, output truncation,
and result shape under webvibe control.

## Batch Changes

Default dev mode exposes one read-only planning tool and one write tool:

- `change.plan`: validate a complete batch change, detect conflicts, and return
  a diff without writing.
- `change.prepare`: validate the same complete batch change, save expiring
  review state, and create manual fallback material without writing.
- `change.apply`: apply the complete user-requested file change in one write
  call.

This matches ChatGPT Web's confirmation model. File operations require user
confirmation, so the default policy puts confirmation at one batch change
boundary instead of repeated per-file writes.

Batch change limits default to 80 paths, 5 MiB per change, and 1 MiB per file.
Update/delete operations require `expectedSha256` so stale model plans do not
overwrite newer workspace edits.

If ChatGPT Web blocks the write after `change.prepare`, the model calls
`manual.gate` with minimal arguments, stops the assistant turn immediately, and
waits for a later user message that starts with `/resume`. Detailed manual
instructions stay in the chat text, not in the `manual.gate` call. While
pending, webvibe blocks workspace tools except `diagnostics.health` and
`manual.resume`. `manual.resume` validates the `/resume` command, accepts an
optional workspace-relative manual log file path, and verifies configured checks
before the model continues the original interrupted request.

## Tasks

`task.run` runs one policy-defined task by `taskId`. It does not accept
arbitrary shell commands or stdin. Callers may pass a workspace-relative `cwd`
to run a fixed task in a nested package or module. Available task IDs, timeout
defaults, cwd support, extra argument rules, and unavailable reasons are
returned by `context.get`.

The default dev policy configures npm, Go, Rust, and Python tasks through
`local-task-runner`. Task availability changes do not change the public tool
list, so ChatGPT Web does not need a manual tool refresh when a command is
missing. Project manifests and package scripts are environment facts reported by
`context.get`; they do not gate task availability.

## Git

Read-only Git tools are `git.status`, `git.diff`, `git.history`, and
`git.show`. `git.commit` is the only default Git mutation tool. It requires
explicit `paths` and `message`, rejects protected paths, refuses empty commits,
and commits only the named pathspecs so unrelated dirty files are not included.

## Diagnostics

`diagnostics.health` is for connector diagnostics, not coding preflight. It
returns relay mode, tool surface version, policy/tool hashes, and upstream
health.

## Stable Tool Registration

Default policies avoid environment-dependent hiding for the public tool list.
ChatGPT Web refreshes MCP tools manually, so dynamic registration can leave the
model reasoning over stale tools. webvibe keeps the list stable and uses
structured `unavailable` and `CONTEXT_REQUIRED` results instead. Tool surface
renames are hard cuts; users must refresh connector tools in ChatGPT Web.
