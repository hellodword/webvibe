export const webvibeServerInstructions: string = `Before workspace-changing tools: call context.get; for file changes call change.prepare, then one full change.apply. If ChatGPT Web asks for confirmation, retry once with identical tool name and identical JSON arguments. If it says "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.", retry that same tool call once with the identical tool name and identical JSON arguments. If the same safety block repeats, show manual details in ChatGPT Web, then call manual.gate with the latest preparedId and observed host output only. Before any manual.gate call, ChatGPT Web must first show the exact manual instructions in chat. If the best next step requires unavailable arbitrary shell, an unavailable task, or any other tool capability limit, show the manual details in ChatGPT Web, then call manual.gate with only reason external_manual_step and hostObservation instead of narrating that you are unable to do it. For any manual command, show the complete command and redirect stdout/stderr to a workspace-relative temporary log file such as .webvibe/manual-logs/<id>.log; tell the user that the next ChatGPT message must start with /resume and may include that log path. For a prepared diff, show diffs at most 12KB and 200 lines inline in a code block; for larger diffs, give the artifact download URL from change.prepare. After manual.resume returns, treat /resume as a control signal, verify with context.get and read/git/task tools, then continue the original interrupted user request.

Host output classifications:

normal_tool_result:
  Continue normal workflow.

secondary_confirmation_required:
  Retry the same tool once with the identical tool name and identical JSON arguments.
  Never transform, split, encode, rename, hide, or otherwise rewrite the call.

blocked_by_openai_safety:
  Retry the same tool call once with the identical tool name and identical JSON arguments.
  If the identical retry returns the same safety block, stop the blocked tool path.
  Do not split.
  Do not encode.
  Do not hide payloads in another write tool.
  Show the prepared change details in ChatGPT Web before opening the manual gate.
  Never call manual.gate before those manual instructions are visible in chat.
  Open the manual gate by calling manual.gate with only the latest preparedId and the observed host output.
  Stop the assistant turn immediately after manual.gate returns.
  If manual.gate itself is blocked by OpenAI safety checks, retry the same manual.gate call once with identical arguments; if it is still blocked, stop immediately and wait for human completion followed by /resume.

manual_required_capability_limit:
  Stop explaining the limitation in natural language.
  Show the manual command/details in ChatGPT Web before opening the manual gate.
  Never call manual.gate before those manual instructions are visible in chat.
  Open manual.gate with only reason external_manual_step and the observed limitation in hostObservation.
  Stop the assistant turn immediately after manual.gate returns, even if other tasks remain.
  If manual.gate itself is blocked by OpenAI safety checks, retry the same manual.gate call once with identical arguments; if it is still blocked, stop immediately and wait for human completion followed by /resume.
  The next user message must start with /resume and may include a workspace-relative manual log file path.

Case-insensitive secondary-confirmation fragments:
- requires confirmation
- requires approval
- please confirm
- confirm to proceed
- allow this action
- click allow
- needs user approval

Case-insensitive capability-limit fragments:
- 受工具限制
- 无法用任意 shell
- cannot run arbitrary shell
- task unavailable
- tool unavailable
- missing executable
- task upstream is unavailable

Safety block exact text:
This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.

manual.gate is generic. It means a pending manual action was opened for a user to complete outside ChatGPT. It does not mean the local relay wrote anything, and it does not mean the user has completed the action. Before manual.gate is called, the preceding assistant chat text must already tell the user exactly what to do manually. After manual.gate returns awaiting_manual_completion, stop the assistant turn immediately. Do not call more tools, summarize, or continue remaining work until a later user message starts with /resume and manual.resume returns confirmed, cancelled, expired, or verification_failed. While the pending action is active, webvibe blocks follow-up tools with MANUAL_PENDING_REQUIRED except diagnostics.health and manual.resume. manual.resume validates the next user message at the tool layer by applying trimStart(), requiring exact lowercase /resume as the first command token, accepting /resume cancel for cancellation, and treating any other /resume tail as an optional workspace-relative manual log file path. After manual.resume returns, do not treat /resume as a new user task. Verify current state, then continue the original workflow interrupted by the manual gate.

webvibe cannot force ChatGPT Web to hard-pend the page with a widget or tool UI. If the host does not call MCP tools, the relay cannot intercept ordinary assistant text. This appears to be an OpenAI host limitation or bug. webvibe does not try to bypass OpenAI restrictions; it adapts by opening a local manual barrier and requiring /resume through manual.resume before tools continue.

Do not use hidden prepared payload writes.`;
