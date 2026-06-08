# ChatGPT Web Workflow

ChatGPT Web coding starts with `context.get`.

Recommended order:

1. `context.get`
2. `read.tree` / `read.search` / `read.files` / `read.stat`
3. `change.plan` when preview is useful
4. `change.prepare` before any `change.apply`
5. `change.apply` as one complete batch write
6. If ChatGPT Web asks for secondary confirmation: retry the identical `change.apply` once
7. If ChatGPT Web blocks with OpenAI safety checks: stop write tools and call `manual.gate` with the latest `preparedId`
8. If the best next step requires unavailable arbitrary shell or an unavailable task: call `manual.gate` with concrete external instructions
9. Widget waits for the user to complete the manual step outside ChatGPT and paste a workspace-relative log file path
10. Widget calls `manual.confirm`
11. Widget calls `sendFollowUpMessage`
12. Model verifies with `git.status` / `git.diff` / `read.stat` / `task.run`
13. `git.commit` only when explicitly requested or appropriate

`webvibe` does not suspend an in-flight JSON-RPC `tools/call`. The manual gate
is a completed tool result with a widget. Continuation starts when the widget
calls `manual.confirm` and then `sendFollowUpMessage` creates a new ChatGPT
turn.

`manual.confirm` is the authoritative transition from a pending manual action
to confirmed/cancelled/expired. It does not apply patches, delete files, run
commands, or mutate the workspace. It records that the user clicked the widget
after completing the manual step outside ChatGPT, optionally verifies configured
post-completion checks, writes an audit event, and lets the widget ask ChatGPT
to continue in a new turn.

Manual continuation sequence:

1. `manual.gate` returns an `awaiting_manual_completion` tool result.
2. ChatGPT renders the widget.
3. User completes the required manual work outside ChatGPT.
4. User clicks "I completed this manually" in the widget.
5. Widget calls `manual.confirm` with `pendingId`, component-only confirm token, and optional `manualLogPath`.
6. `manual.confirm` records confirmed/cancelled/expired, stores the log path, and returns the result to the widget.
7. Widget calls `sendFollowUpMessage` so ChatGPT starts a new continuation turn.
8. Model verifies current state with normal read/git/task tools.

Host output decision table:

| observed output | classification | local relay likely saw the blocked call? | required next action | retry limit | manual gate behavior | audit behavior |
| --- | --- | ---: | --- | ---: | --- | --- |
| normal structured result such as `applied: true` | `normal_tool_result` | yes | continue normal workflow | 0 | none | normal tool audit |
| `CONTEXT_REQUIRED` | `relay_policy_block` | yes | call `context.get` | 0 | none | blocked audit from relay |
| `requires confirmation` / `please confirm` / `click allow` | `secondary_confirmation_required` | maybe no | retry same tool once with identical name and identical JSON arguments | 1 | none unless retry becomes safety block | local relay may not see first attempt |
| exact `This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.` | `blocked_by_openai_safety` | usually no | stop write tools; call `manual.gate` with latest `preparedId` | 0 | generic manual completion widget | `manual.gate.hostObservation` records observed block |
| `受工具限制` / `cannot run arbitrary shell` / `task unavailable` / `tool unavailable` | `manual_required_capability_limit` | yes or model-observed | stop explaining limitation; show manual command/log details in chat, then call `manual.gate` with external instructions | 0 | generic manual completion widget with log path input | `manual.gate.hostObservation` records observed limit |
| widget button clicked completed | `manual_completion_confirmed` | yes | widget calls `manual.confirm`, then sends follow-up | 0 | pending record transitions to confirmed | `manual.confirm` audit event |
| widget button clicked cancelled | `manual_completion_cancelled` | yes | widget calls `manual.confirm` with `cancelled`, then sends follow-up | 0 | pending record transitions to cancelled | `manual.confirm` audit event |

Do not split a blocked write into additional write calls.
Do not encode, obfuscate, rename, or hide payloads.
Do not use a `preparedId` as a hidden write mechanism.
Do not implement or call apply-by-id tools.
Do not treat `manual.gate` as proof that the user completed the work.
Do not continue until `manual.confirm` reports confirmed.

The widget is intentionally tiny. It does not render operation-specific
instructions, artifacts, checks, output formats, evidence notes, or detail
records, and it does not fetch `/manual-gates/:pendingId`. ChatGPT Web must show
the required manual details in chat before calling `manual.gate`. For commands,
show the exact command and redirect stdout/stderr to a workspace-relative log
file such as `.webvibe/manual-logs/<id>.log`. For prepared diffs, show diffs at
most 12KB and 200 lines in a code block; for larger diffs, provide the
downloadable artifact URL returned by `change.prepare`.

`manual.confirm` accepts only an optional workspace-relative manual log file
path. The widget includes that path in its follow-up message so ChatGPT can use
read/git/task tools to verify the current workspace state before continuing.

`task.run` runs only preconfigured task IDs. It does not accept arbitrary shell
commands. `context.get` returns available task IDs, unavailable reasons, timeout
defaults, cwd support, and extra argument rules.

`diagnostics.health` is for connector diagnostics. It reports relay mode, tool
surface version, hashes, and upstream health. It is not the coding preflight.

If ChatGPT Web blocks a tool call before it reaches `/mcp`, `webvibe` cannot
directly observe that blocked request. The model must pass the observed host
text to `manual.gate.hostObservation`; all project instructions and structured
outputs direct safety blocks and capability limits to `manual.gate`.

After changing tool descriptors, resources, annotations, or `_meta` fields,
refresh connector tools in ChatGPT Web settings and start a new chat.
