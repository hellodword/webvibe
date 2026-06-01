import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Mode } from "../policy/policy.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");

export const defaultPolicyPaths: Record<Mode, string> = {
  "read-only": path.join(projectRoot, "policies", "read-only.yaml"),
  dev: path.join(projectRoot, "policies", "dev.yaml"),
};

export function defaultPublicBaseUrl(listen: string): string {
  return `http://${listen}`;
}
