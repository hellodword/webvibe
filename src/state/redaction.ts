const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(OPENAI_API_KEY\s*[:=]\s*)[^\s"'`,]+/gi,
  /(GITHUB_TOKEN\s*[:=]\s*)[^\s"'`,]+/gi,
  /(AWS_SECRET_ACCESS_KEY\s*[:=]\s*)[^\s"'`,]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(id_rsa|id_ed25519)\b/g,
];

export function redactText(input: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "$1[REDACTED]"), input);
}

export function redactJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactJson(item)]));
  }
  return value;
}
