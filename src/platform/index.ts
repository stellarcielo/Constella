// 実行環境に合わせて platform を選ぶ。OS に関わる処理は必ずここを通す(CLAUDE.md)。

import { browserPlatform } from "./browser";
import { tauriPlatform } from "./tauri";
import type { Platform } from "./types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const platform: Platform = isTauri ? tauriPlatform : browserPlatform;

export { basename } from "./types";
export type { MenuCommands, Platform } from "./types";
