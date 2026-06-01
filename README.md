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
npm run dev -- --mode read-only --workspace . --public-base-url http://127.0.0.1:3000 --pairing-code 123456
```
