# Security

Security model:

- Default deny: upstream tools are hidden unless policy exposes them.
- Namespacing: public tool names are policy-chosen, not copied automatically.
- Protected paths: path fields are checked against workspace root and protected
  glob patterns.
- Narrow tasks: default dev tasks run only policy-defined executable/argument
  pairs through `local-task-runner`.
- Bounded changes: default dev mode applies workspace edits through reviewed
  change tools instead of exposing raw per-file write tools.
- Hash guards: update/delete changes require `expectedSha256`, and stale hashes
  fail without writing any file.
- Symlink guard: changeset writes reject symlink targets and symlink parents.
- Output limit: over-limit results are truncated and marked.
- Timeout: every public tool call is bounded by `limits.timeoutMs`.
- Rate limit: each client is bounded by `limits.maxCallsPerMinute`.
- Redaction: common bearer tokens, API keys, cloud secrets, and private keys are
  removed from output/audit material.
- HTTP body limits: OAuth and MCP request bodies are capped by policy and return
  `REQUEST_BODY_TOO_LARGE` with HTTP 413 when exceeded.
- Context preflight: `workspace.context` returns sanitized ENV/PATH categories,
  not raw secret values or raw PATH entries.
- Audit: in dev mode, audit is optimized for reproducibility and records
  redacted full inputs, raw tool outputs, client-visible outputs, manual gate
  events, host observations supplied by the model, manual resume events, and
  artifact downloads. Large audit payloads are reduced to size, sha256, head,
  and tail after redaction. Download tokens are never logged in plaintext.
  Audit logs rotate to `audit.log.1` at `audit.maxLogBytes`.

The relay intentionally does not expose free-form process execution, command
strings, stdin, kill process, broad Git mutation tools, or raw filesystem write
tools in default policies. These defaults match the observed host-side
constraints in [ChatGPT Web Constraint Adaptation](chatgpt-web-known-limits.md):
use narrow, reviewable tool shapes and recover through manual completion when
needed.

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
Default access token TTL is 30 days. Pairing-code failures are rate-limited by
`auth.pairingFailures.maxAttempts` and `auth.pairingFailures.windowSeconds`.

## Narrow Local Tasks

`task.run` goes through `local-task-runner`, not a general process
control MCP server. This avoids broad capabilities commonly present in
desktop-commander style servers, including arbitrary command strings, process
control, wide file mutation, and session state. It also gives ChatGPT Web a
narrow named task call instead of free-form command text. Policy must define each
task ID, executable, arguments, cwd, and timeout. A task call may pass a
workspace-relative cwd, which is checked against workspace and protected-path
rules before spawning. `workspace.context` reports task counts and task ID
summaries; `task.list` reports full availability, checks, and argument rules.

Some dependency tasks accept package/module names. Those are still not command
strings: policy must enable `allowExtraArgs`, set a maximum argument count, and
provide an allowlist or regular expression. Invalid arguments fail before a
process is spawned.

The default runnable task IDs cover Node/npm, Go, Rust, and Python. Node script
tasks require matching package scripts before they are considered available, so
missing scripts do not become successful no-op runs. The context
preflight may report additional non-runnable candidates for pnpm/yarn/bun
scripts, Dart/Flutter, frontend configs, codegen configs, and project task
files, but those candidates do not become executable unless policy maps them to
a fixed task ID. The default policy does not expose Poetry, JVM, .NET, Ruby,
PHP, free-form process execution, process control, `git push`, `git reset --hard`, or arbitrary
checkout tools.

## Workspace Changes

Default dev workspace edits go through:

- `file.change_preview`: validate and diff one logical workspace file change without
  writing. Oversized diffs are saved as tokenized artifacts.
- `file.change_apply`: apply the reviewed logical file change in one write operation after
  matching `previewHash`.

`replace`, `edit`, and `delete` require `expectedSha256`. Apply rejects conflicts
without partial writes. If an apply operation fails after writing starts, prior
paths are rolled back from snapshots. The default edit mode prefers one logical
file operation per reviewed change; batch edit mode is an explicit policy
choice for multi-file payloads.

Every tool result carries `hostRisk`. Change preview computes payload, path,
delete, and diff risk. Oversized diffs and delete-heavy changes return
`hostRisk: "high"` with a `manualPlan`, and apply refuses those plans before
writing so manual-first routing is enforced locally.

## Manual Completion Gate

