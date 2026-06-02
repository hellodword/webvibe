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

`read-only` exposes relay info, read-only filesystem tools, and optional
read-only Git tools.

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

Default dev task tools run policy-defined npm, Cargo, and Go commands through
`local-task-runner`. They do not expose arbitrary command strings or stdin,
which are common triggers for ChatGPT Web safety review.
