# Design

`webvibe` is a ChatGPT-facing MCP relay/gateway. It is not an agent runtime and
does not fork Codex. The relay owns OAuth, pairing, MCP HTTP handling, policy
loading, upstream routing, descriptor normalization, output limits, redaction,
and audit logging.

Traffic shape:

```text
ChatGPT Web -> webvibe -> policy-selected upstream MCP servers
```

Code knows generic upstreams, transports, tools, workflows, local task execution,
and policies. Default server commands and task commands live in
`policies/*.yaml`, not `src/`.

## Why Not Fork Codex

Codex owns model/runtime/tool execution, sandboxing, patching, approval, and
command semantics. ChatGPT Web calls external MCP tools through host-side tool
selection and safety gates. Exposing raw shell, argv, patch text, heredocs, or
stdin through an MCP app is brittle and often blocked before local code runs.

The cleaner boundary is a relay:

```text
stable ChatGPT OAuth/MCP surface
policy allowlist
external MCP servers
```

## Node.js And npm

The implementation uses Node.js, TypeScript, and npm because the MCP/App SDK
ecosystem is immediately usable from Node, and this project is mostly HTTP,
JSON-RPC, config parsing, stdio process management, and schema validation.

## Modes

Only two modes exist:

- `read-only`: read/search/list context and read-only Git tools when available.
- `dev`: extends read-only and adds a policy-defined batch changeset apply
  tool plus fixed npm, cargo, and Go task tools.

Mode chooses a default policy. `--policy` can replace the defaults completely.
