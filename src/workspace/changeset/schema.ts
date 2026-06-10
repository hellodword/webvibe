import { z } from "zod";

import { BadRequestError } from "../../util/errors.js";

const sha256Pattern = /^[a-f0-9]{64}$/;

export const manifestInputSchema = z
  .object({
    paths: z.array(z.string()).min(1),
  })
  .strict();

const editSchema = z
  .object({
    oldText: z.string().min(1),
    newText: z.string(),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const jsonPatchOperationSchema = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    path: z.string().min(1),
    value: z.unknown().optional(),
  })
  .strict();

export const changeSchema = z.discriminatedUnion("op", [
  z
    .object({
      op: z.literal("create"),
      path: z.string().min(1),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("write"),
      path: z.string().min(1),
      content: z.string(),
      mode: z.enum(["text"]).optional(),
    })
    .strict(),
  z
    .object({
      op: z.literal("replace"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      op: z.literal("edit"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      edits: z.array(editSchema).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("text_edit"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      edits: z.array(editSchema).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("json_patch"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
      patch: z.array(jsonPatchOperationSchema).min(1),
    })
    .strict(),
  z
    .object({
      op: z.literal("delete"),
      path: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
    })
    .strict(),
  z
    .object({
      op: z.literal("rename"),
      from: z.string().min(1),
      to: z.string().min(1),
      expectedSha256: z.string().regex(sha256Pattern),
    })
    .strict(),
  z
    .object({
      op: z.literal("mkdir"),
      path: z.string().min(1),
    })
    .strict(),
]);

export const changesetInputSchema = z
  .object({
    baseRevision: z.string().min(1).optional(),
    previewHash: z.string().startsWith("sha256:").optional(),
    changes: z.array(changeSchema).min(1),
  })
  .strict();

export type ManifestInput = z.infer<typeof manifestInputSchema>;
export type ParsedChange = z.infer<typeof changeSchema>;
export type ParsedChangeset = z.infer<typeof changesetInputSchema>;

export function parseInput<T>(schema: z.ZodType<T>, rawArgs: unknown): T {
  const parsed = schema.safeParse(rawArgs);
  if (parsed.success) return parsed.data;
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
    .join("; ");
  throw new BadRequestError(message);
}
