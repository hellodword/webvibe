import { ForbiddenError } from "../util/errors.js";

export function assertToolAllowed(name: string, registry: Map<string, unknown>): void {
  if (!registry.has(name))
    throw new ForbiddenError(`Tool is not exposed by active policy: ${name}`);
}
