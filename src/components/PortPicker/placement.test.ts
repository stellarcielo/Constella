import { describe, expect, it } from "vitest";
import { PICKER_WIDTH, pickerPlacement } from "./placement";

const view = { width: 1600, height: 900 };
const canvas = { left: 240, top: 40, right: 1300, bottom: 874 };
const device = (left: number, top: number) => ({ left, top, right: left + 96, bottom: top + 76 });

describe("pickerPlacement(SPEC 7.2)", () => {
  it("キャンバスに収まれば、デバイスの右に、上端をそろえて開く", () => {
    expect(pickerPlacement(device(400, 300), canvas, view)).toEqual({
      left: 400 + 96 + 12,
      top: 300,
      maxHeight: 420,
    });
  });

  it("右に収まらなければ、デバイスの左に開く", () => {
    expect(pickerPlacement(device(1100, 300), canvas, view).left).toBe(1100 - 12 - PICKER_WIDTH);
  });

  it("左右どちらにも収まらなければ、キャンバスの右端に寄せる", () => {
    const narrow = { ...canvas, right: 700 };
    expect(pickerPlacement(device(400, 300), narrow, view).left).toBe(700 - 8 - PICKER_WIDTH);
  });

  it("下に収まらず上のほうが広ければ、デバイスの下端にそろえて上へ伸ばす", () => {
    expect(pickerPlacement(device(400, 700), canvas, view)).toEqual({
      left: 400 + 96 + 12,
      bottom: 900 - (700 + 76),
      maxHeight: 420,
    });
  });

  it("キャンバスが低ければ、広いほうに収まるよう高さを縮める。ただし 200 より低くはしない", () => {
    expect(pickerPlacement(device(400, 100), { ...canvas, bottom: 340 }, view)).toMatchObject({
      top: 100,
      maxHeight: 340 - 8 - 100,
    });
    expect(pickerPlacement(device(400, 100), { ...canvas, bottom: 140 }, view).maxHeight).toBe(200);
  });
});
