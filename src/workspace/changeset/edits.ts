import type { Conflict } from "./types.js";

export function applyTextEdits(
  content: string,
  edits: Array<{ oldText: string; newText: string; replaceAll?: boolean }>,
  relativePath: string,
  conflicts: Conflict[],
): string | undefined {
  let current = content;
  for (const edit of edits) {
    const count = countOccurrences(current, edit.oldText);
    if (count === 0) {
      conflicts.push({ path: relativePath, reason: "Edit text not found" });
      return undefined;
    }
    if (edit.replaceAll !== true && count !== 1) {
      conflicts.push({ path: relativePath, reason: "Edit text matched more than once" });
      return undefined;
    }
    current =
      edit.replaceAll === true
        ? current.split(edit.oldText).join(edit.newText)
        : current.replace(edit.oldText, edit.newText);
  }
  return current;
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const found = text.indexOf(needle, index);
    if (found === -1) return count;
    count += 1;
    index = found + needle.length;
  }
  return count;
}
