# Security

Security model:

- Default deny: upstream tools are hidden unless policy exposes them.
- Namespacing: public tool names are policy-chosen, not copied automatically.
- Protected paths: path fields are checked against workspace root and protected
  glob patterns.
- Preview/apply: destructive edit tools can require a matching prior preview.
- Output limit: over-limit results are truncated and marked.
- Redaction: common bearer tokens, API keys, cloud secrets, and private keys are
  removed from output/audit material.
- Audit: every `tools/call` writes JSONL with hashes and sizes, not raw inputs.

The relay intentionally does not expose raw arbitrary shell, argv, stdin, kill
process, or Git mutation tools in default policies.
