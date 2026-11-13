import { accessSync, constants } from "node:fs";
import path from "node:path";

/**
 * True when `name` is an executable on PATH. Synchronous so it can feed `describe.skipIf(!hasBinary("kepubify"))`
 * (CI may not have kepubify).
 */
export function hasBinary(name: string): boolean {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, name), constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}
