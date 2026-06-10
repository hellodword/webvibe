# ChatGPT Web Workflow

ChatGPT Web coding starts with `workspace.context`. For exact tool parameters,
schemas, and generated examples, see [Tool Contracts](tools.md).

Recommended first calls:

```json tool=workspace.context
{}
```

```json tool=workspace.scan
{"maxDepth":6,"maxEntries":2000}
```

```json tool=fs.tree
{"path":".","maxDepth":3,"maxEntries":500}
```

```json tool=fs.read_many
{"paths":["README.md","package.json"],"maxBytes":60000}
```

Normal flow:

1. Use `workspace.context` before workspace tools.
2. Inspect with `workspace.scan`, `fs.tree`, `fs.search`, `fs.read`, `fs.read_many`, and `fs.stat`.
3. Call `task.list` before `task.run`; use `task.explain` when routing is unclear.
4. Preview workspace writes with `file.change_preview`, then apply with matching `file.change_apply`.
5. Use `git.commit_preview` before `git.commit`.
6. Use `diagnostics.health` for connector diagnostics, not coding preflight.

Manual flow:

1. If a required step is outside the fixed tool surface, has no matching `taskId`, or uses an unavailable capability, show manual instructions in chat.
2. Call `manual.prepare` when possible with low-risk continuation metadata only.
3. Call `manual.gate` with v1 proof fields and low-risk `hostObservation`; do not include commands, diffs, stdout, stderr, logs, or source content.
4. Stop the assistant turn after `manual.gate`.
5. The next user message must start with `/resume <operationId>` or `/resume cancel <operationId>`.
6. Call `manual.resume` and continue only when it returns `confirmed`.

Host behavior:

- If ChatGPT Web asks for secondary confirmation, retry the identical tool call once.
- If ChatGPT Web returns the exact OpenAI safety block text, retry the identical tool call once.
- If the identical retry is blocked again, use the manual flow.
- If `manual.gate` itself is blocked, retry it once with identical arguments; if still blocked, stop and wait for human completion followed by `/resume`.

While a manual barrier is pending, webvibe blocks workspace tools with
`MANUAL_PENDING_REQUIRED` except `diagnostics.health`, `manual.status`, and
`manual.resume`.
