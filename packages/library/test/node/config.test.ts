import { symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_DATA_DIR,
  REPO_ROOT,
  expandHome,
  loadConfig,
} from "../../src/node/config/index.ts";
import { type TempDir, makeTempDir } from "../helpers/tmp.ts";

let tmp: TempDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

describe("loadConfig", () => {
  it("reads the versioned elib.config.json with ~ expanded", () => {
    const config = loadConfig({ env: {} });
    expect(config.configPath).toBe(path.join(REPO_ROOT, "elib.config.json"));
    expect(config.kobo.host).toBe("root@192.168.1.11");
    expect(config.kobo.port).toBe(2222);
    expect(config.kobo.booksDir).toBe("/mnt/onboard/books");
    expect(config.kobo.identityFile).toBe(path.join(os.homedir(), ".ssh/id_ecds_kobo"));
    expect(config.cache.dir).toBe(path.join(os.homedir(), ".cache/e-library"));
    expect(config.dataDir).toBe(DEFAULT_DATA_DIR);
    expect(config.server.port).toBe(8787);
    expect(config.site.basePath).toBe("/e-library/");
  });

  it("honors ELIB_CONFIG, ELIB_DATA_DIR and ELIB_CACHE_DIR", async () => {
    const file = path.join(tmp.dir, "custom.json");
    const base = loadConfig({ env: {} });
    await writeFile(
      file,
      JSON.stringify({
        ...base,
        kobo: { ...base.kobo, booksDir: "/mnt/onboard/other" },
        cache: { dir: "cache" },
      }),
    );
    const fromFile = loadConfig({ env: { ELIB_CONFIG: file } });
    expect(fromFile.kobo.booksDir).toBe("/mnt/onboard/other");
    expect(fromFile.cache.dir).toBe(path.join(tmp.dir, "cache")); // relative to the config file

    const overridden = loadConfig({
      env: {
        ELIB_CONFIG: file,
        ELIB_DATA_DIR: path.join(tmp.dir, "data"),
        ELIB_CACHE_DIR: path.join(tmp.dir, "c"),
      },
    });
    expect(overridden.dataDir).toBe(path.join(tmp.dir, "data"));
    expect(overridden.cache.dir).toBe(path.join(tmp.dir, "c"));
  });

  it("throws ConfigError for missing or invalid files", async () => {
    expect(() => loadConfig({ configPath: path.join(tmp.dir, "missing.json") })).toThrow(
      ConfigError,
    );
    const bad = path.join(tmp.dir, "bad.json");
    await writeFile(bad, JSON.stringify({ kobo: { host: "a b" } }));
    expect(() => loadConfig({ configPath: bad })).toThrow(/invalid config file/);
  });

  it("ELIB_KOBO_HOST overrides the host of the config file", () => {
    const config = loadConfig({ env: { ELIB_KOBO_HOST: "root@192.168.1.20" } });
    expect(config.kobo.host).toBe("root@192.168.1.20");
    expect(loadConfig({ env: {} }).kobo.host).toBe("root@192.168.1.11");
  });

  it("an invalid ELIB_KOBO_HOST throws ConfigError", () => {
    expect(() => loadConfig({ env: { ELIB_KOBO_HOST: "not a host" } })).toThrow(ConfigError);
  });

  it("expands ~ in kobo.identityFile", async () => {
    const file = path.join(tmp.dir, "kobo.json");
    const base = loadConfig({ env: {} });
    await writeFile(file, JSON.stringify({ ...base, kobo: { ...base.kobo, identityFile: "~/x" } }));
    const config = loadConfig({ env: { ELIB_CONFIG: file } });
    expect(config.kobo.identityFile).toBe(path.join(os.homedir(), "x"));
  });
});

describe("expandHome", () => {
  it("expands only a leading ~", () => {
    expect(expandHome("~", "/home/u")).toBe("/home/u");
    expect(expandHome("~/x/y", "/home/u")).toBe("/home/u/x/y");
    expect(expandHome("/a/~/b", "/home/u")).toBe("/a/~/b");
  });
});

describe("loadConfig: cache dir outside the repo (R1-07)", () => {
  async function configWith(cacheDir: string): Promise<string> {
    const file = path.join(tmp.dir, "c.json");
    const base = loadConfig({ env: {} });
    await writeFile(file, JSON.stringify({ ...base, cache: { dir: cacheDir } }));
    return file;
  }

  it("rejects the repo root and folders inside it, from the file and from the env", async () => {
    for (const dir of [
      REPO_ROOT,
      path.join(REPO_ROOT, ".cache/e-library"),
      path.join(REPO_ROOT, "data"),
    ]) {
      const file = await configWith(dir);
      expect(() => loadConfig({ env: { ELIB_CONFIG: file } })).toThrow(ConfigError);
      expect(() => loadConfig({ env: { ELIB_CACHE_DIR: dir } })).toThrow(/inside the repository/);
    }
  });

  it("follows symlinks: a link to a repo folder is rejected, a plain outside dir passes", async () => {
    const link = path.join(tmp.dir, "link");
    await symlink(path.join(REPO_ROOT, "docs"), link);
    expect(() => loadConfig({ env: { ELIB_CACHE_DIR: path.join(link, "cache") } })).toThrow(
      ConfigError,
    );
    expect(loadConfig({ env: { ELIB_CACHE_DIR: path.join(tmp.dir, "ok") } }).cache.dir).toBe(
      path.join(tmp.dir, "ok"),
    );
  });
});
