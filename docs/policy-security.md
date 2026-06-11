# Policy and Security

`webvibe` is default-deny at the MCP relay boundary. A tool is public only when policy exposes it. An upstream tool is never copied into the public surface automatically.

The policy boundary is a capability boundary inside `webvibe`, not an operating-system sandbox. Use a disposable workspace, normal OS permissions, containers, or other isolation when that is required.

## Policy selection

Runtime config selects policy in exactly one of these ways:

```text
server.mode   -> built-in policy from policies/read-only.yaml or policies/dev.yaml
server.policy -> explicit policy file
```

If neither is set, `server.mode` defaults to `read-only`.

Policy files use `version: 3`. A policy may use `extends` to merge another policy. Merge behavior is deep for profiles, task bundles, task catalog, host risk, and limits; tools are appended.

Policy interpolation supports runtime values such as workspace root, state dir, and environment variables.

## Built-in policies

`policies/read-only.yaml` exposes inspection-oriented tools:

- workspace context/scan/symbols;
- filesystem tree/search/read/stat/manifest;
- Git status/changed/diff/show/blame/commit_preview;
- diagnostics.

`policies/dev.yaml` exposes the default coding flow:

- everything in `read-only`;
- single file change preview/apply;
- manual prepare/gate/status/resume;
- fixed task list/explain/run/result;
- Git commit preview/commit.

The built-in `dev` policy keeps batch edit mode disabled and does not expose broad shell, raw filesystem write tools, hidden apply-by-id tools, push, reset-hard, arbitrary checkout, or process-control tools.

## Important policy fields

`upstreams` declares named MCP providers. Supported transports are `stdio`, `streamable-http`, and `local-task-runner`.

`tools` declares ChatGPT-facing public tools. Supported types are `builtIn`, `passThrough`, and `workflow`.

`workspace.protected` declares path patterns blocked by filesystem, change, Git, manual verification, and pass-through path policies.

`limits` controls output, HTTP body size, tree/search/read sizes, changeset sizes, task timeouts/log capture, manual TTL/message size, and rate limits.

`taskBundles` controls which discovered project task families are reported as candidates.

`taskCatalog` documents resolver capability metadata. It does not make commands runnable.

`editMode` tells the model whether single or batch edit mode is active.

`hostRisk` controls manual-first routing hints and thresholds for host-sensitive work.

`audit` controls JSONL audit logging, payload inclusion, redaction, manual events, and rotation.

## Tool policy types

### Built-in tools

Built-ins are implemented by `webvibe` and still must be listed in policy to be public.

### Pass-through tools

Pass-through tools map a public name to an upstream tool. They must declare an input policy with path fields or explicitly declare that there is no path input. Protected paths default to deny.

Optional pass-through tools can report unavailable status when their upstream is unavailable, but they need local schemas to remain safely published.

### Workflow tools

Workflow tools run fixed policy-defined upstream steps. They must declare input schema, output schema, fixed steps, and examples. Workflow timeout is controlled by workflow timeout settings, not by a global `limits.timeoutMs`.

## Limits and timeouts

There is no global `limits.timeoutMs`.

Relevant timeout behavior:

- `task.run` uses task-specific `defaultTimeoutSeconds`/`maxTimeoutSeconds` when present, otherwise `limits.task.defaultTimeoutSeconds` and `limits.task.maxTimeoutSeconds`.
- Generic public calls are wrapped by the router using the default task timeout as the fallback.
- Workflow tools can declare their own `timeoutSeconds`.
- Upstream transports may also have transport-level timeout settings.

Other important limits include:

- `limits.output.preferredToolOutputBytes`
- `limits.output.maxToolOutputBytes`
- `limits.http.oauthMaxBodyBytes`
- `limits.http.mcpMaxBodyBytes`
- `limits.read.maxBytes`
- `limits.change.maxFiles`
- `limits.change.maxTotalBytes`
- `limits.change.maxTextFileBytes`
- `limits.change.maxInlineDiffBytes`
- `limits.manual.ttlSeconds`
- `limits.rate.maxCallsPerMinute`

Over-limit tool output is truncated and marked. Large audit payloads are summarized after redaction.

## OAuth and pairing

Exactly one pairing-code source is required:

