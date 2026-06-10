import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { WorkspacePolicy } from "../../src/policy/policy.js";
import { findExecutable } from "../../src/workspace/inspect/command.js";
import { gitChanged, gitCommitPaths, gitStatus } from "../../src/workspace/inspect/git.js";

const execFileAsync = promisify(execFile);

describe("Git built-ins", () => {
  it("commits only explicit paths and rejects protected paths", async () => {
    const git = await findExecutable("git");
    if (git.status === "missing") return;

    const root = await mkdtemp(path.join(os.tmpdir(), "webvibe-git-"));
    const context = { workspaceRoot: root, workspace: workspace(root) };
    await gitRun(root, ["init"]);
    await gitRun(root, ["config", "user.email", "webvibe@example.test"]);
    await gitRun(root, ["config", "user.name", "webvibe"]);
    await writeFile(path.join(root, "a.txt"), "a1\n");
    await writeFile(path.join(root, "b.txt"), "b1\n");
    await gitRun(root, ["add", "a.txt", "b.txt"]);
    await gitRun(root, ["commit", "-m", "initial"]);

    await writeFile(path.join(root, "a.txt"), "a2\n");
    await writeFile(path.join(root, "b.txt"), "b2\n");
    await gitRun(root, ["add", "b.txt"]);

    await expect(gitCommitPaths({ paths: [".env"], message: "bad" }, context)).rejects.toThrow("protected");
    await expect(gitCommitPaths({ paths: ["a.txt"], message: "update a" }, context)).resolves.toMatchObject({
      status: "ok",
      command: "git commit --only",
    });

    const committedFiles = await gitRun(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(committedFiles.stdout.trim()).toBe("a.txt");
    expect(await readFile(path.join(root, "b.txt"), "utf8")).toBe("b2\n");
    await writeFile(path.join(root, "c.txt"), "c1\n");
    const status = await gitStatus({}, context);
    expect(status.stdout).toContain("b.txt");
    expect(status).toMatchObject({
      branch: expect.any(String),
      head: expect.any(String),
      clean: false,
    });
    const changed = await gitChanged({}, context);
    expect(changed).toMatchObject({
      staged: [expect.objectContaining({ path: "b.txt", index: "M" })],
      untracked: [expect.objectContaining({ path: "c.txt", nameStatus: "??" })],
    });

    await expect(gitCommitPaths({ paths: ["a.txt"], message: "empty" }, context)).resolves.toMatchObject({
      status: "failed",
      unavailableReason: "No changes in explicit paths",
    });
  });
});

async function gitRun(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", args, { cwd });
  return { stdout, stderr };
}

function workspace(root: string): WorkspacePolicy {
  return {
    root,
    protected: [".env", ".git/**"],
  };
}
