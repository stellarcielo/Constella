// 取り消し・やり直し・コピー・切り取り・貼り付け・すべて選択(SPEC 7.4)と、グループにする・解除(SPEC 7.5)。
// クリップボードには選択部分を YAML の断片として入れる(フェーズ2-2 Q2)。
// 取り消し・やり直しは、入力欄(YAML エディタ以外)にフォーカスがあれば、その入力欄の文字の取り消しに回す。

import {
  allBridges,
  extractFragment,
  fragmentToText,
  parseFragment,
  pasteFragment,
  removeGroup,
} from "../core";
import type { Platform } from "../platform/types";
import type { TopologyStore } from "../store/topologyStore";

/** 貼り付けるたびにずらす量(フェーズ2-2 Q3) */
export const PASTE_OFFSET = 40;

export interface EditCommandDeps {
  store: TopologyStore;
  clipboard: Pick<Platform, "readClipboardText" | "writeClipboardText">;
  /** 文字を入力する欄(YAML エディタ以外)にフォーカスがあるか */
  isTextInputFocused(): boolean;
  /** 入力欄の文字の取り消し・やり直し */
  textCommand(command: "undo" | "redo"): void;
  /** グループを作った(「グループ」の表示を入れ、ラベル欄にカーソルを置く) */
  onGroupCreated?(uid: string): void;
}

export interface EditCommands {
  undo(): void;
  redo(): void;
  /** 選択したデバイスをコピーする。何も選んでいなければ false */
  copy(): Promise<boolean>;
  cut(): Promise<boolean>;
  /** クリップボードの断片を貼り付ける。貼れるものが無ければ false */
  paste(): Promise<boolean>;
  selectAll(): void;
  /** 選んでいる機器でグループを作る(SPEC 7.5)。機器を選んでいなければ false */
  group(): boolean;
  /** 選んでいるグループを消す(機器は残す)。グループを選んでいなければ false */
  ungroup(): boolean;
}

export function createEditCommands(deps: EditCommandDeps): EditCommands {
  const { store, clipboard } = deps;
  /** 同じ内容を続けて貼った回数(貼るたびに右下へずらす) */
  let lastPaste: { text: string; count: number } | undefined;

  async function copy(): Promise<boolean> {
    const { topology, selection } = store.getState();
    if (selection.devices.length === 0) return false;
    await clipboard.writeClipboardText(
      fragmentToText(extractFragment(topology, selection.devices)),
    );
    lastPaste = undefined;
    return true;
  }

  return {
    undo() {
      if (deps.isTextInputFocused()) deps.textCommand("undo");
      else store.getState().undo();
    },

    redo() {
      if (deps.isTextInputFocused()) deps.textCommand("redo");
      else store.getState().redo();
    },

    copy,

    async cut() {
      if (!(await copy())) return false;
      store.getState().deleteSelection();
      return true;
    },

    async paste() {
      let text: string;
      try {
        text = await clipboard.readClipboardText();
      } catch {
        return false;
      }
      const { catalog } = store.getState();
      const fragment = parseFragment(text, catalog);
      if (!fragment) return false;
      const count = lastPaste?.text === text ? lastPaste.count + 1 : 1;
      lastPaste = { text, count };
      const offset = { x: PASTE_OFFSET * count, y: PASTE_OFFSET * count };
      let pasted: { devices: string[]; links: string[] } | undefined;
      store.getState().edit((t) => {
        pasted = pasteFragment(t, fragment, catalog, offset);
      });
      if (pasted) store.getState().setSelection(pasted);
      return true;
    },

    selectAll() {
      const { topology } = store.getState();
      store.getState().setSelection({
        devices: [...topology.devices.keys(), ...allBridges(topology).map((b) => b.key)],
        links: topology.links.map((l) => l.id),
      });
    },

    group() {
      const uid = store.getState().addGroup(store.getState().selection.devices);
      if (uid === undefined) return false;
      deps.onGroupCreated?.(uid);
      return true;
    },

    ungroup() {
      const uid = store.getState().selection.group;
      if (uid === undefined) return false;
      store.getState().edit((t) => removeGroup(t, uid));
      return true;
    },
  };
}
