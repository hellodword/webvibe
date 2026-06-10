import { UnknownToolSurfaceError } from "../util/errors.js";

export function assertToolAllowed(name: string, registry: Map<string, unknown>): void {
  if (!registry.has(name)) throw new UnknownToolSurfaceError(name);
}
