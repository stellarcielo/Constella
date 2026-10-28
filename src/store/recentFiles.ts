// 最近使ったファイル(SPEC 10章)。新しく使った順に最大 10 件。
// 表示設定と同じく localStorage に保存する(フェーズ2-6 Q2)。

import { createStore } from "zustand/vanilla";
import { basename } from "../platform/types";

export const RECENT_LIMIT = 10;
const RECENT_STORAGE_KEY = "constella.recentFiles";

export type RecentStorage = Pick<Storage, "getItem" | "setItem">;

export interface RecentFilesState {
  /** 新しく使った順のパス */
  paths: string[];
  /** 使ったファイルを先頭に入れる(同じパスは 1 つにまとめ、古いものから消す) */
  add(path: string): void;
  /** 一覧から外す(開けなかったファイルなど) */
  remove(path: string): void;
  clear(): void;
}

/** path を先頭に入れた一覧 */
export function addRecent(paths: readonly string[], path: string): string[] {
  return [path, ...paths.filter((p) => p !== path)].slice(0, RECENT_LIMIT);
}

/**
 * メニューに出す名前(フェーズ2-6 Q5)。ふだんはファイル名だけ。
 * 同じファイル名が 2 つ以上あれば、入っているフォルダ名を添え、それでも同じならフルパスにする
 */
export function recentLabels(paths: readonly string[]): string[] {
  const count = (labels: string[], label: string) => labels.filter((l) => l === label).length;
  const names = paths.map((p) => basename(p));
  const withFolder = paths.map((p, i) =>
    count(names, names[i]) > 1 ? `${names[i]} — ${basename(parentOf(p))}` : names[i],
  );
  return withFolder.map((label, i) => (count(withFolder, label) > 1 ? paths[i] : label));
}

function parentOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export function createRecentFilesStore(storage?: RecentStorage) {
  const store = createStore<RecentFilesState>()((set, get) => ({
    paths: loadRecent(storage),
    add(path) {
      set({ paths: addRecent(get().paths, path) });
    },
    remove(path) {
      if (get().paths.includes(path)) set({ paths: get().paths.filter((p) => p !== path) });
    },
    clear() {
      if (get().paths.length > 0) set({ paths: [] });
    },
  }));
  if (storage) {
    store.subscribe((state, prev) => {
      if (state.paths === prev.paths) return;
      try {
        storage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.paths));
      } catch {
        // 保存できなくても、今の起動中は覚えている
      }
    });
  }
  return store;
}

/** 保存した一覧を読む。壊れていれば使える部分だけ(読めなければ空) */
function loadRecent(storage?: RecentStorage): string[] {
  try {
    const saved: unknown = JSON.parse(storage?.getItem(RECENT_STORAGE_KEY) ?? "null");
    if (!Array.isArray(saved)) return [];
    const paths = saved.filter((p): p is string => typeof p === "string" && p !== "");
    return [...new Set(paths)].slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}
