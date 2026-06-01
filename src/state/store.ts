import path from "node:path";

import { writeFileAtomic } from "../util/paths.js";

export class StateStore {
  constructor(readonly stateDir: string) {}

  path(...parts: string[]): string {
    return path.join(this.stateDir, ...parts);
  }

  async writeJson(fileName: string, value: unknown): Promise<void> {
    await writeFileAtomic(this.path(fileName), `${JSON.stringify(value, null, 2)}\n`);
  }
}
