# Policy

Policy is the only source of upstream server and upstream tool knowledge.

Important fields:

- `upstreams`: named MCP servers using `stdio` or `streamable-http`.
- `tools`: ChatGPT-facing tools. Types are `builtIn`, `passThrough`, and
  `workflow`.
- `workspace.protected`: generic path deny patterns.
- `limits`: output byte limit and timeout defaults.
- `audit`: JSONL audit logging switch.

Pass-through tools map one public tool name to one upstream tool:

```yaml
- name: fs.read_text_file
  type: passThrough
  upstream: fs
  upstreamTool: read_text_file
```

Workflow tools expose narrow stable commands while delegating execution to a
configured upstream:

```yaml
- name: task.npm_test
  type: workflow
  inputSchema:
    type: object
    additionalProperties: false
  steps:
    - call:
        upstream: desktop
        tool: execute_command
        input:
          command: npm test
```

Input policy supports fixed required values, denied values, protected path
checks, and preview-before-apply matching.
