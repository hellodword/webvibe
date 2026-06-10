import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { minimatch } from "minimatch";

import { BadRequestError } from "../../util/errors.js";
import type { InspectWorkspaceContext } from "./path.js";
import { isProtectedPath } from "./path.js";

type SymbolEntry = {
  name: string;
  kind: "class" | "function" | "method" | "type" | "interface" | "const" | "enum" | "import";
  path: string;
  line: number;
  exported: boolean;
};

type SymbolCursor = {
  tool: "workspace.symbols";
  offset: number;
};

const METHOD_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "constructor",
]);

export async function workspaceSymbols(
  args: Record<string, unknown>,
  context: InspectWorkspaceContext,
): Promise<{
  status: "ok";
  symbols: SymbolEntry[];
  imports: Array<{ path: string; source: string; line: number }>;
  truncated: boolean;
  nextCursor: string | null;
}> {
  const query = typeof args.query === "string" && args.query.length > 0 ? args.query.toLowerCase() : undefined;
  const kind = typeof args.kind === "string" && args.kind.length > 0 ? args.kind : undefined;
  const include = typeof args.path === "string" && args.path.length > 0 ? args.path : "**/*.{ts,tsx,js,jsx,mjs,cjs}";
  const maxResults = boundedInteger(args.maxResults, 200, 1, 1000);
  const offset = decodeCursor(args.cursor);
  const files = await symbolFiles(context.workspaceRoot, ".", context, include);
  const allSymbols: SymbolEntry[] = [];
  const imports: Array<{ path: string; source: string; line: number }> = [];
  for (const file of files) {
    const text = await readFile(path.join(context.workspaceRoot, file), "utf8");
    const parsed = parseSymbols(file, text);
    allSymbols.push(...parsed.symbols);
    imports.push(...parsed.imports);
  }
  const filtered = allSymbols.filter((symbol) => {
    if (query && !symbol.name.toLowerCase().includes(query)) return false;
    if (kind && symbol.kind !== kind) return false;
    return true;
  });
  const page = filtered.slice(offset, offset + maxResults);
  const truncated = offset + maxResults < filtered.length;
  return {
    status: "ok",
    symbols: page,
    imports,
    truncated,
    nextCursor: truncated ? encodeCursor(offset + page.length) : null,
  };
}

async function symbolFiles(
  workspaceRoot: string,
  relativeDir: string,
  context: InspectWorkspaceContext,
  include: string,
): Promise<string[]> {
  const absoluteDir = path.join(workspaceRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = relativeDir === "." ? entry.name : `${relativeDir}/${entry.name}`;
    if (isProtectedPath(relativePath, context.workspace.protected)) continue;
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      files.push(...(await symbolFiles(workspaceRoot, relativePath, context, include)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (minimatch(relativePath, include, { dot: true, nocase: process.platform === "win32" })) {
      files.push(relativePath);
    }
  }
  return files;
}

function parseSymbols(
  relativePath: string,
  text: string,
): {
  symbols: SymbolEntry[];
  imports: Array<{ path: string; source: string; line: number }>;
} {
  const symbols: SymbolEntry[] = [];
  const imports: Array<{ path: string; source: string; line: number }> = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const importMatch = /^\s*import\s+(?:.+?\s+from\s+)?["'](.+?)["']/.exec(line);
    if (importMatch) {
      imports.push({ path: relativePath, source: importMatch[1], line: lineNumber });
      symbols.push(symbol(relativePath, lineNumber, importMatch[1], "import", false));
      continue;
    }
    const declaration =
      /^\s*(export\s+)?(?:default\s+)?(class|function|interface|type|enum|const)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (declaration) {
      symbols.push(
        symbol(
          relativePath,
          lineNumber,
          declaration[3],
          declarationKind(declaration[2]),
          Boolean(declaration[1]),
        ),
      );
      continue;
    }
    const method = /^\s*(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(line);
    if (method && !METHOD_KEYWORDS.has(method[1])) {
      symbols.push(symbol(relativePath, lineNumber, method[1], "method", false));
    }
  }
  return { symbols, imports };
}

function declarationKind(value: string): SymbolEntry["kind"] {
  if (value === "class") return "class";
  if (value === "function") return "function";
  if (value === "interface") return "interface";
  if (value === "type") return "type";
  if (value === "enum") return "enum";
  return "const";
}

function symbol(
  relativePath: string,
  line: number,
  name: string,
  kind: SymbolEntry["kind"],
  exported: boolean,
): SymbolEntry {
  return { name, kind, path: relativePath, line, exported };
}

function boundedInteger(value: unknown, defaultValue: number, minimum: number, maximum: number): number {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BadRequestError("numeric option must be integer");
  }
  if (value < minimum) throw new BadRequestError("numeric option is below minimum");
  if (value > maximum) throw new BadRequestError("numeric option is above maximum");
  return value;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ tool: "workspace.symbols", offset } satisfies SymbolCursor), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "string") throw new BadRequestError("cursor must be string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new BadRequestError("cursor is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestError("cursor is invalid");
  }
  const record = parsed as Record<string, unknown>;
  if (record.tool !== "workspace.symbols" || !Number.isInteger(record.offset) || (record.offset as number) < 0) {
    throw new BadRequestError("cursor is invalid");
  }
  return record.offset as number;
}
