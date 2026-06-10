import {
  changeHashSchema,
  destructiveAnnotations,
  mediumWriteAnnotations,
  sha256Schema,
} from "./common.js";
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  envelopeSchema,
  hostRiskSchema,
  objectSchema,
  recordSchema,
  stringSchema,
} from "./schemas.js";
import type { JsonSchema, ToolContract } from "./types.js";

const editItemSchema = objectSchema(
  {
    oldText: stringSchema({ minLength: 1 }),
    newText: stringSchema(),
    replaceAll: booleanSchema(),
  },
  ["oldText", "newText"],
);

const jsonPatchItemSchema = objectSchema(
  {
    op: enumSchema(["add", "replace", "remove"]),
    path: stringSchema({ minLength: 1 }),
    value: true,
  },
  ["op", "path"],
);

function changeItemSchemas(): JsonSchema[] {
  return [
    objectSchema(
      { op: { const: "create" }, path: stringSchema({ minLength: 1 }), content: stringSchema() },
      ["op", "path", "content"],
    ),
    objectSchema(
      {
        op: { const: "write" },
        path: stringSchema({ minLength: 1 }),
        content: stringSchema(),
        mode: enumSchema(["text"]),
      },
      ["op", "path", "content"],
    ),
    objectSchema(
      {
        op: { const: "replace" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
        content: stringSchema(),
      },
      ["op", "path", "expectedSha256", "content"],
    ),
    objectSchema(
      {
        op: { const: "edit" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
        edits: arraySchema(editItemSchema, { minItems: 1 }),
      },
      ["op", "path", "expectedSha256", "edits"],
    ),
    objectSchema(
      {
        op: { const: "text_edit" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
        edits: arraySchema(editItemSchema, { minItems: 1 }),
      },
      ["op", "path", "expectedSha256", "edits"],
    ),
    objectSchema(
      {
        op: { const: "json_patch" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
        patch: arraySchema(jsonPatchItemSchema, { minItems: 1 }),
      },
      ["op", "path", "expectedSha256", "patch"],
    ),
    objectSchema(
      {
        op: { const: "unified_diff" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
        diff: stringSchema({ minLength: 1 }),
      },
      ["op", "path", "expectedSha256", "diff"],
    ),
    objectSchema(
      {
        op: { const: "delete" },
        path: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
      },
      ["op", "path", "expectedSha256"],
    ),
    objectSchema(
      {
        op: { const: "rename" },
        from: stringSchema({ minLength: 1 }),
        to: stringSchema({ minLength: 1 }),
        expectedSha256: sha256Schema(),
      },
      ["op", "from", "to", "expectedSha256"],
    ),
    objectSchema(
      {
        op: { const: "mkdir" },
        path: stringSchema({ minLength: 1 }),
      },
      ["op", "path"],
    ),
  ];
}

const singleChangeInput = objectSchema(
  {
    baseRevision: stringSchema({ minLength: 1 }),
    changes: arraySchema({ oneOf: changeItemSchemas() }, { minItems: 1, maxItems: 1 }),
  },
  ["changes"],
);

const singleChangeApplyInput = objectSchema(
  {
    baseRevision: stringSchema({ minLength: 1 }),
    previewHash: changeHashSchema(),
    changes: arraySchema({ oneOf: changeItemSchemas() }, { minItems: 1, maxItems: 1 }),
  },
  ["previewHash", "changes"],
);

const batchChangeInput = objectSchema(
  {
    baseRevision: stringSchema({ minLength: 1 }),
    changes: arraySchema({ oneOf: changeItemSchemas() }, { minItems: 1 }),
  },
  ["changes"],
);

const batchChangeApplyInput = objectSchema(
  {
    baseRevision: stringSchema({ minLength: 1 }),
    previewHash: changeHashSchema(),
    changes: arraySchema({ oneOf: changeItemSchemas() }, { minItems: 1 }),
  },
  ["previewHash", "changes"],
);

const previewDataSchema = objectSchema(
  {
    valid: booleanSchema(),
    status: enumSchema(["ok", "conflicted"]),
    previewId: stringSchema(),
    baseRevision: stringSchema(),
    base: recordSchema(),
    summary: recordSchema(),
    files: arraySchema(recordSchema()),
    diff: stringSchema(),
    diffInfo: recordSchema(),
    conflicts: arraySchema(recordSchema()),
    warnings: arraySchema(recordSchema()),
    artifacts: arraySchema(recordSchema()),
    previewHash: changeHashSchema(),
    changeHash: changeHashSchema(),
    hostRisk: hostRiskSchema(),
    risk: recordSchema(),
    manualPlan: recordSchema(),
  },
  [
    "valid",
    "status",
    "previewId",
    "base",
    "summary",
    "files",
    "diff",
    "diffInfo",
    "conflicts",
    "warnings",
    "artifacts",
    "previewHash",
    "changeHash",
    "hostRisk",
    "risk",
  ],
);

const applyOutputSchema = objectSchema(
  {
    status: enumSchema(["blocked"]),
    applied: booleanSchema(),
    verified: booleanSchema(),
    verification: recordSchema(),
    baseRevision: stringSchema(),
    base: recordSchema(),
    summary: recordSchema(),
    files: arraySchema(recordSchema()),
    conflicts: arraySchema(recordSchema()),
    previewHash: changeHashSchema(),
    hostRisk: hostRiskSchema(),
    risk: recordSchema(),
    manualPlan: recordSchema(),
  },
  ["applied", "verified", "verification", "base", "summary", "files", "conflicts", "hostRisk", "risk"],
);

function changeContractsFor(inputSchema: JsonSchema, applyInputSchema: JsonSchema, names: [string, string], batch: boolean): ToolContract[] {
  const [previewName, applyName] = names;
  return [
    {
      name: previewName,
      modes: ["dev"],
      description: batch
        ? "Validate and diff a batch workspace change."
        : "Validate and diff one logical workspace file change.",
      annotations: mediumWriteAnnotations,
      inputSchema,
      outputSchema: envelopeSchema(previewDataSchema),
      examples: [
        {
          name: "preview text edit",
          args: {
            changes: [
              {
                op: "edit",
                path: "README.md",
                expectedSha256: "0".repeat(64),
                edits: [{ oldText: "old", newText: "new" }],
              },
            ],
          },
        },
      ],
      instructionExample: {
        changes: [
          {
            op: "edit",
            path: "README.md",
            expectedSha256: "0".repeat(64),
            edits: [{ oldText: "old", newText: "new" }],
          },
        ],
      },
      docsSummary: batch
        ? "Previews a policy-enabled batch changeset and returns an envelope with preview data."
        : "Previews exactly one logical file change and returns an envelope with preview data.",
      risk: "medium",
    },
    {
      name: applyName,
      modes: ["dev"],
      description: batch
        ? "Apply a batch workspace change after preview."
        : "Apply one logical workspace file change after preview.",
      annotations: destructiveAnnotations,
      inputSchema: applyInputSchema,
      outputSchema: applyOutputSchema,
      examples: [
        {
          name: "apply text edit",
          args: {
            previewHash: `sha256:${"0".repeat(64)}`,
            changes: [
              {
                op: "edit",
                path: "README.md",
                expectedSha256: "0".repeat(64),
                edits: [{ oldText: "old", newText: "new" }],
              },
            ],
          },
        },
      ],
      instructionExample: {
        previewHash: `sha256:${"0".repeat(64)}`,
        changes: [
          {
            op: "edit",
            path: "README.md",
            expectedSha256: "0".repeat(64),
            edits: [{ oldText: "old", newText: "new" }],
          },
        ],
      },
      docsSummary: batch
        ? "Applies a previously previewed batch changeset with a matching previewHash."
        : "Applies exactly one previously previewed logical file change with a matching previewHash.",
      risk: "medium",
    },
  ];
}

export const changeContracts: ToolContract[] = [
  ...changeContractsFor(singleChangeInput, singleChangeApplyInput, ["file.change_preview", "file.change_apply"], false),
  ...changeContractsFor(batchChangeInput, batchChangeApplyInput, ["batch.change_preview", "batch.change_apply"], true),
  ...changeContractsFor(batchChangeInput, batchChangeApplyInput, ["change.preview", "change.apply"], true),
];
