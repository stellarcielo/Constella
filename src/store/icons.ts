// アイコンの画像(SPEC 5.1・5.2)。アイコンのフォルダの SVG・PNG を読み、data: URL にして持つ
// (キャンバス・パレットの表示と、SVG・PNG の書き出しへの埋め込みに使う)。

import { createStore } from "zustand/vanilla";
import { ICON_MAX_BYTES, iconMimeType, uniqueIconName } from "../core";

/** アイコンのフォルダの読み書き(platform の差し替え) */
export interface IconsIo {
  list(): Promise<{ file: string; data: Uint8Array<ArrayBuffer> }[]>;
  /** 取り込む画像を選んで読む。キャンセルなら null */
  choose(): Promise<{ name: string; data: Uint8Array<ArrayBuffer> } | null>;
  write(file: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  remove(file: string): Promise<void>;
}

export interface IconsState {
  /** ファイル名 → data: URL(ファイル名の順) */
  images: ReadonlyMap<string, string>;
  /** フォルダが読めなかったときの理由 */
  loadError?: string;
  /** フォルダを読み直す */
  reload(): Promise<void>;
  /**
   * 画像を選んで取り込み(同じ名前があれば -2 などを付ける)、取り込んだファイル名を返す。
   * キャンセルなら undefined。大きすぎる画像は取り込まずに例外にする
   */
  importImage(): Promise<string | undefined>;
  /** 名前を決めた画像をまとめて書き込み、最後に 1 回だけ読み直す(まとめたファイルからの取り込み。SPEC 5.5) */
  addImages(images: readonly { file: string; data: Uint8Array<ArrayBuffer> }[]): Promise<void>;
  remove(file: string): Promise<void>;
}

/** 画像のバイト列を data: URL にする */
export function iconDataUrl(file: string, data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) {
    binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  }
  return `data:${iconMimeType(file)};base64,${btoa(binary)}`;
}

export function createIconsStore(io: IconsIo) {
  return createStore<IconsState>()((set, get) => ({
    images: new Map(),

    async reload() {
      try {
        const files = await io.list();
        files.sort((a, b) => a.file.localeCompare(b.file));
        set({
          images: new Map(files.map(({ file, data }) => [file, iconDataUrl(file, data)])),
          loadError: undefined,
        });
      } catch (e) {
        set({ images: new Map(), loadError: String(e) });
      }
    },

    async importImage() {
      const chosen = await io.choose();
      if (!chosen) return undefined;
      if (chosen.data.length > ICON_MAX_BYTES) {
        throw new Error(
          `${chosen.name} は ${Math.ceil(chosen.data.length / 1024)} KB あります。アイコンの画像は 1 MB までにしてください`,
        );
      }
      const file = uniqueIconName(chosen.name, (name) => get().images.has(name));
      await io.write(file, chosen.data);
      await get().reload();
      return file;
    },

    async addImages(images) {
      try {
        for (const { file, data } of images) await io.write(file, data);
      } finally {
        await get().reload();
      }
    },

    async remove(file) {
      await io.remove(file);
      await get().reload();
    },
  }));
}
