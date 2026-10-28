// 処理の中から確認ダイアログを出して、選ばれた結果を待つ(DialogHost が表示する)。

import { createStore } from "zustand/vanilla";
import type { DialogAction } from "./ConfirmDialog";

export interface DialogRequest {
  title: string;
  message: string;
  /** 箇条書きで出す詳細(エラーの一覧など) */
  details?: string[];
  actions: DialogAction<string>[];
  cancelLabel?: string | null;
  resolve(value: string | null): void;
}

export const dialogStore = createStore<{ request: DialogRequest | null }>(() => ({
  request: null,
}));

/** ダイアログを出し、選ばれたボタンの value を返す。キャンセルなら null */
export function askDialog<T extends string>(
  options: Omit<DialogRequest, "actions" | "resolve"> & { actions: DialogAction<T>[] },
): Promise<T | null> {
  return new Promise((resolve) => {
    // 先に出ているダイアログはキャンセル扱いにする
    dialogStore.getState().request?.resolve(null);
    dialogStore.setState({
      request: {
        ...options,
        resolve: (value) => resolve(options.actions.find((a) => a.value === value)?.value ?? null),
      },
    });
  });
}
