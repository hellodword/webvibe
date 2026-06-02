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
defaults, cwd support, and extra argument rules. For monorepos, choose the
manifest directory from `context.get.project.manifests` and pass it as
`task.run.cwd`.

`diagnostics.health` is for connector diagnostics. It reports relay mode, tool
surface version, hashes, and upstream health. It is not the coding preflight.

When the tool surface changes, users must refresh the connector tools in
ChatGPT Web settings.
