# Workflows

This document describes how ChatGPT Web should use the default `webvibe` tool surface.

## Host assumptions

ChatGPT Web can add host-side behavior before or after local MCP calls. A tool may be blocked before it reaches `webvibe`; the UI may ask for confirmation; results may be truncated by the host; and tool descriptors may remain stale until the connector is refreshed or a new chat starts.

`webvibe` handles these constraints by making the normal path narrow, reviewable, and recoverable:

- inspect before acting;
- prefer fixed task IDs over command text;
- preview before applying workspace changes;
- keep payloads small by default;
- use a visible manual flow when the host blocks a required action.

## Required preflight

Call `workspace.context` before workspace tools.

Recommended first calls:

```json tool=workspace.context
{}
```

```json tool=workspace.scan
{ "maxDepth": 6, "maxEntries": 2000 }
```

```json tool=fs.tree
{ "path": ".", "maxDepth": 3, "maxEntries": 500 }
```

```json tool=fs.read_many
{ "paths": ["README.md", "package.json"], "maxBytes": 60000 }
```

If a tool returns `CONTEXT_REQUIRED`, call `workspace.context` and then continue with the appropriate inspection tool. If context is stale because the policy, tool surface, or upstream health changed, refresh context before continuing.

Use `diagnostics.health` only for connector diagnostics. It is not the coding preflight.

## Inspecting a workspace

Use read-only tools first:

- `workspace.scan` for project manifests, language/tool detection, task files, and codegen clues.
- `workspace.symbols` for definitions and imports.
- `fs.tree` for directory shape.
- `fs.search` for text search.
- `fs.read` or `fs.read_many` for source files.
- `fs.stat` for metadata.
- `fs.manifest` for hashes before edits.

Read only the files needed for the current task. Prefer `fs.read_many` for a small set of known files, and use cursors or smaller `maxBytes` values for large files.

## Running tasks

Use this order:

1. `task.list`
2. `task.explain` when availability or routing is unclear
3. `task.run`
4. `task.result` for background tasks

`task.run` accepts only policy-defined task IDs. Candidate tasks discovered from package scripts, Go/Rust/Flutter projects, frontend configs, codegen configs, Makefiles, justfiles, or Taskfiles are informational until policy maps them to fixed task IDs.

A task can be unavailable because an executable is missing, a package script is absent, a required file is missing, or cwd cannot be resolved inside the workspace. Unavailable tasks should not be retried as arbitrary command text. Use the manual flow when the task is required and no fixed task can run it.

Dependency-style tasks may accept typed `extra` values such as `packages`, `modules`, and `dev`. They do not accept raw `extraArgs`. Policy controls count, allowlist, and regex validation before any process is spawned.

For long-running work, use task background mode when the task contract supports it, then poll with `task.result`.

## Changing files

Default `dev` mode exposes a single-logical-change workflow:

1. Inspect the target file and gather its current hash.
2. Call `file.change_preview`.
3. Review conflicts, warnings, diff, `hostRisk`, and `previewHash`.
4. Call `file.change_apply` only with a matching `previewHash`.
5. Verify with `fs.stat`, `fs.read`, `fs.manifest`, `git.diff`, or a fixed task.

Supported changeset operations include:

- `create`
- `write`
- `replace`
- `edit`
- `text_edit`
- `json_patch`
- `unified_diff`
- `delete`
- `rename`
- `mkdir`

`replace`, `edit`, `text_edit`, `json_patch`, `unified_diff`, `delete`, and `rename` require `expectedSha256`. `create` and `write` fail when the path already exists. `mkdir` creates a directory or no-ops when the directory already exists.

Direct apply is blocked when the preview is high host-risk, for example when the diff is too large to inline or the delete count crosses the manual-first threshold. In that case, follow the returned `manualPlan`.

Batch change tools and compatibility aliases exist for custom policies, but the built-in `dev` policy does not expose them. Use batch tools only when `workspace.context` reports batch edit mode and the tools are present.

## Git workflow

Use Git tools for inspection and explicit-path commits:

1. `git.status`
2. `git.changed`
3. `git.diff`
4. `git.commit_preview`
5. `git.commit`

`git.commit_preview` stages the requested paths in a temporary index and returns a `previewHash`. `git.commit` requires that hash, stages only the explicit workspace-relative paths, refuses empty commits, and commits with `git commit --only`.

The default policy does not expose push, reset-hard, arbitrary checkout, or broad Git mutation tools.

## Manual completion

Use manual completion when:

- ChatGPT Web blocks a required tool call twice with the same safety text;
- ChatGPT Web reports a capability limit;
- a required step is outside the fixed tool surface;
- a required task has no available fixed task ID;
- a change preview returns a high-risk `manualPlan`.

The safe manual sequence is:

1. Show clear manual instructions in the ChatGPT message.
2. Call `manual.prepare` when available, using only low-risk continuation metadata.
3. Call `manual.gate` with minimal proof fields.
4. Stop the assistant turn immediately.
5. Wait for the next user message to start with `/resume`.
6. Call `manual.resume` with the exact user message.
7. Continue only when the status is `confirmed`.

Do not put commands, scripts, diffs, file contents, stdout, stderr, or logs inside `manual.prepare` or `manual.gate` arguments. The instructions are visible chat content, not hidden tool payload.

Valid resume forms include:

```text
/resume <operationId>
/resume <operationId> .webvibe/manual-logs/<log-file>.log
/resume cancel <operationId>
```

`/resume` is a control signal, not a new user request. After confirmed resume, verify the workspace state before continuing the original interrupted request.

## Host block handling

When ChatGPT Web asks for secondary confirmation, retry the identical tool call once with the identical tool name and JSON arguments.

When ChatGPT Web returns the exact OpenAI safety-check block text, retry the identical tool call once with the identical tool name and JSON arguments. If the retry is blocked again, use manual completion.

When `manual.gate` itself is blocked by the same safety text, retry `manual.gate` once with identical arguments. If it is still blocked, stop and wait for human completion followed by `/resume`.

Do not work around host review by splitting a blocked action into hidden smaller writes, encoding payloads, renaming suspicious content, hiding commands in metadata, or applying a prepared payload by id.

## Common blocked states

`CONTEXT_REQUIRED` means the session has not completed a valid `workspace.context` preflight or the preflight became stale.

`MANUAL_PENDING_REQUIRED` means a manual action is still open for this ChatGPT session. Call `manual.status` or `manual.resume`; do not continue workspace tools until the pending action is confirmed, cancelled, expired, or otherwise resolved.

`previewHash mismatch` means the apply input no longer matches the reviewed preview. Preview again.

`unavailable` task results mean the configured fixed task cannot currently run. Use `task.explain`; then either choose another fixed task or use manual completion.

`HIGH_HOST_RISK` on a change preview means direct apply should not be used. Follow the returned manual route.
