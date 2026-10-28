// ブラウザで開いたとき用の簡易版(開発中の動作確認用)。
// 開く = ファイル選択、保存 = ダウンロード。メニューバーは無いので、ショートカットはアプリ側で受ける。

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

export const browserPlatform: Platform = {
  hasNativeMenu: false,

  async openTextFile() {
    const file = await pickFile();
    return file ? { path: file.name, text: await file.text() } : null;
  },

  async chooseSavePath(defaultName) {
    return window.prompt("保存するファイル名", defaultName);
  },

  async writeTextFile(path, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = path;
    a.click();
    URL.revokeObjectURL(url);
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
};
