import { describe, expect, it } from "vitest";
import { editActionFor, type KeyPlace } from "./editKeys";

function press(key: string, place: KeyPlace, modifiers: { shift?: boolean; ctrl?: boolean } = {}) {
  return editActionFor(
    {
      key,
      metaKey: !modifiers.ctrl,
      ctrlKey: modifiers.ctrl ?? false,
      altKey: false,
      shiftKey: modifiers.shift ?? false,
    },
    place,
  );
}

describe("editActionFor", () => {
  it("キャンバスなどでは、取り消し・コピー・ペースト・すべて選択をアプリで受ける", () => {
    expect(press("z", "other")).toBe("undo");
    expect(press("z", "other", { shift: true })).toBe("redo");
    // Shift を押すと大文字で届く環境もある
    expect(press("Z", "other", { shift: true })).toBe("redo");
    expect(press("c", "other")).toBe("copy");
    expect(press("x", "other")).toBe("cut");
    expect(press("v", "other")).toBe("paste");
    expect(press("a", "other")).toBe("selectAll");
    expect(press("v", "other", { ctrl: true })).toBe("paste");
  });

  it("YAML エディタでは、取り消しだけをアプリで受ける", () => {
    expect(press("z", "yaml")).toBe("undo");
    expect(press("z", "yaml", { shift: true })).toBe("redo");
    expect(press("c", "yaml")).toBeUndefined();
    expect(press("v", "yaml")).toBeUndefined();
    expect(press("a", "yaml")).toBeUndefined();
  });

  it("入力欄では、すべて標準の動作に任せる", () => {
    expect(press("z", "input")).toBeUndefined();
    expect(press("c", "input")).toBeUndefined();
    expect(press("a", "input")).toBeUndefined();
  });

  it("⌘ や Ctrl の無いキー、ほかの組み合わせは受けない", () => {
    expect(
      editActionFor(
        { key: "c", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
        "other",
      ),
    ).toBeUndefined();
    expect(
      editActionFor(
        { key: "z", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false },
        "other",
      ),
    ).toBeUndefined();
    expect(press("s", "other")).toBeUndefined();
    expect(press("v", "other", { shift: true })).toBeUndefined();
  });
});
