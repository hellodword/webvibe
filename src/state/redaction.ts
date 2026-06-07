const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /(OPENAI_API_KEY\s*[:=]\s*)[^\s"'`,]+/gi,
  /(GITHUB_TOKEN\s*[:=]\s*)[^\s"'`,]+/gi,
  /(AWS_SECRET_ACCESS_KEY\s*[:=]\s*)[^\s"'`,]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(id_rsa|id_ed25519)\b/g,
];

const MANUAL_TOKEN_PATTERNS: RegExp[] = [
  /([?&]t=)[A-Za-z0-9._~-]+/g,
];

export type RedactionOptions = {
  redactManualTokens?: boolean;
};

export function redactText(input: string, options: RedactionOptions = {}): string {
  const withoutSecrets = SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "$1[REDACTED]"),
    input,
  );
  return options.redactManualTokens
    ? MANUAL_TOKEN_PATTERNS.reduce(
        (text, pattern) => text.replace(pattern, "$1[REDACTED]"),
        withoutSecrets,
      )
    : withoutSecrets;
}

export function redactJson(value: unknown, options: RedactionOptions = {}): unknown {
  if (typeof value === "string") return redactText(value, options);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, options));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        options.redactManualTokens && /confirmToken|downloadToken/i.test(key)
          ? "[REDACTED]"
          : redactJson(item, options),
      ]),
    );
  }
  return value;
}
