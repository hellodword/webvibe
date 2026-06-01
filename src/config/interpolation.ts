import { BadRequestError } from "../util/errors.js";

export type InterpolationContext = {
  workspaceRoot: string;
  stateDir: string;
  env: NodeJS.ProcessEnv;
  input?: Record<string, unknown>;
  vars?: Record<string, unknown>;
};

export function interpolateString(value: string, context: InterpolationContext): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const trimmed = expression.trim();
    if (shouldDeferExpression(trimmed, context)) return `\${${trimmed}}`;
    const result = evaluateExpression(trimmed, context);
    return Array.isArray(result) ? result.filter(Boolean).join(" ") : String(result ?? "");
  });
}

export function interpolateValue<T>(value: T, context: InterpolationContext): T {
  if (typeof value === "string") {
    const exact = value.match(/^\$\{([^}]+)\}$/);
    if (exact) {
      const expression = exact[1].trim();
      if (shouldDeferExpression(expression, context)) return value;
      return evaluateExpression(expression, context) as T;
    }
    return interpolateString(value, context) as T;
  }
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, context)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolateValue(item, context)]),
    ) as T;
  }
  return value;
}

export function evaluateExpression(expression: string, context: InterpolationContext): unknown {
  const input = context.input ?? {};
  const vars = context.vars ?? {};
  const coalesce = (...values: unknown[]) =>
    values.find((value) => value !== undefined && value !== null);
  const optional = (...values: unknown[]) => {
    if (values.length === 1)
      return values[0] === undefined || values[0] === null || values[0] === "" ? [] : values[0];
    const [prefix, value] = values;
    return value === undefined || value === null || value === "" ? [] : [prefix, value];
  };
  const joinShell = (parts: unknown[]) => flatten(parts).map(shellQuote).join(" ");

  try {
    const fn = new Function(
      "input",
      "vars",
      "workspaceRoot",
      "stateDir",
      "env",
      "coalesce",
      "optional",
      "joinShell",
      `"use strict"; return (${expression});`,
    );
    return fn(
      input,
      vars,
      context.workspaceRoot,
      context.stateDir,
      context.env,
      coalesce,
      optional,
      joinShell,
    );
  } catch {
    throw new BadRequestError(`Invalid interpolation expression: ${expression}`);
  }
}

function flatten(parts: unknown[]): unknown[] {
  return parts
    .flatMap((part) => (Array.isArray(part) ? flatten(part) : part))
    .filter((part) => part !== undefined && part !== null && part !== "");
}

function shellQuote(value: unknown): string {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function shouldDeferExpression(expression: string, context: InterpolationContext): boolean {
  return context.input === undefined && /\b(input|vars)\b/.test(expression);
}
