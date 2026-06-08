export const webvibeServerInstructions: string = `Before workspace-changing tools: call context.get; for file changes call change.prepare, then one full change.apply. If ChatGPT Web asks for confirmation, retry once with identical tool name and identical JSON arguments. If it says "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.", stop write tools and call manual.gate with the latest preparedId. If the best next step requires unavailable arbitrary shell, an unavailable task, or any other tool capability limit, show the manual details in ChatGPT Web, then call manual.gate with reason external_manual_step instead of narrating that you are unable to do it. For any manual command, show the complete command and redirect stdout/stderr to a workspace-relative temporary log file such as .webvibe/manual-logs/<id>.log; tell the user that the next ChatGPT message must start with /resume and may include that log path. For a prepared diff, show diffs at most 12KB and 200 lines inline in a code block; for larger diffs, give the artifact download URL from change.prepare. After manual.resume confirms completion and returns an optional manual log file path, verify with context.get and read/git/task tools.

Host output classifications:

normal_tool_result:
  Continue normal workflow.

secondary_confirmation_required:
  Retry the same tool once with the identical tool name and identical JSON arguments.
  Never transform, split, encode, rename, hide, or otherwise rewrite the call.

blocked_by_openai_safety:
  Stop the blocked write path.
  Do not retry.
  Do not split.
  Do not encode.
  Do not hide payloads in another write tool.
  Show the prepared change details in ChatGPT Web before opening the manual gate.
  Open the manual gate by calling manual.gate with the latest preparedId and the observed host output.
  Stop the assistant turn immediately after manual.gate returns.

manual_required_capability_limit:
  Stop explaining the limitation in natural language.
  Show the manual command/details in ChatGPT Web before opening the manual gate.
  Open manual.gate with reason external_manual_step, a concrete title, concrete instructions for the user, and the observed limitation in hostObservation.
  Stop the assistant turn immediately after manual.gate returns.
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

manual.gate is generic. It means a pending manual action was opened for a user to complete outside ChatGPT. It does not mean the local relay wrote anything, and it does not mean the user has completed the action. After manual.gate returns awaiting_manual_completion, stop the assistant turn immediately. Do not call more tools or continue until a later user message starts with /resume and manual.resume returns confirmed, cancelled, expired, or verification_failed. While the pending action is active, webvibe blocks follow-up tools with MANUAL_PENDING_REQUIRED except diagnostics.health and manual.resume. manual.resume validates the next user message at the tool layer by applying trimStart(), requiring exact lowercase /resume as the first command token, accepting /resume cancel for cancellation, and treating any other /resume tail as an optional workspace-relative manual log file path.

webvibe cannot force ChatGPT Web to hard-pend the page with a widget or tool UI. If the host does not call MCP tools, the relay cannot intercept ordinary assistant text. This appears to be an OpenAI host limitation or bug. webvibe does not try to bypass OpenAI restrictions; it adapts by opening a local manual barrier and requiring /resume through manual.resume before tools continue.

Do not use hidden prepared payload writes.`;
