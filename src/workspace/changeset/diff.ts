export function unifiedDiff(
  relativePath: string,
  before: string | undefined,
  after: string | undefined,
): string {
  const beforeLines = before === undefined ? [] : splitLines(before);
  const afterLines = after === undefined ? [] : splitLines(after);
  return [
    `--- ${before === undefined ? "/dev/null" : `a/${relativePath}`}`,
    `+++ ${after === undefined ? "/dev/null" : `b/${relativePath}`}`,
    "@@",
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
  ].join("\n");
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
}
