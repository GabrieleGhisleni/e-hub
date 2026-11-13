import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SshError, shellQuote, sshTransport } from "../../../src/node/kobo/index.ts";
import { assertSafeRelPath, UnsafeKoboPathError } from "../../../src/node/kobo/transport.ts";
import { makeTrackedTempDir } from "../../helpers/tmp.ts";

const kobo = {
  host: "root@example.invalid",
  port: 2222,
  identityFile: "/nonexistent",
  hostKeyAlias: "kobo-alias",
  booksDir: "/mnt/onboard/books",
};

/** A stand-in `ssh` executable: a shell script with the given body, run through `binary`. */
async function fakeSsh(body: string): Promise<{ binary: string; dir: string }> {
  const dir = await makeTrackedTempDir("elib-fake-ssh-");
  const binary = path.join(dir, "ssh");
  await writeFile(binary, `#!/bin/sh\n${body}\n`);
  await chmod(binary, 0o755);
  return { binary, dir };
}

describe("shellQuote", () => {
  it("single-quotes and escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("")).toBe("''");
  });
});

describe("assertSafeRelPath", () => {
  it.each(["../x", "/x", "a/b/c", ".hidden", "a//b", "", "a/../b", "tab\there"])(
    "rejects %j",
    (rel) => {
      expect(() => assertSafeRelPath(rel)).toThrow(UnsafeKoboPathError);
    },
  );

  it("accepts a file name and one folder level", () => {
    expect(() => assertSafeRelPath("Ada - Titolo [7k2m9q4t].kepub.epub")).not.toThrow();
    expect(() =>
      assertSafeRelPath("Ada - Titolo [7k2m9q4t].kepub.sdr/custom_metadata.lua"),
    ).not.toThrow();
  });
});

describe("sshTransport", () => {
  it("runs ssh with the hardened options and a single quoted remote command", async () => {
    const dir = await makeTrackedTempDir("elib-fake-ssh-args-");
    const argsFile = path.join(dir, "args.txt");
    const script = path.join(dir, "ssh-record");
    await writeFile(
      script,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nprintf 'd Saggistica\\000f .hidden\\000f Y.kepub.epub\\000'\n`,
    );
    await chmod(script, 0o755);

    const transport = sshTransport(kobo, { binary: script });
    const entries = await transport.list();
    expect(entries).toEqual([
      { name: "Saggistica", dir: true },
      { name: "Y.kepub.epub", dir: false },
    ]);

    const args = (await readFile(argsFile, "utf8")).split("\n");
    expect(args.slice(0, 4)).toEqual(["-p", "2222", "-i", "/nonexistent"]);
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args).toContain("HostKeyAlias=kobo-alias");
    expect(args).toContain("root@example.invalid");
    const command = args.at(-2) ?? "";
    expect(command.startsWith("cd '/mnt/onboard/books' && for f in *")).toBe(true);
    expect(transport.description).toBe("root@example.invalid:/mnt/onboard/books");
  });

  it("parses md5sum output, keyed by the paths asked for", async () => {
    const { binary } = await fakeSsh(
      `printf 'd41d8cd98f00b204e9800998ecf8427e  Ada - X [7k2m9q4t].kepub.sdr/custom_metadata.lua\\n'`,
    );
    const transport = sshTransport(kobo, { binary });
    const sums = await transport.md5(["Ada - X [7k2m9q4t].kepub.sdr/custom_metadata.lua"]);
    expect(sums.get("Ada - X [7k2m9q4t].kepub.sdr/custom_metadata.lua")).toBe(
      "d41d8cd98f00b204e9800998ecf8427e",
    );
    expect(await transport.md5([])).toEqual(new Map());
  });

  it("sends the file content on stdin for writeFile", async () => {
    const dir = await makeTrackedTempDir("elib-fake-ssh-stdin-");
    const captured = path.join(dir, "captured.txt");
    const binary = path.join(dir, "ssh-cat");
    await writeFile(binary, `#!/bin/sh\ncat > '${captured}'\n`);
    await chmod(binary, 0o755);

    await sshTransport(kobo, { binary }).writeFile("X/custom_metadata.lua", "return {}\n");
    expect(await readFile(captured, "utf8")).toBe("return {}\n");
  });

  it("turns a non-zero exit into an SshError carrying stderr", async () => {
    const { binary } = await fakeSsh(`echo "connection refused" >&2\nexit 3`);
    const error = await sshTransport(kobo, { binary })
      .flush()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SshError);
    expect((error as SshError).exitCode).toBe(3);
    expect((error as SshError).stderr).toBe("connection refused");
    expect((error as Error).message).toContain("connection refused");
  });
});
