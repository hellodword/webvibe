import {
  readFileOutputItemSchema,
  readOnlyAnnotations,
  rangeSchema,
} from "./common.js";
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  hostRiskSchema,
  integerSchema,
  nullable,
  numberSchema,
  objectSchema,
  oneOf,
  recordSchema,
  stringArraySchema,
  stringSchema,
} from "./schemas.js";
import type { JsonSchema, ToolContract } from "./types.js";

const treeMode = enumSchema(["all", "files", "dirs", "packages", "git-tracked"]);
const readFormat = enumSchema(["content", "lines"]);
const fsEntryType = enumSchema(["directory", "file", "symlink", "other"]);
const searchCase = enumSchema(["smart", "sensitive", "insensitive"]);

function globArray(): JsonSchema {
  return stringArraySchema();
}

function readRequestFields(): Record<string, unknown> {
  return {
    byteOffset: integerSchema({ minimum: 0 }),
    range: rangeSchema(),
    maxBytes: integerSchema({ minimum: 1, maximum: 131072 }),
    format: readFormat,
  };
}

const readManySimple = objectSchema(
  {
    paths: stringArraySchema({ minItems: 1, maxItems: 50 }),
    ...readRequestFields(),
  },
  ["paths"],
);

const readManyAdvanced = objectSchema(
  {
    files: arraySchema(
      objectSchema(
        {
          path: stringSchema(),
          ...readRequestFields(),
        },
        ["path"],
      ),
      { minItems: 1, maxItems: 50 },
    ),
    maxBytesPerFile: integerSchema({ minimum: 1, maximum: 131072 }),
  },
  ["files"],
);

const manifestItem = objectSchema(
  {
    path: stringSchema(),
    exists: booleanSchema(),
    type: enumSchema(["file", "directory", "symlink", "other", "missing"]),
    sizeBytes: integerSchema({ minimum: 0 }),
    mtimeMs: numberSchema({ minimum: 0 }),
    sha256: stringSchema({ pattern: "^[a-f0-9]{64}$" }),
  },
  ["path", "exists"],
);

