// アプリ全体で使うストアのインスタンスと React 用のフック。

import { useStore } from "zustand";
import { askDialog } from "../components/Dialog/dialogs";
import { buildCatalog } from "../core";
import { loadBuiltinModels } from "../library";
import { platform } from "../platform";
import { createRecentFilesStore } from "./recentFiles";
import { createTopologyStore, type TopologyState } from "./topologyStore";
import { createUiStore, type UiState } from "./uiStore";
import { createUserModelsStore, type UserModelsState, userModelCatalog } from "./userModels";

const builtinModels = loadBuiltinModels().models;

export const topologyStore = createTopologyStore(buildCatalog(builtinModels), {
  // YAML に構文エラーがある間に GUI で編集しようとしたとき(SPEC 8.3)
  async confirmOverwrite() {
    const choice = await askDialog({
      title: "YAML にエラーがあります",
      message:
        "GUI の内容で上書きしますか? エディタの内容は、最後に正しく読み込めた状態に戻ってから、この操作が反映されます。",
      actions: [{ value: "overwrite", label: "上書きする", primary: true, danger: true }],
    });
    return choice === "overwrite";
  },
});
export const uiStore = createUiStore(localStorageIfAvailable());

/** ユーザーモデル(SPEC 5.2)。起動時に読み込み、変わったらカタログを作り直す(フェーズ3-4) */
export const userModelsStore = createUserModelsStore({
  list: () => platform.listUserModels(),
  write: (file, text) => platform.writeUserModel(file, text),
  remove: (file) => platform.removeUserModel(file),
});
userModelsStore.subscribe((state, prev) => {
  if (state.files !== prev.files) {
    topologyStore.getState().setCatalog(userModelCatalog(builtinModels, state.files));
  }
});
void userModelsStore.getState().reload();
export const recentFilesStore = createRecentFilesStore(localStorageIfAvailable());

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

export function useUserModels<T>(selector: (state: UserModelsState) => T): T {
  return useStore(userModelsStore, selector);
}

export type { Selection, TopologyState, YamlOrigin } from "./topologyStore";
export type { ChosenPort, ConnectState, Mode, UiState, ViewOptions } from "./uiStore";
export { currentLayer, LAYER_LABELS, VIEW_LAYERS, type ViewLayer } from "./viewLayers";

/** 表示オプションと最近使ったファイルの保存先。使えない環境では覚えておかない */
function localStorageIfAvailable(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
