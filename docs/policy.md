# Policy

Policy is the only source of upstream server and upstream tool knowledge.

Important fields:

- `upstreams`: named MCP servers using `stdio`, `streamable-http`, or the
  built-in `local-task-runner`.
- `tools`: ChatGPT-facing tools. Types are `builtIn`, `passThrough`, and
  `workflow`.
- `workspace.protected`: generic path deny patterns.
- `limits`: output byte limit, tool-call timeout, per-client call rate, and
  changeset size limits.
- `audit`: JSONL audit logging switch and rotation size.

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

Input policy supports fixed required values, denied values, and protected path
checks.

Default dev mode exposes batch workspace editing through built-in `repo.*`
tools instead of raw per-file write tools:

- `repo.file_manifest`: read current file hashes before editing.
- `repo.preview_changeset`: validate and preview a multi-file changeset without
  writing.
- `repo.apply_changeset`: apply a complete reviewed changeset in one write
  operation.

This keeps ChatGPT Web confirmation frequency at the changeset boundary. Raw
filesystem write/edit/directory tools are not exposed by the default dev policy,
but a custom policy can still add them explicitly.

Changeset limits default to 80 paths, 5 MiB per changeset, and 1 MiB per file.
Update/delete operations require `expectedSha256` so stale model plans do not
overwrite newer workspace edits.

Runtime configuration is loaded from:

```text
--config file > schema defaults
```

Set `server.mode` to `read-only` or `dev` to use a built-in policy. Set
`server.policy` to load a specific policy file. These fields are mutually
exclusive.
