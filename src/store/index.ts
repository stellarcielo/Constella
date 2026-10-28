// アプリ全体で使うストアのインスタンスと React 用のフック。

import { useStore } from "zustand";
import { builtinCatalog } from "../library";
import { createTopologyStore, type TopologyState } from "./topologyStore";
import { createUiStore, type UiState } from "./uiStore";

export const topologyStore = createTopologyStore(builtinCatalog());
export const uiStore = createUiStore(viewStorage());

// 接続モードに入ったら選択を外す(接続モードでは選択できないため)
uiStore.subscribe((state, prev) => {
  if (state.mode === "connect" && prev.mode !== "connect") {
    topologyStore.getState().setSelection({ devices: [], links: [] });
  }
});

export function useTopology<T>(selector: (state: TopologyState) => T): T {
  return useStore(topologyStore, selector);
}

export function useUi<T>(selector: (state: UiState) => T): T {
  return useStore(uiStore, selector);
}

export type { Selection, TopologyState } from "./topologyStore";
export type { ChosenPort, ConnectState, Mode, UiState, ViewOptions } from "./uiStore";

/** 表示オプションの保存先。使えない環境では覚えておかない */
function viewStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
