// constella コマンドの入口(SPEC 11 章)。Node.js のファイル・標準入出力をコマンドにつなぐ。
// `npm run build:cli` で、依存する部品ごと dist-cli/constella.mjs の 1 ファイルにまとめる(vite.cli.config.ts)。

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { version } from "../../package.json";
import { isIconImageName } from "../core";
import { constellaDataDir } from "../platform/dataDir";
import { cliCatalog, iconDataUrls, isModelFile, readFolder } from "./catalog";
import { type CliDeps, runCli } from "./commands";

const dataDir = constellaDataDir({
  platform: process.platform,
  home: homedir(),
  vars: process.env,
});
const defaultDirs = { models: join(dataDir, "models"), icons: join(dataDir, "icons") };
const decoder = new TextDecoder();

const deps: CliDeps = {
  version,
  defaultDirs,
  readText: (path) => readFile(path, "utf8"),
  writeText: (path, text) => writeFile(path, text, "utf8"),
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  async catalog(source) {
    if (!source.userModels) return cliCatalog([]);
    const files = await readFolder(source.models ?? defaultDirs.models, isModelFile);
    return cliCatalog(files.map(({ file, data }) => ({ file, text: decoder.decode(data) })));
  },
  async iconImages(source) {
    if (!source.userModels) return new Map();
    return iconDataUrls(await readFolder(source.icons ?? defaultDirs.icons, isIconImageName));
  },
  // 相手(AI アシスタント)が標準入力を閉じるまで動き続ける
  serveMcp: (server) => server.connect(new StdioServerTransport()),
};

process.exitCode = await runCli(process.argv.slice(2), deps);
