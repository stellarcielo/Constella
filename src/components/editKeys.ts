// ⌘Z・⌘C などの編集キーの振り分け(フェーズ2-2)。
//
// | 押した場所         | ⌘Z / ⇧⌘Z               | ⌘C / ⌘X / ⌘V / ⌘A                |
// | ------------------ | ---------------------- | -------------------------------- |
// | 入力欄             | 入力中の文字の取り消し | 文字のコピー・ペースト           |
// | YAML エディタ      | アプリ全体の取り消し   | 文字のコピー・ペースト           |
// | キャンバスなど     | アプリ全体の取り消し   | 図のコピー・ペースト・すべて選択 |

export type EditAction = "undo" | "redo" | "copy" | "cut" | "paste" | "selectAll";

/** キーを押した場所。input は YAML エディタ以外の、文字を打ち込む欄 */
export type KeyPlace = "input" | "yaml" | "other";

/** 文字を打ち込む種類の input(チェックボックスなどは図の操作を受ける) */
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

export function keyPlace(target: EventTarget | null): KeyPlace {
  if (target instanceof HTMLTextAreaElement) return "input";
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type) ? "input" : "other";
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return target.closest(".cm-editor") ? "yaml" : "input";
  }
  return "other";
}

type EditKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** アプリが受け持つ編集キーなら、その操作。入力欄などの標準の動作に任せるなら undefined */
export function editActionFor(e: EditKey, place: KeyPlace): EditAction | undefined {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || place === "input") return undefined;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (e.shiftKey || place === "yaml") return undefined;
  switch (key) {
    case "c":
      return "copy";
    case "x":
      return "cut";
    case "v":
      return "paste";
    case "a":
      return "selectAll";
    default:
      return undefined;
  }
}
