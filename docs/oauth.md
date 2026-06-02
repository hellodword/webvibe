# OAuth And Pairing

`webvibe` exposes:

- `/.well-known/oauth-authorization-server`
- `/.well-known/oauth-protected-resource`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/mcp`

Pairing code rules:

- `auth.pairingCode` in the config file is required.
- The pairing code is loaded into memory at startup.
- The pairing code is not persisted to `stateDir`.

OAuth clients and tokens persist in `stateDir/oauth-store.json`. Authorization
codes are short-lived in-memory values. Default access token TTL is 30 days.
