import type { ToolPolicy } from "./policy.js";
import { BadRequestError } from "../util/errors.js";
import { isJsonObject } from "../util/json-rpc.js";

export function validateJsonSchema(schema: unknown, value: unknown, path = "input"): void {
  if (!isJsonObject(schema)) return;
  const type = schema.type;
  if (type === "object") validateObjectSchema(schema, value, path);
  if (type === "string" && typeof value !== "string")
    throw new BadRequestError(`${path} must be string`);
  if (type === "boolean" && typeof value !== "boolean")
    throw new BadRequestError(`${path} must be boolean`);
  if (type === "number" && typeof value !== "number")
    throw new BadRequestError(`${path} must be number`);
  if (type === "integer" && !Number.isInteger(value))
    throw new BadRequestError(`${path} must be integer`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new BadRequestError(`${path} must be one of enum values`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new BadRequestError(`${path} is below minimum`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new BadRequestError(`${path} is above maximum`);
    }
  }
}

export function assertToolInput(tool: ToolPolicy, args: unknown): Record<string, unknown> {
  const normalized = isJsonObject(args) ? args : {};
  const schema = "inputSchema" in tool ? tool.inputSchema : undefined;
  if (schema) validateJsonSchema(schema, normalized);
  return normalized;
}

function validateObjectSchema(schema: Record<string, unknown>, value: unknown, path: string): void {
  if (!isJsonObject(value)) throw new BadRequestError(`${path} must be object`);
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in value)) {
      throw new BadRequestError(`${path}.${key} is required`);
    }
  }
  const properties = isJsonObject(schema.properties) ? schema.properties : {};
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) throw new BadRequestError(`${path}.${key} is not allowed`);
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (key in value) validateJsonSchema(propertySchema, value[key], `${path}.${key}`);
  }
}
