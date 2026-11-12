// YAML エディタの「次を検索」「前を検索」(⌘G・⇧⌘G)。メニューバーの「グループにする」と同じキーなので、
// メニューから届いたときに、フォーカスが YAML エディタにあればこちらを行う(SPEC 7.5)。

import { findNext, findPrevious } from "@codemirror/search";
import { EditorView } from "@codemirror/view";

/** target を含む YAML エディタで検索する。YAML エディタの中でなければ false */
export function searchInYaml(target: Element | null, direction: "next" | "previous"): boolean {
  const editor = target?.closest(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  if (!view) return false;
  if (direction === "next") findNext(view);
  else findPrevious(view);
  return true;
}
