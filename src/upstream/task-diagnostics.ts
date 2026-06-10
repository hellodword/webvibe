export type TaskDiagnostic = {
  path: string;
  line: number;
  column?: number;
  message: string;
  severity?: "error" | "warning" | "info";
};

type DiagnosticOutput = {
  head: string;
  tail: string;
  truncated: boolean;
};

type ParserState = {
  currentPath?: string;
  pendingMessage?: string;
  pendingSeverity?: TaskDiagnostic["severity"];
};

export function parseTaskDiagnostics(
  outputs: DiagnosticOutput[],
  limit = 200,
): TaskDiagnostic[] {
  const diagnostics: TaskDiagnostic[] = [];
  const seen = new Set<string>();
  const state: ParserState = {};
  for (const output of outputs) {
    for (const line of outputText(output).split(/\r?\n/)) {
      const diagnostic = parseDiagnosticLine(line, state);
      if (!diagnostic) continue;
      const key = [
        diagnostic.path,
        diagnostic.line,
        diagnostic.column ?? "",
        diagnostic.message,
      ].join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(diagnostic);
      if (diagnostics.length >= limit) return diagnostics;
    }
  }
  return diagnostics;
}

function outputText(output: DiagnosticOutput): string {
  if (!output.truncated || output.head === output.tail) return output.head;
  return `${output.head}\n${output.tail}`;
}

function parseDiagnosticLine(line: string, state: ParserState): TaskDiagnostic | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;

  const rustMessage = trimmed.match(/^(error|warning)(?:\[[^\]]+\])?:\s*(.+)$/i);
  if (rustMessage) {
    state.pendingSeverity = severityFromText(rustMessage[1]);
    state.pendingMessage = rustMessage[2].trim();
    return undefined;
  }

  const typed = trimmed.match(
    /^(error|warning|info)\s+-\s+(.+?):(\d+):(\d+)\s+-\s+(.+)$/i,
  );
  if (typed) {
    return diagnostic({
      path: typed[2],
      line: typed[3],
      column: typed[4],
      message: typed[5],
      severity: severityFromText(typed[1]),
    });
  }

  const ts = trimmed.match(/^(.+?)\((\d+),(\d+)\):\s*(.+)$/);
  if (ts) {
    return diagnostic({
      path: ts[1],
      line: ts[2],
      column: ts[3],
      message: ts[4],
    });
  }

  const rustLocation = trimmed.match(/^-->\s+(.+?):(\d+):(\d+)$/);
  if (rustLocation) {
    return diagnostic({
      path: rustLocation[1],
      line: rustLocation[2],
      column: rustLocation[3],
      message: state.pendingMessage ?? "compiler diagnostic",
      severity: state.pendingSeverity,
    });
  }

  const stackLocation = trimmed.match(
    /(?:^|[\s(])([A-Za-z0-9_@./\\-]+\.[A-Za-z0-9_.-]+):(\d+):(\d+)\)?$/,
  );
  if (stackLocation) {
    return diagnostic({
      path: stackLocation[1],
      line: stackLocation[2],
      column: stackLocation[3],
      message: state.pendingMessage ?? "test failure location",
      severity: state.pendingSeverity,
    });
  }

  const generic = trimmed.match(/(?:^|\s)([A-Za-z0-9_@./\\-]+\.[A-Za-z0-9_.-]+):(\d+):(?:(\d+):)?\s*(.+)$/);
  if (generic) {
    return diagnostic({
      path: generic[1],
      line: generic[2],
      column: generic[3],
      message: generic[4],
    });
  }

  if (looksLikePath(trimmed)) {
    state.currentPath = trimmed;
    return undefined;
  }

  const eslint = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+)$/i);
  if (eslint && state.currentPath) {
    return diagnostic({
      path: state.currentPath,
      line: eslint[1],
      column: eslint[2],
      message: eslint[4],
      severity: severityFromText(eslint[3]),
    });
  }

  state.pendingMessage = trimmed.slice(0, 500);
  state.pendingSeverity = severityFromText(trimmed.match(/\b(error|warning|info)\b/i)?.[1]);
  return undefined;
}

function diagnostic(input: {
  path: string;
  line: string;
  column?: string;
  message: string;
  severity?: TaskDiagnostic["severity"];
}): TaskDiagnostic | undefined {
  const path = input.path.trim().replaceAll("\\", "/");
  if (!path || path.includes("://")) return undefined;
  const line = Number(input.line);
  const column = input.column ? Number(input.column) : undefined;
  if (!Number.isInteger(line) || line < 1) return undefined;
  if (column !== undefined && (!Number.isInteger(column) || column < 1)) return undefined;
  const message = input.message.trim();
  if (!message) return undefined;
  return {
    path,
    line,
    ...(column !== undefined ? { column } : {}),
    message,
    ...(input.severity ? { severity: input.severity } : severityFromMessage(message)),
  };
}

function severityFromMessage(message: string): Pick<TaskDiagnostic, "severity"> {
  const match = message.match(/\b(error|warning|info)\b/i);
  const severity = match ? severityFromText(match[1]) : undefined;
  return severity ? { severity } : {};
}

function severityFromText(text: string | undefined): TaskDiagnostic["severity"] | undefined {
  const normalized = text?.toLowerCase();
  if (normalized === "error" || normalized === "warning" || normalized === "info") {
    return normalized;
  }
  return undefined;
}

function looksLikePath(value: string): boolean {
  return /^[A-Za-z0-9_@./\\-]+\.[A-Za-z0-9_.-]+$/.test(value) && !value.includes("://");
}
