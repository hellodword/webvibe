import { BadRequestError, ForbiddenError } from "../util/errors.js";

export type PairingOptions = {
  pairingCode?: string;
};

export class PairingManager {
  private failures = new Map<string, { count: number; resetAt: number }>();
  private pairingCode?: string;

  constructor(private readonly options: PairingOptions) {}

  async load(): Promise<string> {
    if (!this.options.pairingCode?.trim()) throw new BadRequestError("Missing auth.pairingCode");
    this.pairingCode = this.options.pairingCode.trim();
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
