// モデルの追加・編集ダイアログを開く(ModelEditorHost が表示する。フェーズ3-4)。

import { createStore } from "zustand/vanilla";
import type { ModelForm } from "../../core";

export interface ModelEditorRequest {
  /** 開くたびに変える(フォームを初期化するため) */
  id: number;
  form: ModelForm;
  /** 編集するユーザーモデルのファイル名。新しく作るときは undefined */
  file?: string;
}

export const modelEditorStore = createStore<{ request: ModelEditorRequest | null }>(() => ({
  request: null,
}));

let nextId = 1;

export function openModelEditor(form: ModelForm, file?: string): void {
  modelEditorStore.setState({ request: { id: nextId++, form, file } });
}

export function closeModelEditor(): void {
  modelEditorStore.setState({ request: null });
}
