# Architecture

`webvibe` is a ChatGPT-facing MCP relay. It is not an agent runtime.

Traffic shape:

```text
ChatGPT Web -> webvibe OAuth/MCP -> policy registry -> upstream MCP servers or built-ins
```

The relay owns:

- OAuth registration, authorization, pairing, access tokens, and MCP HTTP
  handling.
- Policy loading, interpolation, default mode selection, and policy allowlists.
- Tool descriptor normalization for ChatGPT-facing MCP clients.
- Tool call routing, timeout, rate limit, output truncation, redaction, and
  audit logging.
- Built-in environment, project, code, and Git inspection tools.
- Built-in bounded workspace changeset tools.
- Stdio, streamable HTTP, and local task runner upstream clients.

Default server commands and task commands live in `policies/*.yaml`, not `src/`.
Source code knows transports, routing, policies, workflows, task execution, and
workspace changeset semantics.

## Why Not Fork Codex

The root constraint is ChatGPT Web, not local code. This project exists to make
ChatGPT Web usable for vibecoding, but ChatGPT Web is not Codex. It has OpenAI
host-side safety review and UI confirmation in front of MCP calls. Those
black-box limits are described in
[ChatGPT Web Constraint Adaptation](chatgpt-web-known-limits.md). webvibe
treats them as constraints to adapt to, not as a local-runtime problem to solve.

Codex owns model runtime behavior, shell semantics, sandboxing, approval flow,
patch application, and command execution. Forking or imitating Codex would not
remove ChatGPT Web's host-side safety gates or confirmation model.

`webvibe` keeps a smaller boundary:

```text
stable ChatGPT OAuth/MCP surface
policy allowlist
external upstream tools
sanitized environment inspection
bounded workspace apply
fixed local tasks
```

## Upstreams

Supported upstream transports:

- `stdio`: spawn a configured MCP server and speak JSON-RPC over stdin/stdout.
- `streamable-http`: POST JSON-RPC to a remote MCP endpoint.
- `local-task-runner`: run fixed policy-defined tasks without exposing a general
  command tool.

No upstream tool is exposed automatically. Every public tool must be listed in
policy. Optional unavailable upstreams are skipped, and required unavailable
upstreams fail startup.

## Environment Awareness

`workspace.context` is the ChatGPT Web coding preflight. It returns the short
facts a coding model needs before tool use: tool surface, policy/workspace
summary, edit mode, host constraints, upstream health, project/task summaries,
and next routes. Full project details are returned by `workspace.scan`.

`task.list` reports task candidates from project shape: package scripts, Go/Rust
manifests, Dart/Flutter manifests, frontend and codegen config files, and
Make/just/Taskfile targets. Candidate reporting is separate from execution;
`task.run` still accepts only policy-defined task IDs.

The module deliberately returns categorized and bounded data. ENV values are
redacted except a small safe allowlist, PATH entries are categories rather than
raw directories, and container/editor detection returns sanitized evidence labels
instead of hostnames, user paths, container IDs, or pod names.

## Stable Tool Registration

ChatGPT Web tool refresh is host-controlled and may leave the model reasoning
over stale descriptors; see
[ChatGPT Web Constraint Adaptation](chatgpt-web-known-limits.md).
Default webvibe policies keep the public tool list stable and gate execution
inside tools. If a task executable such as `cargo`, `make`, or `pip` is missing,
the named task returns `status: "unavailable"` with `unavailableReason`. Project
manifests and package scripts are reported by `workspace.scan` and `task.list`;
they do not hide or disable task IDs. The public task tools remain `task.list`,
`task.run`, and `task.result`.

## Why Local Task Runner

The default dev policy intentionally does not use a broad desktop/server control
surface such as `wonderwhy-er/desktop-commander` for command execution. That
style of upstream exposes command/process surfaces that map poorly to observed
ChatGPT Web host limits.

`local-task-runner` exposes one narrow tool, `run_task`, and only executes task
IDs defined by policy. Each task has fixed executable/arguments, bounded
timeout, resolver checks, and a workspace-contained cwd. Node script tasks
declare required package scripts so missing scripts are unavailable instead of
empty successful runs. The caller may pass a workspace-relative cwd for
monorepos. The model asks for a named task instead of sending free-form command
text.

For package/module installation tasks, policy may allow typed `extra` objects.
Those values are validated by count and allowlist or regex before spawning; they
are appended to fixed executable/argument pairs and are never interpreted as a
shell command.

## Why Bounded Workspace Apply

Default dev mode uses reviewed change tools instead of raw filesystem write/edit
tools. Because ChatGPT Web confirmation prompts cannot be reliably disabled,
the configured edit mode controls the write boundary: `single` prefers one
logical file operation, while opt-in batch mode can group multi-file payloads
when the user accepts that tradeoff.

Tool results carry `hostRisk` so the model can distinguish low-risk inspection,
medium-risk fixed writes/tasks, and high-risk manual-first cases. Change preview
computes payload/delete/diff risk and returns a `manualPlan` for oversized diffs
or delete-heavy changes. Apply blocks those high-risk plans before writing.

Change tools also give the relay one place to enforce hash guards, protected
paths, symlink guards, UTF-8 checks, size limits, and rollback.

## Runtime State

Workspace-local runtime files live under `.webvibe/`, including task logs and
manual logs. Server-private state such as OAuth tokens, pending manual actions,
prepared manual metadata, artifact metadata, and audit logs lives in `stateDir`.
Large task output stays in `.webvibe/task-logs/`; audit records store redacted
payloads and summarize large fields by size, hash, head, and tail.
