# Development

Install and verify:

```bash
npm install
npm run build
npm test
npm run lint
```

Run:

```bash
npm run dev -- --mode read-only --workspace . --public-base-url http://127.0.0.1:3000 --pairing-code 123456
```

Custom policy:

```bash
npm run dev -- --mode dev --policy ./my-policy.yaml --workspace . --pairing-code 123456
```

Commit convention:

```text
feat(scope): summary

Scope, verification, and notes.
```
