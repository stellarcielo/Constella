// ファイルの新規・開く・保存・別名で保存・閉じる(SPEC 10章)。
// ファイル操作(platform)とダイアログは引数で受け取り、テストで差し替えられるようにする。

import {
  type Issue,
  lineColumn,
  parseTopology,
  rebaseOnSavedText,
  serializeTopology,
  type Viewport,
} from "../core";
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

  async function writeTo(path: string): Promise<boolean> {
    const { topology, base, catalog } = store.getState();
    const result = serializeTopology(topology, base);
    try {
      await platform.writeTextFile(path, result.text);
    } catch (e) {
      await deps.showError("保存できませんでした", `${basename(path)} に書き込めませんでした。`, [
        String(e),
      ]);
      return false;
    }
    // 保存したファイルを読み直して、問題の位置とファイル由来の問題を最新にする
    const rebased = rebaseOnSavedText(result.text, topology, catalog);
    store.getState().markSaved({
      filePath: path,
      savedTopology: topology,
      ...(rebased
        ? { base: rebased.base, fileText: result.text, fileIssues: rebased.fileIssues }
        : { base: result.base }),
    });
    return true;
  }

  async function saveAs(): Promise<boolean> {
    const { topology, filePath } = store.getState();
    const path = await platform.chooseSavePath(defaultFileName(topology.meta.title, filePath));
    return path ? writeTo(path) : false;
  }

  async function save(): Promise<boolean> {
    const { filePath, dirty } = store.getState();
    if (!filePath) return saveAs();
    return dirty ? writeTo(filePath) : true;
  }

  /** 未保存の変更があれば確認する。続けてよければ true */
  async function resolveUnsaved(): Promise<boolean> {
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
    const result = parseTopology(file.text, { catalog: store.getState().catalog });
    if (!result.ok) {
      // 構文エラーは今は画面で直せないので、知らせて今の図を残す(Q3)
      const text = file.text;
      await deps.showError(
        `${basename(file.path)} を開けませんでした`,
        "YAML に次のエラーがあります。修正してから開いてください。",
        result.issues.map((issue) => describeIssue(text, issue)),
      );
      return;
    }
    store.getState().loadDocument({
      topology: result.topology,
      base: result.base,
      filePath: file.path,
      fileText: file.text,
      fileIssues: result.issues,
    });
    deps.resetView(result.topology.viewport);
  }

  async function quit(): Promise<void> {
    if (await resolveUnsaved()) await platform.closeWindow();
  }

  return { newFile, open, save, saveAs, confirmClose: resolveUnsaved, quit };
}

function describeIssue(text: string, issue: Issue): string {
  if (!issue.range) return issue.message;
  const { line, column } = lineColumn(text, issue.range.start);
  return `${line} 行目 ${column} 文字目: ${issue.message}`;
}
