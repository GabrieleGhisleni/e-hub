/**
 * kepubify wrapper: EPUB → KEPUB (the format the Kobo reads best, PLAN §6).
 *
 * kepubify 5 gotcha: `-o <path>` that does not end in `.kepub.epub` makes it copy the EPUB unchanged, and an input
 * that is already a KEPUB is copied as well. So the output is always a `*.kepub.epub` temp file next to the target,
 * and it must differ from the input before it is renamed into place.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

export const KEPUB_EXTENSION = ".kepub.epub";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface ConvertToKepubOptions {
  /** Environment of the kepubify process (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Executable name or path (default `kepubify`). */
  binary?: string;
  /** Kill kepubify after this long (default 5 minutes). */
  timeoutMs?: number;
}

export class KepubifyError extends Error {
  /** Process exit code; null when it did not start or was killed. */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  constructor(
    message: string,
    details: { exitCode?: number | null; stdout?: string; stderr?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "KepubifyError";
    this.exitCode = details.exitCode ?? null;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
  }
}

/**
 * Converts `inputEpub` into `outputKepub` (which must end with `.kepub.epub`; its folder is created). The result is
 * written to a temp file in the same folder, checked (exists, not empty, different from the input) and then renamed
 * over `outputKepub`, so a failed run never leaves a half-written or unconverted KEPUB behind. Returns the output path.
 */
export async function convertToKepub(
  inputEpub: string,
  outputKepub: string,
  options: ConvertToKepubOptions = {},
): Promise<string> {
  if (!outputKepub.endsWith(KEPUB_EXTENSION)) {
    throw new KepubifyError(`output path must end with ${KEPUB_EXTENSION}: ${outputKepub}`);
  }
  // Absolute paths: an argument can never be mistaken for a flag.
  const input = path.resolve(inputEpub);
  const output = path.resolve(outputKepub);
  if (input === output) throw new KepubifyError(`input and output are the same file: ${input}`);

  const inputInfo = await stat(input).catch((error: unknown) => {
    throw new KepubifyError(`cannot read input EPUB ${input}: ${(error as Error).message}`, {
      cause: error,
    });
  });
  if (!inputInfo.isFile() || inputInfo.size === 0) {
    throw new KepubifyError(`input EPUB is not a non-empty file: ${input}`);
  }

  const dir = path.dirname(output);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.kepubify-${randomBytes(6).toString("hex")}.tmp${KEPUB_EXTENSION}`);
  try {
    const { stdout, stderr } = await runKepubify(["-o", tmp, "--", input], options);
    const tmpInfo = await stat(tmp).catch(() => null);
    if (!tmpInfo?.isFile() || tmpInfo.size === 0) {
      throw new KepubifyError(`kepubify produced no output for ${input}`, { stdout, stderr });
    }
    if (await sameContent(input, tmp, inputInfo.size, tmpInfo.size)) {
      throw new KepubifyError(
        `kepubify copied ${input} unchanged instead of converting it (already a KEPUB?)`,
        { stdout, stderr },
      );
    }
    await rename(tmp, output);
    return output;
  } finally {
    await rm(tmp, { force: true });
  }
}

function runKepubify(
  args: string[],
  options: ConvertToKepubOptions,
): Promise<{ stdout: string; stderr: string }> {
  const binary = options.binary ?? "kepubify";
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      {
        env: options.env ?? process.env,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const exitCode = typeof error.code === "number" ? error.code : null;
        const tail = lastLines(`${stdout}\n${stderr}`);
        reject(
          new KepubifyError(
            `kepubify failed${exitCode === null ? "" : ` (exit ${exitCode})`}: ${tail || error.message}`,
            { exitCode, stdout, stderr, cause: error },
          ),
        );
      },
    );
  });
}

function lastLines(text: string, count = 6): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-count)
    .join(" | ");
}

async function sameContent(a: string, b: string, sizeA: number, sizeB: number): Promise<boolean> {
  if (sizeA !== sizeB) return false;
  const [hashA, hashB] = await Promise.all([sha256(a), sha256(b)]);
  return hashA === hashB;
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}
