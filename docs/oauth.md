# OAuth And Pairing

`webvibe` exposes:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/mcp`

Pairing code rules:

- `--pairing-code` writes `stateDir/pairing-code`.
- `--pairing-code-file` reads an explicit file.
- With neither flag, startup reads `stateDir/pairing-code`.
- If no code exists, startup fails.

OAuth clients and tokens persist in `stateDir/oauth-store.json`. Authorization
codes are short-lived in-memory values. Default access token TTL is 30 days.
