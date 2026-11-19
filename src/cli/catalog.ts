// CLI のモデルのカタログとアイコンの画像(SPEC 11 章)。組み込みのモデル(src/library)に、
// アプリと同じフォルダのユーザーモデル(SPEC 5.2)を足す。アイコンの画像は data: URL にして、SVG に埋め込む。

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildCatalog,
  type DeviceModel,
  iconMimeType,
  type ModelCatalog,
  parseModelDefinition,
} from "../core";
import { loadBuiltinModels } from "../library";

export interface CliCatalog {
  catalog: ModelCatalog;
  /** 読めなかったユーザーモデル(「ファイル名: 理由」。カタログには入れない) */
  problems: string[];
}

/** 組み込みのモデルと、ユーザーモデルのファイル(files)のカタログ。同じ ID ならユーザーモデルを使う */
export function cliCatalog(files: readonly { file: string; text: string }[]): CliCatalog {
  const user: DeviceModel[] = [];
  const problems: string[] = [];
  for (const { file, text } of files) {
    const result = parseModelDefinition(text);
    if (result.ok) user.push(result.model);
    else {
      const reason = result.issues.find((i) => i.severity === "error")?.message ?? "読めません";
      problems.push(`${file}: ${reason}`);
    }
  }
  return { catalog: buildCatalog(loadBuiltinModels().models, user), problems };
}

/** アイコンの画像(ファイル名 → data: URL) */
export function iconDataUrls(
  files: readonly { file: string; data: Uint8Array }[],
): Map<string, string> {
  return new Map(
    files.map(({ file, data }) => [
      file,
      `data:${iconMimeType(file)};base64,${Buffer.from(data).toString("base64")}`,
    ]),
  );
}

/** フォルダの中の、accept に合うファイル(名前の順)。フォルダが無ければ空 */
export async function readFolder(
  dir: string,
  accept: (name: string) => boolean,
): Promise<{ file: string; data: Uint8Array }[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = names.filter(accept).sort((a, b) => a.localeCompare(b));
  return Promise.all(files.map(async (file) => ({ file, data: await readFile(join(dir, file)) })));
}

/** ユーザーモデルのファイルか(SPEC 5.2) */
export const isModelFile = (name: string) => /\.ya?ml$/i.test(name);