export const fsContracts: ToolContract[] = [
  {
    name: "fs.tree",
    modes: ["read-only", "dev"],
    description: "Return a bounded workspace file tree while skipping protected paths.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        path: stringSchema(),
        mode: treeMode,
        include: globArray(),
        exclude: globArray(),
        respectGitignore: booleanSchema(),
        includeHidden: booleanSchema(),
        includeIgnored: booleanSchema(),
        maxDepth: integerSchema({ minimum: 0, maximum: 12 }),
        maxEntries: integerSchema({ minimum: 1, maximum: 5000 }),
        cursor: stringSchema(),
      },
      [],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      root: stringSchema(),
      entries: arraySchema(
        objectSchema(
          {
            path: stringSchema(),
            type: fsEntryType,
            size: integerSchema({ minimum: 0 }),
          },
          ["path", "type"],
        ),
      ),
      skipped: objectSchema({
        protected: integerSchema({ minimum: 0 }),
        missing: integerSchema({ minimum: 0 }),
      }),
      stats: objectSchema({
        filesSeen: integerSchema({ minimum: 0 }),
        dirsSeen: integerSchema({ minimum: 0 }),
        protectedSkipped: integerSchema({ minimum: 0 }),
      }),
      omitted: arraySchema(
        objectSchema({
          path: stringSchema(),
          reason: stringSchema(),
        }),
      ),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
      effectiveOptions: objectSchema({
        mode: treeMode,
        include: globArray(),
        exclude: globArray(),
        respectGitignore: booleanSchema(),
        includeHidden: booleanSchema(),
        includeIgnored: booleanSchema(),
        maxDepth: integerSchema({ minimum: 0 }),
        maxEntries: integerSchema({ minimum: 1 }),
        cursorOffset: integerSchema({ minimum: 0 }),
      }),
    }),
    examples: [{ name: "tree root", args: { path: ".", maxDepth: 3, maxEntries: 500 } }],
    instructionExample: { path: ".", maxDepth: 3, maxEntries: 500 },
    docsSummary: "Lists files and directories with maxDepth, maxEntries, include/exclude, hidden, ignored, and cursor controls.",
    risk: "low",
  },
  {
    name: "fs.search",
    modes: ["read-only", "dev"],
    description: "Search workspace text while skipping protected paths.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        query: stringSchema({ minLength: 1, maxLength: 500 }),
        mode: enumSchema(["fixed", "regex"]),
        path: stringSchema(),
        include: globArray(),
        exclude: globArray(),
        case: searchCase,
        contextLines: integerSchema({ minimum: 0, maximum: 5 }),
        maxResults: integerSchema({ minimum: 1, maximum: 1000 }),
        maxColumns: integerSchema({ minimum: 1, maximum: 300 }),
        respectGitignore: booleanSchema(),
        includeHidden: booleanSchema(),
        includeIgnored: booleanSchema(),
        cursor: stringSchema(),
      },
      ["query"],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      query: stringSchema(),
      mode: enumSchema(["fixed", "regex"]),
      case: searchCase,
      matches: arraySchema(
        objectSchema({
          path: stringSchema(),
          line: integerSchema({ minimum: 1 }),
          column: integerSchema({ minimum: 1 }),
          text: stringSchema(),
          submatches: arraySchema(objectSchema({ start: integerSchema({ minimum: 0 }), end: integerSchema({ minimum: 0 }) })),
          before: stringArraySchema(),
          after: stringArraySchema(),
        }),
      ),
      searchedFiles: integerSchema({ minimum: 0 }),
      skipped: objectSchema(
        {
          protected: integerSchema({ minimum: 0 }),
          binary: integerSchema({ minimum: 0 }),
          tooLarge: integerSchema({ minimum: 0 }),
          missing: integerSchema({ minimum: 0 }),
          permissionDenied: integerSchema({ minimum: 0 }),
        },
        ["protected", "binary", "tooLarge", "missing"],
      ),
      truncated: booleanSchema(),
      nextCursor: nullable(stringSchema()),
      engine: enumSchema(["rg", "js"]),
      effectiveOptions: objectSchema({
        mode: enumSchema(["fixed", "regex"]),
        case: searchCase,
        caseSensitive: booleanSchema(),
        include: globArray(),
        exclude: globArray(),
        contextLines: integerSchema({ minimum: 0 }),
        maxColumns: integerSchema({ minimum: 1 }),
        maxResults: integerSchema({ minimum: 1 }),
        cursorOffset: integerSchema({ minimum: 0 }),
        respectGitignore: booleanSchema(),
        includeHidden: booleanSchema(),
        includeIgnored: booleanSchema(),
      }),
    }),
    examples: [{ name: "search source", args: { query: "ToolRouter", path: "src", maxResults: 20 } }],
    instructionExample: { query: "TODO", path: "src", maxResults: 20 },
    docsSummary: "Searches text with fixed or regex mode, include/exclude globs, context lines, and gitignore/hidden/ignored controls.",
    risk: "low",
  },
  {
    name: "fs.read",
    modes: ["read-only", "dev"],
    description: "Read one workspace file in a bounded UTF-8 byte chunk.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        path: stringSchema(),
        ...readRequestFields(),
      },
      ["path"],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      files: arraySchema(readFileOutputItemSchema()),
      effectiveOptions: recordSchema(),
    }),
    examples: [{ name: "read file", args: { path: "README.md", maxBytes: 60000 } }],
    instructionExample: { path: "README.md", maxBytes: 60000 },
    docsSummary: "Reads one file by byteOffset or line range. Use nextOffsetBytes as byteOffset for continuation.",
    risk: "low",
  },
  {
    name: "fs.read_many",
    modes: ["read-only", "dev"],
    description: "Read multiple workspace files in bounded UTF-8 byte chunks.",
    annotations: readOnlyAnnotations,
    inputSchema: oneOf([readManySimple, readManyAdvanced]),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      files: arraySchema(readFileOutputItemSchema()),
      effectiveOptions: recordSchema(),
    }),
    examples: [
      {
        name: "read common project files",
        args: { paths: ["README.md", "package.json"], maxBytes: 60000 },
      },
    ],
    instructionExample: { paths: ["README.md", "package.json"], maxBytes: 60000 },
    docsSummary: "Reads several files either with simple paths plus shared options or advanced per-file options.",
    risk: "low",
  },
  {
    name: "fs.stat",
    modes: ["read-only", "dev"],
    description: "Return metadata for one or more workspace paths.",
    annotations: readOnlyAnnotations,
    inputSchema: {
      ...objectSchema(
        {
          path: stringSchema(),
          paths: stringArraySchema({ minItems: 1, maxItems: 100 }),
        },
        [],
      ),
      anyOf: [
        { properties: { path: stringSchema() }, required: ["path"] },
        { properties: { paths: stringArraySchema({ minItems: 1, maxItems: 100 }) }, required: ["paths"] },
      ],
    },
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      files: arraySchema(
        objectSchema(
          {
            path: stringSchema(),
            exists: booleanSchema(),
            type: fsEntryType,
            kind: enumSchema(["text", "binary"]),
            size: integerSchema({ minimum: 0 }),
            sha256: stringSchema({ pattern: "^[a-f0-9]{64}$" }),
            modifiedAt: stringSchema(),
            createdAt: stringSchema(),
          },
          ["path", "exists"],
        ),
      ),
    }),
    examples: [{ name: "stat files", args: { paths: ["package.json"] } }],
    instructionExample: { paths: ["package.json"] },
    docsSummary: "Returns existence, type, size, hashes, and timestamps for up to 100 paths.",
    risk: "low",
  },
  {
    name: "fs.manifest",
    modes: ["read-only", "dev"],
    description: "Return manifest entries with hashes for workspace paths.",
    annotations: readOnlyAnnotations,
    inputSchema: objectSchema(
      {
        paths: stringArraySchema({ minItems: 1, maxItems: 1000 }),
      },
      ["paths"],
    ),
    outputSchema: objectSchema({
      status: enumSchema(["ok"]),
      hostRisk: hostRiskSchema(),
      files: arraySchema(manifestItem),
    }),
    examples: [{ name: "manifest package", args: { paths: ["package.json"] } }],
    instructionExample: { paths: ["package.json"] },
    docsSummary: "Returns hash-ready manifest entries using sizeBytes, mtimeMs, and sha256 for files.",
    risk: "low",
  },
];
