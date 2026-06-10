# ChatGPT Web Constraint Adaptation

ChatGPT Web places host-side review and UI controls in front of MCP tool calls.
Those controls are not fully documented from the relay's point of view. Treat
them as black-box, inconsistent, and subject to change.

webvibe adapts to those constraints to maximize coding completion in ChatGPT
Web. It uses narrower tool shapes, smaller payloads, visible user confirmation,
fixed task IDs, and manual completion when the host refuses a tool call.

The limits below are observed examples, not guaranteed rules. They may appear
only sometimes, and absence in one session does not mean the limit is gone.

## Observed Host Limits

- High-risk tool calls may be blocked before they reach local MCP code. Examples
  include raw shell, general exec, patch application, delete operations,
  heredoc-like payloads, stdin, and other low-level execution surfaces.
- Patch text or file paths containing suspicious terms may trigger review even
  when the actual operation is legitimate. One observed example is a path such
  as `password_hash.go`.
- Changes to Go projects' `internal` packages may also be false-positive
  flagged, even when the edits are ordinary code changes.
- ChatGPT Web cannot reliably be configured to "never ask" for local file
  operations. A workflow that edits several files may receive a confirmation
  prompt for each file or tool call.
- Tool call output may be truncated by the ChatGPT Web host even after the relay
  has already applied its own output limits. One observed file result returned
  roughly 11 KB before host truncation.
- UI widget results cannot reliably keep the ChatGPT Web page in a pending
  state. This appears to be a host limitation or bug; webvibe does not attempt
  to investigate or work around it through hidden continuation.
- The MCP tool list does not reliably refresh automatically after descriptor,
  annotation, or `_meta` changes. Users may need to refresh connector tools in
  ChatGPT Web settings and start a new chat.
- ChatGPT Web's built-in memory may retain cached understanding of MCP state.
  Tool or workflow changes may need explicit versioning, upgrade notes, or a
  fresh chat so the model stops relying on stale assumptions.

## Design Implications

webvibe treats these limits as product constraints. Default dev mode avoids
general-purpose command execution, raw filesystem write tools, hidden
prepared-payload application, and broad desktop-control upstreams. It prefers
policy-defined tasks, bounded read chunks, small single-logical-change payloads
by default, explicit manual fallback, and `/resume` after user-completed manual
work.

When ChatGPT Web blocks a tool call, webvibe does not split the blocked action
into smaller hidden calls, rename suspicious payloads, encode content, or apply
a prepared change by id. Those tactics are unstable, hard to audit, difficult
to recover from, and tend to lower task completion. The model follows the
documented workflow: retry an exact OpenAI safety block once with unchanged
arguments, then use manual completion if the retry is blocked again.
