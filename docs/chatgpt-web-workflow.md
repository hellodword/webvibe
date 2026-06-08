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
8. If the best next step requires unavailable arbitrary shell or an unavailable task: show manual instructions, then call `manual.gate`
9. Stop the assistant turn after `manual.gate`
10. User completes the manual step outside ChatGPT
11. The next user message must start with `/resume`
12. Model calls `manual.resume` with that message
13. Model verifies with `context.get` plus `git.status` / `git.diff` / `read.stat` / `task.run`
14. `git.commit` only when explicitly requested or appropriate

`webvibe` does not suspend an in-flight JSON-RPC `tools/call` or force
ChatGPT Web to hard-pend the current assistant turn. UI widget results cannot
make the ChatGPT Web page reliably pending; this appears to be an OpenAI
limitation or bug. `webvibe` does not try to bypass OpenAI restrictions. It
adapts by opening a local relay barrier and requiring `/resume` through
`manual.resume` before tools continue.

This is treated as an OpenAI limitation or bug, not a behavior for webvibe to
bypass.

While that barrier is pending, follow-up tools are blocked with
`MANUAL_PENDING_REQUIRED` except `diagnostics.health` and `manual.resume`.
`context.get` is also blocked while manual work is pending, because the current
assistant turn must stop.

`manual.resume` is the authoritative transition from a pending manual action to
confirmed/cancelled/expired. It does not apply patches, delete files, run
commands, or mutate the workspace. It validates the next user message at the
tool layer by applying `trimStart()`, requiring exact lowercase `/resume` as the
first command token, accepting `/resume cancel`, and treating any other
`/resume` tail as an optional workspace-relative log file path.

Manual continuation sequence:

1. ChatGPT shows complete manual instructions in chat.
2. `manual.gate` returns an `awaiting_manual_completion` tool result.
3. Assistant stops; if it tries to call more tools, relay returns `MANUAL_PENDING_REQUIRED`.
4. User completes the required manual work outside ChatGPT.
5. User replies with `/resume`, `/resume .webvibe/manual-logs/<id>.log`, or `/resume cancel`.
6. Model calls `manual.resume` with the user's message.
7. `manual.resume` records confirmed/cancelled/expired, stores the optional log path, and verifies configured checks.
8. Model verifies current state with normal read/git/task tools.

Host output decision table:

| observed output | classification | local relay likely saw the blocked call? | required next action | retry limit | manual gate behavior | audit behavior |
| --- | --- | ---: | --- | ---: | --- | --- |
| normal structured result such as `applied: true` | `normal_tool_result` | yes | continue normal workflow | 0 | none | normal tool audit |
| `CONTEXT_REQUIRED` | `relay_policy_block` | yes | call `context.get` | 0 | none | blocked audit from relay |
| `MANUAL_PENDING_REQUIRED` | `manual_action_pending` | yes | stop and wait for `/resume` | 0 | existing pending barrier | blocked audit from relay |
| `requires confirmation` / `please confirm` / `click allow` | `secondary_confirmation_required` | maybe no | retry same tool once with identical name and identical JSON arguments | 1 | none unless retry becomes safety block | local relay may not see first attempt |
| exact `This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.` | `blocked_by_openai_safety` | usually no | stop write tools; call `manual.gate` with latest `preparedId` | 0 | manual barrier requiring `/resume` | `manual.gate.hostObservation` records observed block |
| `受工具限制` / `cannot run arbitrary shell` / `task unavailable` / `tool unavailable` | `manual_required_capability_limit` | yes or model-observed | stop explaining limitation; show manual command/log details in chat, then call `manual.gate` with external instructions | 0 | manual barrier requiring `/resume` | `manual.gate.hostObservation` records observed limit |
| next user message starts with `/resume` | `manual_completion_resumed` | yes | call `manual.resume`, then verify workspace state | 0 | pending record transitions if checks pass or cancel requested | `manual.resume` audit event |
| next user message does not start with `/resume` | `manual_resume_required` | yes if tool called | call `manual.resume` only when the message starts with `/resume` | 0 | pending record remains pending | blocked audit from relay |

Do not split a blocked write into additional write calls.
Do not encode, obfuscate, rename, or hide payloads.
Do not use a `preparedId` as a hidden write mechanism.
Do not implement or call apply-by-id tools.
Do not treat `manual.gate` as proof that the user completed the work.
Do not continue until `manual.resume` reports confirmed or cancelled.

ChatGPT Web must show the required manual details in chat before calling
`manual.gate`. For commands, show the exact command and redirect stdout/stderr
to a workspace-relative log file such as `.webvibe/manual-logs/<id>.log`. For
prepared diffs, show diffs at most 12KB and 200 lines in a code block; for
larger diffs, provide the downloadable artifact URL returned by
`change.prepare`.

`task.run` runs only preconfigured task IDs. It does not accept arbitrary shell
commands. `context.get` returns available task IDs, unavailable reasons, timeout
defaults, cwd support, and extra argument rules.

`diagnostics.health` is for connector diagnostics. It reports relay mode, tool
surface version, hashes, and upstream health. It is not the coding preflight.

If ChatGPT Web blocks a tool call before it reaches `/mcp`, `webvibe` cannot
directly observe that blocked request. The model must pass the observed host
text to `manual.gate.hostObservation`; all project instructions and structured
outputs direct safety blocks and capability limits to `manual.gate`.

After changing tool descriptors, annotations, or `_meta` fields, refresh
connector tools in ChatGPT Web settings and start a new chat.
