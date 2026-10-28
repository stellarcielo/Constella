// アプリ全体のキーボードショートカット。

import { useEffect } from "react";
import { editCommands } from "../commands";
import { topologyStore, uiStore } from "../store";
import { type EditAction, editActionFor, keyPlace } from "./editKeys";

/** 文字を入力している最中か(入力欄で C を打っても接続モードにしないため) */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * 入力欄や選択欄からフォーカスを外す(inside の中の入力欄はそのまま)。
 * フォーカスが入力欄に残っていると、delete キーや C などのキー操作がキャンバスに効かないため。
 */
export function releaseInputFocus(inside?: Element | null): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && isTyping(active) && !inside?.contains(active)) {
    active.blur();
  }
}

/** ⌘Z・⌘C などの編集キー(振り分けは editKeys.ts) */
function runEditKey(e: KeyboardEvent, action: EditAction): void {
  // 確認ダイアログが出ている間は図を変えない(メニューの「取り消す」にも回さない)
  if (document.querySelector("[aria-modal]")) {
    if (action !== "copy") e.preventDefault();
    return;
  }
  // 機器を選んでいなければ、ページの文字のコピーなど標準の動作に任せる
  const noDevices = topologyStore.getState().selection.devices.length === 0;
  if ((action === "copy" || action === "cut") && noDevices) return;
  e.preventDefault();
  void editCommands[action]();
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        uiStore.getState().escape();
        return;
      }
      const action = editActionFor(e, keyPlace(e.target));
      if (action) {
        runEditKey(e, action);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        uiStore.getState().toggleConnectMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