The manual completion gate is a recovery protocol, not a hidden write path. When
ChatGPT Web blocks a write action with the exact OpenAI safety-check text, the
model retries the same tool call once with the identical tool name and JSON
arguments. If that identical retry is blocked again, `webvibe` does not split
the write, encode the payload, rewrite the payload, or apply a prepared payload
by id. Instead, the model shows exact manual instructions in chat and opens a
local manual barrier with minimal `manual.gate` arguments only. The user
completes the required step outside ChatGPT and must start the next message with
`/resume`. The same manual path is used when the best next step requires
an unavailable configured task or another tool capability limit. `manual.prepare`
can store low-risk continuation metadata before `manual.gate`, so `/resume` can
recover even if the gate itself is blocked by the host. `manual.resume` records
user intent, validates any supplied workspace-relative manual log file path,
stores bounded size/sha256/head/tail evidence, and verifies optional
post-completion checks; it does not perform the blocked write.
Manual command text, scripts, stdout/stderr, diffs, file contents, and log
contents are not sent through `manual.gate`. They stay in ChatGPT Web chat or in
the user's local workspace log file, while the gate receives only a low-risk
summary of why manual completion is required.

Because ChatGPT Web cannot reliably be forced into a pending UI state, webvibe
adapts by blocking local tools while manual work is pending and requiring
`/resume` through `manual.resume` before tools continue. See
[ChatGPT Web Constraint Adaptation](chatgpt-web-known-limits.md).

Boundaries:

- `file.change_preview` does not write workspace files.
- `manual.gate` does not write workspace files.
- `manual.resume` does not write workspace files.
- `file.change_apply` remains the only default workspace write tool.
- There is no apply-by-id tool.
- Pending, prepared manual-action state, and artifact state live in `stateDir`
  for audit, troubleshooting, and expiry control.

While a manual action is pending, the relay blocks follow-up tools with
`MANUAL_PENDING_REQUIRED` except `diagnostics.health`, `manual.status`, and `manual.resume`. This
is a local barrier, not a ChatGPT Web host hard-pending protocol. If the host
does not call MCP tools, the relay cannot intercept ordinary assistant text.
The model must stop the assistant turn after `manual.gate`, even if other work
remains.

`manual.resume` is the authoritative transition from a pending manual action to
confirmed/cancelled/expired. It applies `trimStart()` to the model-supplied next
user message, requires exact lowercase `/resume` as the first command token,
accepts `/resume <operationId> [workspace-log-path]` and `/resume cancel
<operationId>`, validates any supplied log file exists, and verifies configured
post-completion checks. `/resume` is a control signal, not a new task. Only
`confirmed` resumes the original interrupted request; cancelled, expired,
not_found, and verification_failed do not continue it.

If ChatGPT Web blocks a tool call before it reaches `/mcp`, the local relay
cannot log that blocked call directly. The model first retries the same tool
once with unchanged arguments for the exact OpenAI safety-check text. If the
retry is blocked again, the model records the observed host output by passing it
to `manual.gate.hostObservation`.

The `manual.gate` tool result is intentionally lightweight. ChatGPT Web shows
manual details in chat before opening the gate: commands include stdout/stderr
redirection to a workspace-relative manual log file, small preview diffs are
shown inline, and large preview diffs use the tokenized artifact download URL
from `file.change_preview`. Detailed manual instructions are not passed as
`manual.gate` arguments. The gate accepts only `WEBVIBE_MANUAL_REQUIRED v1`
proof fields, operation metadata, reason, and low-risk host observation. If
ChatGPT Web blocks `manual.gate` itself, the model retries the same
`manual.gate` call once with identical arguments. If it is still blocked, the
model must stop and wait for human completion followed by `/resume`.

In dev mode, audit is reproducibility-oriented. It records redacted full tool
inputs, raw tool outputs, client-visible outputs, manual gate lifecycle events,
artifact downloads, host observations supplied by the model, and manual resume
events. Large payload fields are summarized after redaction instead of being
written wholesale. Download tokens are never logged in plaintext.

## Context Preflight

`workspace.context` is read-only and intentionally lossy:

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
- Project and task details are summarized; full manifests, scripts, candidates,
  and resolver checks are returned by `workspace.scan` and `task.list`.

This lets the model choose realistic tools without exposing local secrets or
high-cardinality machine identifiers.

## Git Commits

`git.commit` stages and commits only explicit workspace-relative paths.
It rejects protected paths, refuses empty commits, and uses `git commit --only`
so unrelated staged or unstaged files are not included. The default policy does
not expose `git push`, `reset --hard`, or arbitrary checkout.
