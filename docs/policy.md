# Policy

Policy is the only source of upstream server and upstream tool knowledge.

Important fields:

- `upstreams`: named MCP servers using `stdio`, `streamable-http`, or the
  built-in `local-task-runner`.
- `tools`: ChatGPT-facing tools. Types are `builtIn`, `passThrough`, and
  `workflow`.
- `workspace.protected`: generic path deny patterns.
- `limits`: output byte limit, tool-call timeout, and per-client call rate.
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

Configuration priority is:

```text
CLI flags > config file > WEBVIBE_* environment variables > defaults
```

Useful environment variables include `WEBVIBE_CONFIG`, `WEBVIBE_MODE`,
`WEBVIBE_POLICY`, `WEBVIBE_WORKSPACE`, `WEBVIBE_PUBLIC_BASE_URL`,
`WEBVIBE_LISTEN`, `WEBVIBE_STATE_DIR`, `WEBVIBE_PAIRING_CODE`, and
`WEBVIBE_PAIRING_CODE_FILE`.
