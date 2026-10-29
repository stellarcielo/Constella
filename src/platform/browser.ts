// ブラウザで開いたとき用の簡易版(開発中の動作確認用)。
// 開く = ファイル選択、保存・書き出し = ダウンロード。メニューバーは無いので、ショートカットはアプリ側で受ける。

import type { Platform } from "./types";

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

function fileType(path: string): string {
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  return "application/yaml";
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** ブラウザ版では、ユーザーモデルのファイルの代わりに localStorage に入れる(開発中の確認用) */
const USER_MODELS_KEY = "constella.userModels";

function loadUserModels(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(USER_MODELS_KEY) ?? "{}");
    return typeof saved === "object" && saved !== null ? (saved as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storeUserModels(files: Record<string, string>): void {
  window.localStorage.setItem(USER_MODELS_KEY, JSON.stringify(files));
}

export const browserPlatform: Platform = {
  hasNativeMenu: false,

  async openTextFile() {
    const file = await pickFile();
    return file ? { path: file.name, text: await file.text() } : null;
  },

  async readTextFile() {
    // ブラウザではファイルの場所が分からないので、パスを指定して開けない(メニューも無い)
    throw new Error("ブラウザ版では、パスを指定してファイルを開けません");
  },

  async chooseSavePath(defaultName) {
    return window.prompt("保存するファイル名", defaultName);
  },

  async writeTextFile(path, text) {
    download(path, new Blob([text], { type: fileType(path) }));
  },

  async chooseExportPath(defaultName) {
    return window.prompt("書き出すファイル名", defaultName);
  },

  async writeBinaryFile(path, data) {
    download(path, new Blob([data], { type: fileType(path) }));
  },

  async listUserModels() {
    return Object.entries(loadUserModels())
      .filter(([, text]) => typeof text === "string")
      .map(([file, text]) => ({ file, text }));
  },

  async writeUserModel(file, text) {
    storeUserModels({ ...loadUserModels(), [file]: text });
  },

  async removeUserModel(file) {
    storeUserModels(
      Object.fromEntries(Object.entries(loadUserModels()).filter(([name]) => name !== file)),
    );
  },

  setTitle(title) {
    document.title = title;
  },

  readClipboardText() {
    return navigator.clipboard.readText();
  },

  writeClipboardText(text) {
    return navigator.clipboard.writeText(text);
  },

  guardClose({ isDirty }) {
    // ブラウザでは独自の確認画面を出せないので、ブラウザ標準の確認を使う
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  },

  async closeWindow() {
    window.close();
  },

  async setupMenu() {},

  async setRecentFiles() {},
};
