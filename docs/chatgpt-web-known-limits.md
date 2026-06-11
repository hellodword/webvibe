# ChatGPT Web Host Limits

This document records observed ChatGPT Web host behavior that affects MCP coding workflows.

These are empirical constraints, not guaranteed platform rules. They can vary by session, UI state, account, model, connector state, payload shape, and OpenAI-side changes. Treat them as black-box host behavior that may change without notice.

The purpose of this document is practical: preserve the specific observations that shaped `webvibe`'s default tool surface and workflow. Do not replace these details with a generic statement like "ChatGPT Web has host constraints"; the details are what help maintainers choose safer tool shapes.

## Observed Host Limits

### High-risk tool calls may be blocked before reaching local MCP code

ChatGPT Web may block a tool call on the host side before the request reaches the local relay. Observed risky shapes include:

- raw shell;
- general exec;
- patch application;
- delete operations;
- heredoc-like payloads;
- stdin-driven execution;
- broad low-level execution surfaces.

Design consequence: default `dev` mode avoids a general shell and routes unknown or raw command-shaped work to fixed task IDs or manual completion.

### Suspicious terms in paths or patch text can false-positive

Patch text or file paths containing suspicious terms may trigger review even when the operation is legitimate.

One observed example is a file path such as:

```text
password_hash.go
```

The problem is not necessarily the actual code behavior. The host may react to tokens in a path, diff, or payload. Renaming, encoding, or splitting the payload to bypass the host is not an acceptable recovery strategy.

Design consequence: retry only according to the documented host-block flow, then use manual completion.

### Go `internal` package edits can false-positive

Changes to Go projects' `internal` packages may also be false-positive flagged, even when the edits are ordinary code changes.

This matters because `internal` is a normal Go visibility convention, not inherently a security-sensitive operation. The host may still treat the path or surrounding context as higher-risk.

Design consequence: do not special-case Go `internal` paths as unsafe in the relay, but be prepared for host review or manual completion.

### "Never ask" behavior is not reliable

ChatGPT Web cannot reliably be configured to never ask for local file operations.

A workflow that edits several files may receive a confirmation prompt for each file or each tool call. This can happen even when the local relay policy allows the operation and the user has previously approved similar operations.

Design consequence: keep default edit operations small and reviewable. Prefer one logical file change per preview/apply call in the default policy, and use batch tools only when policy explicitly enables batch edit mode.

### Host output truncation can happen after relay truncation

`webvibe` applies its own output limits before returning a tool result, but ChatGPT Web may still truncate what the model sees.

One observed file result returned roughly 11 KB before host truncation.

Design consequence: do not rely on a large single tool result. Prefer bounded reads, cursors, targeted `fs.read_many`, summaries, hashes, manifests, and artifacts for large diffs.

### UI widgets cannot reliably keep the ChatGPT Web page pending

UI widget results cannot reliably keep the ChatGPT Web page in a pending state.

This appears to be a host limitation or bug. `webvibe` does not try to work around it through hidden continuation, hidden payload state, or tool-output tricks.

Design consequence: use the local manual barrier plus `/resume` flow. After `manual.gate` returns `awaiting_manual_completion`, the assistant turn must stop.

### Tool descriptors may stay stale

The MCP tool list does not reliably refresh automatically after descriptor, annotation, or `_meta` changes.

Users may need to refresh connector tools in ChatGPT Web settings and start a new chat before the model reliably uses the new tool surface.

Design consequence: expose surface/version hashes through `workspace.context` and `diagnostics.health`, and prefer stable public tool names with gated behavior inside tools.

### Model memory may retain stale MCP assumptions

ChatGPT Web's built-in memory or conversation state may retain cached understanding of MCP state.

Tool or workflow changes may need explicit versioning, upgrade notes, connector refresh, or a fresh chat so the model stops relying on stale assumptions.

Design consequence: keep server instructions versioned, include policy/tool-surface hashes in diagnostics, and tell users when a fresh chat is the safer path.

## Host Block Handling

When ChatGPT Web asks for secondary confirmation, retry the identical tool call once with the identical tool name and identical JSON arguments.

When ChatGPT Web returns the exact OpenAI safety-check block text, retry the identical tool call once with the identical tool name and identical JSON arguments. If the identical retry is blocked again, use manual completion.

When `manual.gate` itself is blocked by the same safety text, retry `manual.gate` once with identical arguments. If it is still blocked, stop and wait for human completion followed by `/resume`.

Do not work around a host block by:

- splitting a blocked action into hidden smaller actions;
- renaming suspicious paths or payload fields to avoid review;
- encoding, compressing, or obfuscating content;
- hiding commands, diffs, logs, or file contents in metadata;
- applying a prepared payload by id;
- using a different tool shape to smuggle the same blocked operation.

Those tactics are unstable, hard to audit, difficult to recover from, and tend to lower task completion.
