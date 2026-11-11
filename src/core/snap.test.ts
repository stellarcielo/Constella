import { describe, expect, it } from "vitest";
import { GUIDE_OVERHANG, snapPoint } from "./snap";

describe("snapPoint(SPEC 7.4)", () => {
  const targets = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
    { x: 200, y: 0 },
  ];

  it("縦・横それぞれ、近い点にそろえる。離れていればそのまま", () => {
    expect(snapPoint({ x: 104, y: 120 }, targets, 8).point).toEqual({ x: 100, y: 120 });
    expect(snapPoint({ x: 60, y: 3 }, targets, 8).point).toEqual({ x: 60, y: 0 });
    expect(snapPoint({ x: 60, y: 120 }, targets, 8).point).toEqual({ x: 60, y: 120 });
  });

  it("両方に近ければ、いちばん近い点にそろえる", () => {
    expect(snapPoint({ x: 3, y: 47 }, [{ x: 5, y: 0 }, ...targets], 8).point).toEqual({
      x: 5,
      y: 50,
    });
  });

  it("ガイドは、そろった点どうしを結び、両端を少しはみ出す", () => {
    const { guides } = snapPoint({ x: 150, y: 4 }, targets, 8);
    expect(guides).toEqual([
      {
        from: { x: -GUIDE_OVERHANG, y: 0 },
        to: { x: 200 + GUIDE_OVERHANG, y: 0 },
      },
    ]);
    // 縦にそろえたときは、その縦の線
    expect(snapPoint({ x: 98, y: 200 }, targets, 8).guides).toEqual([
      {
        from: { x: 100, y: 50 - GUIDE_OVERHANG },
        to: { x: 100, y: 200 + GUIDE_OVERHANG },
      },
    ]);
  });

  it("グリッドを使うときは、そろう点の無い向きだけ方眼に合わせ、そのガイドは出さない", () => {
    const { point, guides } = snapPoint({ x: 47, y: 3 }, targets, 8, 20);
    expect(point).toEqual({ x: 40, y: 0 });
    expect(guides).toHaveLength(1);
    expect(snapPoint({ x: 47, y: 133 }, targets, 8, 20)).toEqual({
      point: { x: 40, y: 140 },
      guides: [],
    });
  });
});
