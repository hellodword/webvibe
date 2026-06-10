import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import type { ToolPolicy } from "./policy.js";
import { contractForTool } from "../tools/contracts/index.js";
import { BadRequestError } from "../util/errors.js";
import { isJsonObject } from "../util/json-rpc.js";

const maxSchemaBytes = 512 * 1024;
const maxSchemaDepth = 64;
const maxPatternLength = 500;
const validatorCache = new WeakMap<object, ValidateFunction>();

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateSchema: true,
});

for (const keyword of ["enumDescriptions", "markdownDescription"]) {
  try {
    ajv.addKeyword({ keyword, schemaType: ["array", "string"] });
  } catch {
    // Already registered by the active Ajv build.
  }
}

export function validateJsonSchema(schema: unknown, value: unknown, path = "input"): void {
  if (typeof schema === "boolean") {
    if (!schema) throw new BadRequestError(`${path} is not allowed`);
    return;
  }
  if (!isJsonObject(schema)) return;
  const validate = compileValidator(schema, path);
  if (validate(value)) return;
  throw new BadRequestError(formatAjvError(validate.errors?.[0], path));
}

export function assertToolInput(tool: ToolPolicy, args: unknown): Record<string, unknown> {
  const normalized = isJsonObject(args) ? args : {};
  const schema =
    tool.type === "builtIn"
      ? contractForTool(tool.name)?.inputSchema
      : "inputSchema" in tool
        ? tool.inputSchema
        : undefined;
  if (schema) validateJsonSchema(schema, normalized, "input");
  return normalized;
}

export function assertToolOutput(schema: unknown, output: unknown): void {
  if (schema) validateJsonSchema(schema, output, "output");
}

function compileValidator(schema: Record<string, unknown>, path: string): ValidateFunction {
  const cached = validatorCache.get(schema);
  if (cached) return cached;
  assertSchemaConstraints(schema, path);
  try {
    const validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
    return validate;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestError(`${path} schema is invalid: ${message}`);
  }
}

function assertSchemaConstraints(schema: unknown, path: string): void {
  const stats = walkSchema(schema, path, 0, { bytes: Buffer.byteLength(JSON.stringify(schema), "utf8") });
  if (stats.bytes > maxSchemaBytes) {
    throw new BadRequestError(`${path} schema is too large`);
  }
}

function walkSchema(
  value: unknown,
  path: string,
  depth: number,
  stats: { bytes: number },
): { bytes: number } {
  if (depth > maxSchemaDepth) throw new BadRequestError(`${path} schema is too deep`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSchema(item, `${path}[${index}]`, depth + 1, stats));
    return stats;
  }
  if (!isJsonObject(value)) return stats;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "$ref" && typeof child === "string" && !child.startsWith("#")) {
      throw new BadRequestError(`${childPath} remote refs are not allowed`);
    }
    if (key === "pattern" && typeof child === "string") assertSafePattern(child, childPath);
    walkSchema(child, childPath, depth + 1, stats);
  }
  return stats;
}

function assertSafePattern(pattern: string, path: string): void {
  if (pattern.length > maxPatternLength) {
    throw new BadRequestError(`${path} pattern is too large`);
  }
  if (/(?:\([^)]*[+*][^)]*\)|\[[^\]]+[+*][^\]]*\])[+*{]/.test(pattern)) {
    throw new BadRequestError(`${path} pattern is too complex`);
  }
  if (/\\[1-9]/.test(pattern)) {
    throw new BadRequestError(`${path} pattern backreferences are not allowed`);
  }
}

function formatAjvError(error: ErrorObject | undefined, rootPath: string): string {
  if (!error) return `${rootPath} failed schema validation`;
  const location = pointerToPath(rootPath, error.instancePath);
  switch (error.keyword) {
    case "additionalProperties": {
      const key = stringParam(error.params, "additionalProperty");
      return key ? `${location}.${key} is not allowed` : `${location} has unknown properties`;
    }
    case "required": {
      const key = stringParam(error.params, "missingProperty");
      return key ? `${location}.${key} is required` : `${location} is missing required fields`;
    }
    case "type":
      return `${location} must be ${String((error.params as { type?: unknown }).type ?? "valid type")}`;
    case "enum":
      return `${location} must be one of enum values`;
    case "minLength":
      return `${location} is below minimum length`;
    case "maxLength":
      return `${location} is above maximum length`;
    case "minimum":
      return `${location} is below minimum`;
    case "maximum":
      return `${location} is above maximum`;
    case "minItems":
      return `${location} has too few items`;
    case "maxItems":
      return `${location} has too many items`;
    case "pattern":
      return `${location} does not match pattern`;
    case "const":
      return `${location} must equal required constant`;
    case "oneOf":
    case "anyOf":
    case "allOf":
      return `${location} must match schema`;
    default:
      return `${location} ${error.message ?? "failed schema validation"}`;
  }
}

function pointerToPath(rootPath: string, pointer: string): string {
  if (!pointer) return rootPath;
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  return parts.reduce((acc, part) => (/^\d+$/.test(part) ? `${acc}[${part}]` : `${acc}.${part}`), rootPath);
}

function stringParam(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}
