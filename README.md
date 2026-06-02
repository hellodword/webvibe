# webvibe

`webvibe` is a policy-driven MCP relay for ChatGPT Web. It exposes a stable local
MCP/OAuth surface, connects configured upstream MCP servers, and only publishes
tools allowed by policy.

## Quick Start

```bash
npm install
npm run build
npm test
```

Development server:

```bash
npm run dev -- --config config.yaml
```

For ChatGPT Web vibecoding, use dev mode and let the model read/search first,
then call `repo.file_manifest`, `repo.preview_changeset`, and finally
`repo.apply_changeset`. Default dev mode applies a whole multi-file changeset in
one write tool call instead of exposing per-file write tools.
