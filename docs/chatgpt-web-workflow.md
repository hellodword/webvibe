# ChatGPT Web Workflow

ChatGPT Web coding starts with `context.get`.

Recommended order:

1. `context.get`
2. `read.tree`, `read.search`, or `read.files`
3. `change.plan`
4. `change.apply`
5. `task.run`
6. `git.status` or `git.diff`
7. `git.commit`

`change.apply` is the only default file-writing tool. It should apply the full
user-requested file change in one call, because ChatGPT Web asks for approval on
write actions and cannot skip those prompts like Codex.

`task.run` runs only preconfigured task IDs. It does not accept arbitrary shell
commands. `context.get` returns available task IDs, unavailable reasons, timeout
defaults, and extra argument rules.

`diagnostics.health` is for connector diagnostics. It reports relay mode, tool
surface version, hashes, and upstream health. It is not the coding preflight.

When the tool surface changes, users must refresh the connector tools in
ChatGPT Web settings.
