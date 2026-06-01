# Upstreams

Upstreams are external MCP servers configured in policy. `webvibe` supports:

- `stdio`: spawn a command and speak JSON-RPC over standard input/output.
- `streamable-http`: POST JSON-RPC to a remote MCP endpoint.
- `local-task-runner`: run fixed policy-defined tasks without exposing a
  general command tool.

Default policies include filesystem, Git, and built-in dev task upstreams. These
defaults can be replaced by passing `--policy ./my-policy.yaml`.

Optional upstream behavior:

- Optional unavailable upstream: server keeps running and dependent tools are
  omitted from `tools/list`.
- Required unavailable upstream: startup fails.

No upstream tool is exposed automatically. Every public tool must be listed in
policy.
