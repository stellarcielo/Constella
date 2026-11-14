// キャンバスの右クリックから、右クリックのメニュー(SPEC 7.6)を開く。

import { type MenuTarget, type Selection, topologyStore, uiStore } from "../../store";

/**
 * メニューを開く。select を渡すと、先にそれを選ぶ(選んでいない物を右クリックしたとき)。
 * 接続モードではメニューを出さず、作りかけの接続を取りやめる
 */
export function openContextMenu(
  e: { clientX: number; clientY: number },
  target: MenuTarget,
  select?: Selection,
): void {
  const ui = uiStore.getState();
  if (ui.mode !== "select") {
    ui.clickPane();
    return;
  }
  if (select) topologyStore.getState().setSelection(select);
  ui.openContextMenu({ x: e.clientX, y: e.clientY, target });
}