- `auth.pairingCode`
- `auth.pairingCodeEnv`
- `auth.pairingCodeFile`

The configured code is trimmed, loaded into memory, and the literal default `123456` is rejected.

Pairing failures are rate-limited per remote key. OAuth clients and tokens persist in `stateDir/oauth-store.json`. Authorization codes are short-lived and in memory. Access token TTL is configured by `auth.accessTokenTtlDays`.

OAuth and MCP request bodies are capped by policy HTTP limits.

## Workspace path guards

Workspace paths must be relative. Absolute paths, NUL bytes, `..` escapes, paths outside the workspace, protected paths, symlink targets, and symlink ancestors are rejected where mutation or guarded access is involved.

Default protected patterns include:

- `.git/**`
- `.env`
- `**/.env`
- `**/*.pem`
- `**/id_rsa`
- `**/id_ed25519`
- `node_modules/**`
- `dist/**`
- `build/**`

Custom policies may add or remove patterns, but protected paths should stay conservative for normal use.

## Task guard

The local task runner is intentionally narrower than a shell:

- only known policy task IDs run;
- executable and arguments are fixed by policy;
- cwd must stay inside the workspace;
- package scripts and required files are checked before running;
- raw `extraArgs` are rejected;
- typed `extra` is validated by policy count, allowlist, or regex;
- tasks spawn with `shell: false`;
- stdin is ignored;
- stdout and stderr are captured into bounded logs;
- timeouts send SIGTERM and then SIGKILL.

When a required task is unavailable, route to manual completion instead of inventing command text.

## Change guard

Changesets centralize workspace mutation.

Preview enforces:

- operation schema;
- workspace-relative paths;
- protected-path deny rules;
- symlink ancestor checks;
- text and total size limits;
- duplicate path checks;
- expected sha256 checks for updates, deletes, and renames;
- diff limits;
- high host-risk detection.

Apply enforces:

- required `previewHash`;
- preview hash match;
- high-risk direct-apply block;
- conflict checks;
- snapshot before write;
- rollback on apply failure;
- verification after write.

High-risk previews return a manual route rather than direct apply.

## Git guard

Git mutation is limited to explicit-path commit.

`git.commit_preview` uses a temporary index to preview only requested paths. `git.commit` requires the matching preview hash, stages only the requested paths, refuses empty commits, and commits with `git commit --only`.

The default policies do not expose push, reset-hard, arbitrary checkout, or broad repository mutation tools.

## Manual completion guard

Manual completion is a recovery protocol for host blocks and unavailable fixed capabilities.

`manual.prepare` stores low-risk continuation metadata. `manual.gate` opens a pending barrier with minimal proof fields. While pending, workspace tools are blocked except `diagnostics.health`, `manual.status`, and `manual.resume`.

The manual gate does not carry commands, scripts, diffs, file contents, stdout, stderr, or logs in tool arguments. The user-visible chat message carries the manual instructions.

`manual.resume` accepts only user messages that start with `/resume`. Confirmed resume should be followed by workspace verification before continuing. Cancelled, expired, not found, blocked, and verification-failed resumes do not continue the interrupted request.

## Artifacts

Large diffs and other manual artifacts can be stored in `stateDir` with private file permissions. Download URLs include a token. Only the token hash is stored in metadata, and artifact downloads are audited without logging the plaintext token.

Supported artifact MIME types are limited to text, Markdown, diff, JSON, and octet-stream fallback. Filenames are sanitized.

## Redaction and audit

Redaction covers common bearer tokens, OpenAI/GitHub/AWS secret patterns, private-key blocks, SSH key filenames, and manual artifact tokens.

Audit records can include:

- tool call status and timing;
- input hash and byte count;
- raw output hash and byte count;
- client-visible output hash and byte count;
- selected redacted payloads depending on policy;
- manual prepare/gate/resume events;
- manual artifact downloads;
- recent tool errors.

Large inline audit payloads are replaced with byte count, sha256, head, and tail.

## Generated references

`policies/schema.json` is generated with:

```bash
npm run policy:schema
```

Exact built-in tool input/output schemas are generated from `src/tools/contracts` with:

```bash
npm run generate:tools
```

The generated tool files are reference artifacts. Use them for contract review, but keep human-maintained documentation focused on architecture, workflows, and policy/security behavior.
