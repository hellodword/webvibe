# ChatGPT Web Workflow

ChatGPT Web coding starts with `context.get`.

Recommended order:

1. `context.get`
2. `read.tree` / `read.search` / `read.files` / `read.stat`
3. `change.plan` when preview is useful
4. `change.prepare` before any `change.apply`
5. `change.apply` as one complete batch write
6. If ChatGPT Web asks for secondary confirmation: retry the identical `change.apply` once
7. If ChatGPT Web blocks with OpenAI safety checks: retry the identical tool call once with unchanged arguments
8. If the identical retry is blocked again: show manual instructions, then call `manual.gate` with the latest `preparedId` and observed host output only
9. If the best next step requires unavailable arbitrary shell/Node, has no matching task ID, or uses an unavailable task: show manual instructions in chat, then call `manual.gate` with only `reason` and a low-risk `hostObservation`
10. Stop the assistant turn immediately after `manual.gate`, even if other work remains
11. User completes the manual step outside ChatGPT
12. The next user message must start with `/resume`
13. Model calls `manual.resume` with that message
14. Model treats `/resume` as a control signal, verifies with `context.get` plus `git.status` / `git.diff` / `read.stat` / `task.run`, then continues the original interrupted request
15. `git.commit` only when explicitly requested or appropriate

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
8. Model verifies current state with normal read/git/task tools and resumes the original interrupted workflow.

Host output decision table:

| observed output | classification | local relay likely saw the blocked call? | required next action | retry limit | manual gate behavior | audit behavior |
| --- | --- | ---: | --- | ---: | --- | --- |
| normal structured result such as `applied: true` | `normal_tool_result` | yes | continue normal workflow | 0 | none | normal tool audit |
| `CONTEXT_REQUIRED` | `relay_policy_block` | yes | call `context.get` | 0 | none | blocked audit from relay |
| `MANUAL_PENDING_REQUIRED` | `manual_action_pending` | yes | stop and wait for `/resume` | 0 | existing pending barrier | blocked audit from relay |
| `requires confirmation` / `please confirm` / `click allow` | `secondary_confirmation_required` | maybe no | retry same tool once with identical name and identical JSON arguments | 1 | none unless retry becomes safety block | local relay may not see first attempt |
| exact `This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.` | `blocked_by_openai_safety` | usually no | retry the same tool once with identical name and identical JSON arguments; if the identical retry is blocked again, show manual instructions, then call `manual.gate` with latest `preparedId` and observed host output only | 1 | manual barrier requiring `/resume` only after repeated safety block | `manual.gate.hostObservation` records the repeated observed block |
| `manual.gate` is blocked by OpenAI safety checks | `blocked_manual_gate` | usually no | retry the same `manual.gate` once with identical arguments; if still blocked, stop immediately and wait for human completion followed by `/resume` | 1 | none if call never reached relay | no local audit if host blocked before relay |
| `受工具限制` / `cannot run arbitrary shell` / `no matching task id` / `task unavailable` / `tool unavailable` | `manual_required_capability_limit` | yes or model-observed | stop explaining limitation; show manual command/log details in chat, then call `manual.gate` with only `reason` and a low-risk `hostObservation` summary | 0 | manual barrier requiring `/resume` | `manual.gate.hostObservation` records only the low-risk capability-limit summary |
| next user message starts with `/resume` | `manual_completion_resumed` | yes | call `manual.resume`, then verify workspace state and continue the original interrupted request | 0 | pending record transitions if checks pass or cancel requested | `manual.resume` audit event |
| next user message does not start with `/resume` | `manual_resume_required` | yes if tool called | call `manual.resume` only when the message starts with `/resume` | 0 | pending record remains pending | blocked audit from relay |

Do not split a blocked write into additional write calls.
Do not encode, obfuscate, rename, or hide payloads.
Do retry an exact OpenAI safety block once with the same tool name and unchanged
JSON arguments before entering manual flow.
Do not put detailed manual instructions, commands, scripts, diffs, file
contents, stdout/stderr, or log contents into `manual.gate` arguments.
Do not continue the current assistant turn after `manual.gate`.
Do not use a `preparedId` as a hidden write mechanism.
Do not implement or call apply-by-id tools.
Do not treat `manual.gate` as proof that the user completed the work.
Do not continue until `manual.resume` reports confirmed or cancelled.

ChatGPT Web must show the required manual details in chat before calling
`manual.gate`. For commands, show the exact command and have the user redirect
stdout/stderr locally to a workspace-relative log file such as
`.webvibe/manual-logs/<id>.log`. That log file is created by the user's terminal
outside ChatGPT; ChatGPT Web must not send command text, stdout/stderr, or log
contents through `manual.gate`. For prepared diffs, show diffs at most 12KB and
200 lines in a code block; for larger diffs, provide the downloadable artifact
URL returned by `change.prepare`. The `manual.gate` tool call itself uses
minimal arguments only: `reason`, optional `preparedId`, and optional
`hostObservation`. For model-observed capability limits, use a low-risk
`hostObservation` such as `toolName: "capability.limit"` and
`outputText: "manual step required because required execution capability is unavailable"`.

`task.run` runs only preconfigured task IDs. It does not accept arbitrary shell
commands. `context.get` returns available task IDs, unavailable reasons, timeout
defaults, cwd support, extra argument rules, and manual fallback guidance. If
there is no matching task ID for a required command, the model uses the same
manual gate flow instead of ending with an inability statement.

`diagnostics.health` is for connector diagnostics. It reports relay mode, tool
surface version, hashes, and upstream health. It is not the coding preflight.

If ChatGPT Web blocks a tool call before it reaches `/mcp`, `webvibe` cannot
directly observe that blocked request. The model first retries the same tool
once with unchanged arguments for the exact OpenAI safety block text. If that
retry is blocked again, the model passes the observed host text to
`manual.gate.hostObservation`; all project instructions and structured outputs
direct repeated safety blocks and capability limits to `manual.gate`.

If ChatGPT Web blocks `manual.gate` itself, the model retries the same `manual.gate`
call once with identical arguments. If it is still blocked, the model must stop
the assistant turn and wait for the user to complete the manual work. The next
user message should still start with `/resume`; after `manual.resume`, the model
verifies state and resumes the original interrupted task.

After changing tool descriptors, annotations, or `_meta` fields, refresh
connector tools in ChatGPT Web settings and start a new chat.
