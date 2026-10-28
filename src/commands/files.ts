// ファイルの新規・開く・保存・別名で保存・閉じる(SPEC 10章)。
// ファイル操作(platform)とダイアログは引数で受け取り、テストで差し替えられるようにする。

import type { Viewport } from "../core";
import { basename, type Platform } from "../platform/types";
import type { TopologyStore } from "../store/topologyStore";

export type UnsavedChoice = "save" | "discard" | "cancel";

export interface FileCommandDeps {
  platform: Pick<Platform, "openTextFile" | "chooseSavePath" | "writeTextFile" | "closeWindow">;
  store: TopologyStore;
  /** 新規・開いたあとに、モードと表示位置を戻す(viewport が無ければ全体表示) */
  resetView(viewport?: Viewport): void;
  /** 未保存の変更があるときの確認(新規・開く・閉じるの前。Q5) */
  askUnsaved(fileName: string): Promise<UnsavedChoice>;
  /** YAML に構文エラーがあるまま保存してよいか(フェーズ2-1 Q2) */
  confirmSaveWithErrors(): Promise<boolean>;
  showError(title: string, message: string, details?: string[]): Promise<void>;
}

export interface FileCommands {
  newFile(): Promise<void>;
  open(): Promise<void>;
  /** 保存できたら true */
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  /** ウィンドウを閉じてよいか(未保存なら確認する) */
  confirmClose(): Promise<boolean>;
  /** 確認してからアプリを終了する */
  quit(): Promise<void>;
}

/** 画面に出す文書名。新規(まだ保存していない)なら「無題」 */
export function documentName(filePath?: string): string {
  return filePath ? basename(filePath) : "無題";
}

/** 保存画面の初期のファイル名(Q4)。保存済みならそのファイル名、無ければタイトルから作る */
export function defaultFileName(title?: string, filePath?: string): string {
  if (filePath) return basename(filePath);
  // ファイル名に使えない文字は _ にする
  const safe = Array.from(title ?? "", (ch) => (ch < " " || '\\/:*?"<>|'.includes(ch) ? "_" : ch))
    .join("")
    .trim()
    .slice(0, 100);
  return `${safe || "無題"}.constella.yaml`;
}

export function createFileCommands(deps: FileCommandDeps): FileCommands {
  const { platform, store } = deps;

  /** 今の YAML 文字列(エディタの内容)をそのまま書き込む */
  async function writeTo(path: string): Promise<boolean> {
    const text = store.getState().yamlText;
    try {
      await platform.writeTextFile(path, text);
    } catch (e) {
      await deps.showError("保存できませんでした", `${basename(path)} に書き込めませんでした。`, [
        String(e),
      ]);
      return false;
    }
    store.getState().markSaved(path, text);
    return true;
  }

  /** 保存の前に、打ち込み中の内容を読み込み、構文エラーがあれば確認する */
  async function readyToSave(): Promise<boolean> {
    store.getState().commitYamlDraft();
    return store.getState().yamlErrors.length === 0 || deps.confirmSaveWithErrors();
  }

  async function saveAs(): Promise<boolean> {
    if (!(await readyToSave())) return false;
    const { topology, filePath } = store.getState();
    const path = await platform.chooseSavePath(defaultFileName(topology.meta.title, filePath));
    return path ? writeTo(path) : false;
  }

  async function save(): Promise<boolean> {
    store.getState().commitYamlDraft();
    const { filePath, dirty } = store.getState();
    if (!filePath) return saveAs();
    if (!dirty) return true;
    return (await readyToSave()) && writeTo(filePath);
  }

  /** 未保存の変更があれば確認する。続けてよければ true */
  async function resolveUnsaved(): Promise<boolean> {
    store.getState().commitYamlDraft();
    const { dirty, filePath } = store.getState();
    if (!dirty) return true;
    const choice = await deps.askUnsaved(documentName(filePath));
    if (choice === "cancel") return false;
    return choice === "save" ? save() : true;
  }

  async function newFile(): Promise<void> {
    if (!(await resolveUnsaved())) return;
    store.getState().newDocument();
    deps.resetView();
  }

  async function open(): Promise<void> {
    if (!(await resolveUnsaved())) return;
    let file: { path: string; text: string } | null;
    try {
      file = await platform.openTextFile();
    } catch (e) {
      await deps.showError("開けませんでした", "ファイルを読み込めませんでした。", [String(e)]);
      return;
    }
    if (!file) return;
    // 構文エラーがあっても開く。図は空のまま、エディタで直せる(フェーズ2-1 Q1)
    store.getState().openText(file.text, file.path);
    deps.resetView(store.getState().topology.viewport);
  }

  async function quit(): Promise<void> {
    if (await resolveUnsaved()) await platform.closeWindow();
  }

  return { newFile, open, save, saveAs, confirmClose: resolveUnsaved, quit };
}
