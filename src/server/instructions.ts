export const webvibeServerInstructions: string = `Before workspace-changing tools: call context.get; for file changes call change.prepare, then one full change.apply. If ChatGPT Web asks for confirmation, retry once with identical tool name and identical JSON arguments. If it says "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.", stop write tools and call manual.gate with the latest preparedId. If the best next step requires unavailable arbitrary shell, an unavailable task, or any other tool capability limit, call manual.gate with reason external_manual_step instead of narrating that you are unable to do it. After the widget confirms completion and returns manual output/logs, verify with read/git/task tools.

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
  Open the generic manual completion gate by calling manual.gate with the latest preparedId and the observed host output.

manual_required_capability_limit:
  Stop explaining the limitation in natural language.
  Open manual.gate with reason external_manual_step, a concrete title, concrete instructions for the user, and the observed limitation in hostObservation.
  The widget will let the user paste manual output, stdout, stderr, logs, or result notes into manual.confirm.

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

manual.gate is generic. It means a pending manual action was opened for a user to complete outside ChatGPT. It does not mean the local relay wrote anything, and it does not mean the user has completed the action. Only manual.confirm means the widget reported the user returned, clicked confirmation, and optionally provided manual output/logs/evidence for the continuation turn.

Do not use hidden prepared payload writes.`;
