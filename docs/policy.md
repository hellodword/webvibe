# Policy

Policy is the source of upstream server and public tool knowledge. Source code
does not publish upstream tools automatically.

Runtime configuration selects policy in one of two ways:

```text
server.mode   -> built-in policy from policies/read-only.yaml or policies/dev.yaml
server.policy -> explicit policy file
```

`server.mode` and `server.policy` are mutually exclusive. Policy files can use
`extends` to merge a base policy.

Important fields:

- `upstreams`: named MCP servers using `stdio`, `streamable-http`, or the
  built-in `local-task-runner`.
- `tools`: ChatGPT-facing tools. Types are `builtIn`, `passThrough`, and
  `workflow`.
- `workspace.protected`: generic path deny patterns.
- `limits`: output byte limit, tool-call timeout, per-client call rate, and
  changeset size limits.
- `audit`: JSONL audit logging switch and rotation size.

## Tool Types

Built-in tools are implemented by the relay:

- `relay.info`
- `relay.list_upstreams`
- `relay.list_tools`
- `env.inspect`
- `project.inspect`
- `code.search`
- `code.file_tree`
- `git.status`
- `git.diff_unstaged`
- `git.diff_staged`
- `git.log`
- `git.show`
- `git.branch`
- `git.ls_files`
- `git.rev_parse`
- `git.commit_paths` in dev mode
- `repo.file_manifest`
- `repo.preview_changeset`
- `repo.apply_changeset`

Pass-through tools map one public tool name to one upstream tool:

```yaml
- name: fs.read_text_file
  type: passThrough
  upstream: fs
  upstreamTool: read_text_file
```

Tools may define `outputSchema` to describe their structured result payload for
ChatGPT and MCP clients. If a pass-through upstream already provides one,
webvibe forwards it unless the policy overrides it.

Workflow tools expose narrow stable actions while delegating execution to a
configured upstream:

```yaml
upstreams:
  tasks:
    transport: local-task-runner
    tasks:
      npm_test:
        executable: npm
        args: ["test"]

tools:
  - name: task.npm_test
    type: workflow
    inputSchema:
      type: object
      additionalProperties: false
    steps:
      - call:
          upstream: tasks
          tool: run_task
          input:
            taskId: npm_test
```

## Input Policy

Input policy supports fixed required values, denied values, and protected path
checks.

```yaml
inputPolicy:
  require:
    dryRun: true
  pathFields: ["path"]
```

By default, path fields must stay inside `workspace.root` and must not match
`workspace.protected`. A tool can opt out with `protectedPathPolicy: allow`.

## Default Modes

`read-only` exposes relay info, `env.inspect`, `project.inspect`,
`code.search`, `code.file_tree`, read-only filesystem tools, and stable
read-only Git tools. `env.inspect` should be the first call when the model needs
to know whether the workspace has npm, Go, Rust, Python, `make`, CI,
devcontainer, or editor signals available.

Default dev mode exposes batch workspace editing through built-in `repo.*`
tools instead of raw per-file write tools:

- `repo.file_manifest`: read current file hashes before editing.
- `repo.preview_changeset`: validate and preview a multi-file changeset without
  writing.
- `repo.apply_changeset`: apply a complete reviewed changeset in one write
  operation.

This matches ChatGPT Web's confirmation model. File operations require user
confirmation and cannot be set to run without asking like Codex, so the default
policy puts confirmation at the reviewed changeset boundary. Raw filesystem
write/edit/directory tools are not exposed by the default dev policy, but a
custom policy can still add them explicitly.

Changeset limits default to 80 paths, 5 MiB per changeset, and 1 MiB per file.
Update/delete operations require `expectedSha256` so stale model plans do not
overwrite newer workspace edits.

Default dev task tools run policy-defined npm, Go, Rust, and Python commands
through `local-task-runner`. They do not expose arbitrary command strings or
stdin, which are common triggers for ChatGPT Web safety review.

Default dev also exposes dependency and fix/verification task tools for npm, Go,
Rust, and Python only: `task.npm_install`, `task.npm_ci`,
`task.npm_add_package`, `task.npm_remove_package`, `task.go_mod_download`,
`task.go_mod_tidy`, `task.go_get`, `task.cargo_fetch`, `task.cargo_update`,
`task.cargo_add`, `task.uv_sync`, `task.uv_add`,
`task.pip_install_requirements`, `task.npm_format`, `task.npm_lint_fix`,
`task.cargo_fmt`, `task.go_fmt`, and `task.uv_run_pytest`. The default policy
does not include pnpm, bun, yarn, Poetry, JVM, .NET, Ruby, or PHP tasks.

Task tools remain listed even when a manifest, command, or package script is
missing. Calls return `status: "unavailable"` plus `unavailableReason`, so
ChatGPT Web does not need a manual refresh to reconcile dynamically hidden
tools.

`git.commit_paths` is the only default Git mutation tool. It requires explicit
`paths` and `message`, rejects protected paths, refuses empty commits, and
commits only the named pathspecs so unrelated dirty files are not included.

## Stable Tool Registration

Default policies avoid environment-dependent hiding for the public tool list.
ChatGPT Web refreshes MCP tools manually, so dynamic registration can leave the
model reasoning over stale tools. webvibe instead keeps the list stable and uses
structured `unavailable` results for missing commands, manifests, scripts, or
unsupported workspaces.
