import { describe, expect, it } from "vitest";
import { GUIDE_OVERHANG, type Guide, snapPoint, SPACING_TICK } from "./snap";

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

describe("snapPoint: 等間隔(SPEC 7.4)", () => {
  const spacing = { band: 52, inset: 26 };
  const at = (x: number, y: number) => ({ x, y });
  /** 等間隔のガイドの、すき間の線(両端の短い線を除く)を [始まり, 終わり] で */
  const spans = (guides: Guide[]) =>
    guides
      .filter((g) => g.spacing && (g.from.x !== g.to.x || g.from.y === g.to.y))
      .map((g) => [g.from, g.to]);

  it("両隣の 2 台の真ん中に吸い付く", () => {
    const targets = [at(0, 0), at(200, 0)];
    expect(snapPoint(at(103, 10), targets, 8, undefined, spacing).point).toEqual(at(100, 10));
  });

  it("隣の 2 台の間隔を延ばした位置に吸い付く(右にも左にも)", () => {
    const targets = [at(0, 0), at(100, 0)];
    expect(snapPoint(at(196, 4), targets, 8, undefined, spacing).point).toEqual(at(200, 0));
    expect(snapPoint(at(-97, 4), targets, 8, undefined, spacing).point).toEqual(at(-100, 0));
  });

  it("縦の列でも同じ", () => {
    const targets = [at(0, 0), at(0, 120)];
    expect(snapPoint(at(10, 237), targets, 8, undefined, spacing).point).toEqual(at(10, 240));
  });

  it("同じ行でなければ(中心の縦のずれが band 以上)吸い付かない。spacing を渡さなければ使わない", () => {
    const targets = [at(0, 0), at(200, 0)];
    expect(snapPoint(at(103, 60), targets, 8, undefined, spacing).point).toEqual(at(103, 60));
    expect(snapPoint(at(103, 10), targets, 8).point).toEqual(at(103, 10));
  });

  it("そろえる位置と近いほうに合わせ、同じ距離ならそろえるほう", () => {
    const targets = [at(0, 0), at(200, 0), at(104, 300)];
    expect(snapPoint(at(102, 0), targets, 8, undefined, spacing).point.x).toBe(104);
    expect(snapPoint(at(101, 0), targets, 8, undefined, spacing).point.x).toBe(100);
  });

  it("ガイドは、間隔ごとにアイコンのすき間に線を引き、両端に短い線を付ける", () => {
    const { guides } = snapPoint(at(103, 0), [at(0, 0), at(200, 0)], 8, undefined, spacing);
    expect(spans(guides)).toEqual([
      [at(26, 0), at(74, 0)],
      [at(126, 0), at(174, 0)],
    ]);
    expect(guides.filter((g) => g.spacing)).toContainEqual({
      from: at(26, -SPACING_TICK / 2),
      to: at(26, SPACING_TICK / 2),
      spacing: true,
    });
  });

  it("同じ間隔で続いている点の間にもガイドを出し、違う間隔の点で止める", () => {
    const targets = [at(-300, 0), at(-100, 0), at(0, 0), at(130, 0)];
    const { point, guides } = snapPoint(at(97, 0), targets, 8, undefined, spacing);
    // 0 と -100 の間隔を延ばした 100(130 との真ん中 65 より近い)
    expect(point).toEqual(at(100, 0));
    expect(spans(guides)).toEqual([
      [at(26, 0), at(74, 0)],
      [at(-74, 0), at(-26, 0)],
    ]);
  });
});
