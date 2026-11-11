// モデルの管理画面を開く・閉じる(ModelManagerHost が表示する。SPEC 5.5)。

import { createStore } from "zustand/vanilla";

export const modelManagerStore = createStore<{ open: boolean }>(() => ({ open: false }));

export function openModelManager(): void {
  modelManagerStore.setState({ open: true });
}

export function closeModelManager(): void {
  modelManagerStore.setState({ open: false });
}
