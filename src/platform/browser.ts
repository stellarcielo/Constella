// ブラウザで開いたとき用の簡易版(開発中の動作確認用)。
// 開く = ファイル選択、保存・書き出し = ダウンロード。メニューバーは無いので、ショートカットはアプリ側で受ける。

import type { Platform } from "./types";

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
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

/** アイコンの画像も localStorage に入れる(ファイル名 → base64) */
const ICONS_KEY = "constella.icons";

function loadIcons(): Record<string, string> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(ICONS_KEY) ?? "{}");
    return typeof saved === "object" && saved !== null ? (saved as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function storeIcons(files: Record<string, string>): void {
  window.localStorage.setItem(ICONS_KEY, JSON.stringify(files));
}

function toBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
  return data;
}

export const browserPlatform: Platform = {
  hasNativeMenu: false,

  async openTextFile(kind = "topology") {
    const file = await pickFile(kind === "proxmox" ? ".json" : ".yaml,.yml");
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

  async listIcons() {
    return Object.entries(loadIcons())
      .filter(([, data]) => typeof data === "string")
      .map(([file, data]) => ({ file, data: fromBase64(data) }));
  },

  async chooseIconFile() {
    const file = await pickFile(".svg,.png");
    return file ? { name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : null;
  },

  async writeIcon(file, data) {
    storeIcons({ ...loadIcons(), [file]: toBase64(data) });
  },

  async removeIcon(file) {
    storeIcons(Object.fromEntries(Object.entries(loadIcons()).filter(([name]) => name !== file)));
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
