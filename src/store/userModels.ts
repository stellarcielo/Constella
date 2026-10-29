// ユーザーモデル(SPEC 5.2・フェーズ3-4)。ユーザーモデルのフォルダの YAML を読み、
// 組み込みモデルと合わせてカタログを作る(同じ ID はユーザーモデルが優先)。
// 読めないファイルも一覧に残し、パレットで知らせる(フェーズ3-4 Q7)。

import { createStore } from "zustand/vanilla";
import {
  buildCatalog,
  type DeviceModel,
  type ModelCatalog,
  type ModelIssue,
  parseModelDefinition,
} from "../core";

export interface UserModelFile {
  /** フォルダの中のファイル名(ふつうは `<id>.yaml`) */
  file: string;
  text: string;
  /** 読めたモデル。エラーがあれば undefined */
  model?: DeviceModel;
  issues: ModelIssue[];
}

/** ユーザーモデルのフォルダの読み書き(platform の差し替え) */
export interface UserModelIo {
  list(): Promise<{ file: string; text: string }[]>;
  write(file: string, text: string): Promise<void>;
  remove(file: string): Promise<void>;
}

export interface UserModelsState {
  /** ファイル名の順 */
  files: UserModelFile[];
  /** フォルダが読めなかったときの理由 */
  loadError?: string;
  /** フォルダを読み直す */
  reload(): Promise<void>;
  /** 保存する。編集前のファイル名(previousFile)と違えば、古いファイルを消す(ID を変えたとき) */
  save(file: string, text: string, previousFile?: string): Promise<void>;
  remove(file: string): Promise<void>;
}

/** モデルを保存するファイル名 */
export function modelFileName(id: string): string {
  return `${id}.yaml`;
}

/** 組み込みモデルとユーザーモデルのカタログ。同じ ID はユーザーモデルが優先(SPEC 5.2) */
export function userModelCatalog(
  builtin: Iterable<DeviceModel>,
  files: readonly UserModelFile[],
): ModelCatalog {
  return buildCatalog(
    builtin,
    files.flatMap((f) => (f.model ? [f.model] : [])),
  );
}

export function createUserModelsStore(io: UserModelIo) {
  return createStore<UserModelsState>()((set, get) => ({
    files: [],

    async reload() {
      try {
        const raw = await io.list();
        const files = raw
          .map(({ file, text }): UserModelFile => {
            const result = parseModelDefinition(text);
            return {
              file,
              text,
              model: result.ok ? result.model : undefined,
              issues: result.issues,
            };
          })
          .sort((a, b) => a.file.localeCompare(b.file));
        set({ files, loadError: undefined });
      } catch (e) {
        set({ loadError: String(e) });
      }
    },

    async save(file, text, previousFile) {
      await io.write(file, text);
      if (previousFile !== undefined && previousFile !== file) await io.remove(previousFile);
      await get().reload();
    },

    async remove(file) {
      await io.remove(file);
      await get().reload();
    },
  }));
}
