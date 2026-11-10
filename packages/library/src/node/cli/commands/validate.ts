/** `elib validate [--json]`: checks data/ (same as `pnpm validate:data`). Exit 1 on errors. */
import path from "node:path";
import { validateData } from "../../site-data/index.ts";
import type { CliCommand } from "../program.ts";

export const validateCommand: CliCommand = {
  register(program, ctx) {
    program
      .command("validate")
      .description("Validate data/ (schemas, topics, allowed files, no file identifiers)")
      .option("--json", "print the result as JSON")
      .action(async (options: { json?: boolean }) => {
        const { dataDir } = ctx.config();
        const result = await validateData(dataDir);
        if (options.json) {
          ctx.out(JSON.stringify(result, null, 2));
        } else {
          const where = (p?: string) => (p ? `${path.join(path.basename(dataDir), p)}: ` : "");
          for (const w of result.warnings) ctx.out(`warning: ${where(w.path)}${w.message}`);
          for (const e of result.errors) ctx.out(`error: ${where(e.path)}${e.message}`);
          ctx.out(`${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
        }
        if (result.errors.length > 0) ctx.fail(1);
      });
  },
};
