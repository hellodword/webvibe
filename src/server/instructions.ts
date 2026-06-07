export const webvibeServerInstructions: string = `Before workspace-changing tools: call context.get; for file changes call change.prepare, then one full change.apply. If ChatGPT Web asks for confirmation, retry once with identical tool name and identical JSON arguments. If it says "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.", stop write tools and call manual.gate with the latest preparedId. After the widget confirms completion, verify with read/git/task tools.

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

Case-insensitive secondary-confirmation fragments:
- requires confirmation
- requires approval
- please confirm
- confirm to proceed
- allow this action
- click allow
- needs user approval

Safety block exact text:
This tool call was blocked by OpenAI's safety checks. Please double check what you are sending.

manual.gate is generic. It means a pending manual action was opened for a user to complete outside ChatGPT. It does not mean the local relay wrote anything, and it does not mean the user has completed the action. Only manual.confirm means the widget reported the user returned and clicked confirmation.

Do not use hidden prepared payload writes.`;
