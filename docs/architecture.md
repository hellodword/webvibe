# Architecture

`webvibe` is a ChatGPT-facing MCP relay. It is not an agent runtime.

Traffic shape:

```text
ChatGPT Web -> webvibe OAuth/MCP -> policy registry -> upstream MCP servers or built-ins
```

The relay owns:

- OAuth registration, authorization, pairing, access tokens, and MCP HTTP
  handling.
- Policy loading, interpolation, default mode selection, and policy allowlists.
- Tool descriptor normalization for ChatGPT-facing MCP clients.
- Tool call routing, timeout, rate limit, output truncation, redaction, and
  audit logging.
- Built-in environment, project, code, and Git inspection tools.
- Built-in batch workspace changeset tools.
- Stdio, streamable HTTP, and local task runner upstream clients.

Default server commands and task commands live in `policies/*.yaml`, not `src/`.
Source code knows transports, routing, policies, workflows, task execution, and
workspace changeset semantics.

## Why Not Fork Codex

The root constraint is ChatGPT Web, not local code. This project exists to make
ChatGPT Web usable for vibecoding, but ChatGPT Web is not Codex. It has OpenAI
safety review in front of MCP calls, and that review often blocks raw shell,
patch text, heredocs, stdin, and similar low-level execution surfaces before the
local relay can handle them. File operations also require user confirmation in
ChatGPT Web and cannot be configured to run without asking the way Codex can.

Codex owns model runtime behavior, shell semantics, sandboxing, approval flow,
patch application, and command execution. Forking or imitating Codex would not
remove ChatGPT Web's host-side safety gates or confirmation model.

`webvibe` keeps a smaller boundary:

```text
stable ChatGPT OAuth/MCP surface
policy allowlist
external upstream tools
sanitized environment inspection
batch workspace apply
fixed local tasks
```

## Upstreams

Supported upstream transports:

- `stdio`: spawn a configured MCP server and speak JSON-RPC over stdin/stdout.
- `streamable-http`: POST JSON-RPC to a remote MCP endpoint.
- `local-task-runner`: run fixed policy-defined tasks without exposing a general
  command tool.

No upstream tool is exposed automatically. Every public tool must be listed in
policy. Optional unavailable upstreams are skipped, and required unavailable
upstreams fail startup.

## Environment Awareness

`env.inspect` is a relay built-in, not an upstream command surface. It collects
the environment facts a coding model usually needs: OS/architecture,
container/devcontainer/editor/CI signals, PATH categories, command availability,
project manifests, lockfiles, npm scripts, current webvibe tools, missing task
reasons, and guidance.

The module deliberately returns categorized and bounded data. ENV values are
redacted except a small safe allowlist, PATH entries are categories rather than
raw directories, and container/editor detection returns sanitized evidence labels
instead of hostnames, user paths, container IDs, or pod names.

## Stable Tool Registration

ChatGPT Web does not continuously reconcile MCP tool changes; users often need
to manually refresh tools. Dynamic hiding based on local command availability can
leave the model reasoning over stale descriptors. Default webvibe policies keep
the public tool list stable and gate execution inside tools. If `cargo`, `make`,
`pip`, a manifest, or a package script is missing, the named task returns
`status: "unavailable"` with `unavailableReason`.

## Why Local Task Runner

The default dev policy intentionally does not use a broad desktop/server control
surface such as `wonderwhy-er/desktop-commander` for command execution. That
style of upstream exposes command/process surfaces that are likely to be blocked
or repeatedly challenged by ChatGPT Web's safety and confirmation layer.

`local-task-runner` exposes one narrow tool, `run_task`, and only executes task
IDs defined by policy. Each task has fixed executable/arguments, optional
required files, optional required npm package script, bounded timeout, and a
workspace-contained cwd. The model asks for a named task instead of sending raw
shell.

For package/module installation tasks, policy may allow bounded `extraArgs`.
Those arguments are validated by count and allowlist or regex before spawning;
they are appended to fixed executable/argument pairs and are never interpreted as
a shell command.

## Why Batch Workspace Apply

Default dev mode uses `repo.file_manifest`, `repo.preview_changeset`, and
`repo.apply_changeset` instead of raw filesystem write/edit tools. ChatGPT Web
asks for confirmation on file operations and cannot be configured like Codex to
skip those prompts. A complete changeset gives the user one reviewed write
boundary instead of many small per-file confirmations.

Batch changesets also give the relay one place to enforce hash guards,
protected paths, symlink guards, UTF-8 checks, size limits, and rollback.
