import path from "node:path";

import { BadRequestError, ForbiddenError } from "../util/errors.js";
import { readTextIfExists, resolvePath, writeFileAtomic } from "../util/paths.js";

export type PairingOptions = {
  stateDir: string;
  pairingCode?: string;
  pairingCodeFile?: string;
};

export class PairingManager {
  private failures = new Map<string, { count: number; resetAt: number }>();
  private pairingCode?: string;

  constructor(private readonly options: PairingOptions) {}

  async load(): Promise<string> {
    if (this.options.pairingCode) {
      this.pairingCode = this.options.pairingCode;
      await writeFileAtomic(
        path.join(this.options.stateDir, "pairing-code"),
        `${this.pairingCode}\n`,
      );
      return this.pairingCode;
    }
    if (this.options.pairingCodeFile) {
      const filePath = resolvePath(this.options.pairingCodeFile);
      const value = await readTextIfExists(filePath);
      if (!value?.trim()) throw new BadRequestError(`Pairing code file is empty: ${filePath}`);
      this.pairingCode = value.trim();
      return this.pairingCode;
    }
    const stateValue = await readTextIfExists(path.join(this.options.stateDir, "pairing-code"));
    if (!stateValue?.trim()) {
      throw new BadRequestError(
        "Missing pairing code. Pass --pairing-code or --pairing-code-file.",
      );
    }
    this.pairingCode = stateValue.trim();
    return this.pairingCode;
  }

  verify(input: string | undefined, key: string): void {
    this.assertNotRateLimited(key);
    if (!this.pairingCode || input !== this.pairingCode) {
      this.recordFailure(key);
      throw new ForbiddenError("Invalid pairing code");
    }
    this.failures.delete(key);
  }

  getCodeForTests(): string | undefined {
    return this.pairingCode;
  }

  private assertNotRateLimited(key: string): void {
    const record = this.failures.get(key);
    if (!record) return;
    if (Date.now() > record.resetAt) {
      this.failures.delete(key);
      return;
    }
    if (record.count >= 5) throw new ForbiddenError("Too many pairing attempts");
  }

  private recordFailure(key: string): void {
    const current = this.failures.get(key);
    this.failures.set(key, {
      count: (current?.count ?? 0) + 1,
      resetAt: current?.resetAt ?? Date.now() + 60_000,
    });
  }
}
