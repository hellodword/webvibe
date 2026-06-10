import {
  destructiveAnnotations,
  gitCommonOutput,
  gitPaginationFields,
  readOnlyAnnotations,
} from "./common.js";
import {
  arraySchema,
  booleanSchema,
  emptyObjectSchema,
  enumSchema,
  integerSchema,
  nullable,
  objectSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { ToolContract } from "./types.js";

const changedFileSchema = objectSchema(
  {
    path: stringSchema(),
    index: stringSchema(),
    worktree: stringSchema(),
    nameStatus: stringSchema(),
    originalPath: stringSchema(),
  },
  ["path", "index", "worktree", "nameStatus"],
);

const gitCommitInput = objectSchema(
  {
    paths: stringArraySchema({ minItems: 1, maxItems: 1000 }),
    message: stringSchema({ minLength: 1, maxLength: 500 }),
    previewHash: stringSchema({ pattern: "^sha256:[a-f0-9]{64}$" }),
  },
  ["paths", "message", "previewHash"],
);

export const gitContracts: ToolContract[] = [
  {
    name: "git.status",
    modes: ["read-only", "dev"],
    description: "Show concise Git worktree status.",
    annotations: readOnlyAnnotations,
    inputSchema: emptyObjectSchema(),
    outputSchema: gitCommonOutput({
      branch: nullable(stringSchema()),
      head: nullable(stringSchema()),
      upstream: nullable(stringSchema()),
      aheadBehind: objectSchema({
        ahead: integerSchema({ minimum: 0 }),
        behind: integerSchema({ minimum: 0 }),
      }),
      clean: booleanSchema(),
    }),
    examples: [{ name: "status", args: {} }],
    instructionExample: {},
    docsSummary: "Returns branch, head, clean flag, and concise porcelain stdout.",
    risk: "low",
  },
  {
    name: "git.changed",
    modes: ["read-only", "dev"],
    description: "Show changed files.",
    annotations: readOnlyAnnotations,
    inputSchema: emptyObjectSchema(),
    outputSchema: gitCommonOutput({
      staged: arraySchema(changedFileSchema),
      unstaged: arraySchema(changedFileSchema),
      untracked: arraySchema(changedFileSchema),
      changes: arraySchema(changedFileSchema),
    }),
    examples: [{ name: "changed files", args: {} }],
    instructionExample: {},
    docsSummary: "Returns staged, unstaged, untracked, and combined changed path lists.",
    risk: "low",
  },
  {
    name: "git.diff",
    modes: ["read-only", "dev"],
    description: "Show staged or unstaged Git diff for the workspace or one path.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        scope: enumSchema(["unstaged", "staged"]),
        path: stringSchema(),
        maxBytes: integerSchema({ minimum: 1, maximum: 60000 }),
        cursor: stringSchema(),
      },
      [],
    ),
    outputSchema: gitCommonOutput(gitPaginationFields()),
    examples: [{ name: "unstaged diff", args: { scope: "unstaged", maxBytes: 60000 } }],
    instructionExample: { scope: "unstaged", maxBytes: 60000 },
    docsSummary: "Returns bounded staged or unstaged diff stdout with cursor-based byte continuation.",
    risk: "low",
  },
  {
    name: "git.show",
    modes: ["read-only", "dev"],
    description: "Show one Git revision with stat and patch.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        revision: stringSchema({ minLength: 1, maxLength: 200 }),
        path: stringSchema(),
        maxBytes: integerSchema({ minimum: 1, maximum: 60000 }),
        cursor: stringSchema(),
      },
      [],
    ),
    outputSchema: gitCommonOutput(gitPaginationFields()),
    examples: [{ name: "show head", args: { revision: "HEAD", maxBytes: 60000 } }],
    instructionExample: { revision: "HEAD", maxBytes: 60000 },
    docsSummary: "Returns a bounded revision stat and patch with cursor-based byte continuation.",
    risk: "low",
  },
  {
    name: "git.blame",
    modes: ["read-only", "dev"],
    description: "Show Git line blame for a workspace file.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        path: stringSchema(),
        startLine: integerSchema({ minimum: 1 }),
        endLine: integerSchema({ minimum: 1 }),
      },
      ["path"],
    ),
    outputSchema: gitCommonOutput({
      path: stringSchema(),
      startLine: integerSchema({ minimum: 1 }),
      endLine: integerSchema({ minimum: 1 }),
      lines: arraySchema(
        objectSchema(
          {
            commit: stringSchema(),
            line: integerSchema({ minimum: 1 }),
            author: stringSchema(),
            authorTime: integerSchema({ minimum: 0 }),
            content: stringSchema(),
          },
          ["commit", "line", "content"],
        ),
      ),
    }),
    examples: [{ name: "blame first line", args: { path: "README.md", startLine: 1, endLine: 1 } }],
    instructionExample: { path: "README.md", startLine: 1, endLine: 1 },
    docsSummary: "Returns porcelain blame metadata for one workspace file and line range.",
    risk: "low",
  },
  {
    name: "git.commit_preview",
    modes: ["read-only", "dev"],
    description: "Preview an explicit-path Git commit without writing it.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        paths: stringArraySchema({ minItems: 1, maxItems: 1000 }),
      },
      ["paths"],
    ),
    outputSchema: gitCommonOutput({
      paths: stringArraySchema(),
      diff: stringSchema(),
      nameStatus: stringSchema(),
      clean: booleanSchema(),
      previewHash: stringSchema({ pattern: "^sha256:[a-f0-9]{64}$" }),
    }),
    examples: [{ name: "preview commit", args: { paths: ["README.md"] } }],
    instructionExample: { paths: ["README.md"] },
    docsSummary: "Uses a temporary index to preview the exact explicit paths that git.commit can commit.",
    risk: "low",
  },
  {
    name: "git.commit",
    modes: ["dev"],
    description: "Commit only explicit workspace-relative paths with the provided message.",
    annotations: destructiveAnnotations,
    inputSchema: gitCommitInput,
    outputSchema: gitCommonOutput(),
    examples: [
      {
        name: "commit explicit paths",
        args: { paths: ["README.md"], message: "Update README", previewHash: `sha256:${"0".repeat(64)}` },
      },
    ],
    instructionExample: { paths: ["README.md"], message: "Update README", previewHash: `sha256:${"0".repeat(64)}` },
    docsSummary: "Creates a commit only after git.commit_preview returns a matching previewHash.",
    risk: "medium",
  },
];
