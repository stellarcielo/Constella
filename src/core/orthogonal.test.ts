import { describe, expect, it } from "vitest";
import { estimateLabelSize, placeEndLabels, type Point } from "./linkGeometry";
import {
  attachEnds,
  bridgeRouteNode,
  deviceRouteNode,
  type OrthogonalRoute,
  orthogonalRoutes,
  type RouteLine,
  type RouteNode,
} from "./orthogonal";

/** デバイスのノード(中心の座標) */
function devices(centers: Record<string, readonly [number, number]>): Map<string, RouteNode> {
  return new Map(
    Object.entries(centers).map(([id, [x, y]]) => [id, deviceRouteNode({ x, y })] as const),
  );
}

const line = (id: string, a: string, b: string): RouteLine => ({ id, a, b });

const last = (points: readonly Point[]): Point => points[points.length - 1];

function route(routes: Map<string, OrthogonalRoute>, id: string): Point[] {
  const found = routes.get(id);
  if (!found) throw new Error(`${id} の道筋がありません`);
  return found.points;
}

interface Segment {
  id: string;
  p: Point;
  q: Point;
}

function segments(routes: Map<string, OrthogonalRoute>): Segment[] {
  return [...routes].flatMap(([id, { points }]) =>
    points.slice(1).map((q, i) => ({ id, p: points[i], q })),
  );
}

/** 別々の線の、縦どうし・横どうしの区間が重なっている数 */
function collinearOverlaps(routes: Map<string, OrthogonalRoute>): number {
  const segs = segments(routes);
  let count = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i];
      const t = segs[j];
      if (s.id === t.id) continue;
      for (const axis of ["x", "y"] as const) {
        const other = axis === "x" ? "y" : "x";
        // axis が同じ値の区間(縦の線なら x が同じ)どうしで、other の範囲が重なる
        if (s.p[axis] !== s.q[axis] || t.p[axis] !== t.q[axis]) continue;
        if (Math.abs(s.p[axis] - t.p[axis]) > 0.5) continue;
        const lo = Math.max(Math.min(s.p[other], s.q[other]), Math.min(t.p[other], t.q[other]));
        const hi = Math.min(Math.max(s.p[other], s.q[other]), Math.max(t.p[other], t.q[other]));
        if (hi - lo > 0.5) count++;
      }
    }
  }
  return count;
}

/** 別々の線の、縦の区間と横の区間が交わっている数(端どうしが接するだけのものは数えない) */
function crossings(routes: Map<string, OrthogonalRoute>): number {
  const segs = segments(routes);
  const inside = (v: number, a: number, b: number) => v > Math.min(a, b) && v < Math.max(a, b);
  let count = 0;
  for (const s of segs) {
    if (s.p.x !== s.q.x) continue;
    for (const t of segs) {
      if (s.id === t.id || t.p.y !== t.q.y) continue;
      if (inside(s.p.x, t.p.x, t.q.x) && inside(t.p.y, s.p.y, s.q.y)) count++;
    }
  }
  return count;
}

describe("orthogonalRoutes(SPEC 7.3)", () => {
  it("上下に離れた 2 台は縦 → 横 → 縦。横の線は、上の機器の名前と下のアイコンの間の真ん中", () => {
    const routes = orthogonalRoutes([line("l", "a", "b")], devices({ a: [0, 0], b: [200, 200] }));
    // 上の機器の名前の下(50)から、下の機器のアイコンの上(170)までの真ん中
    expect(route(routes, "l")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 110 },
      { x: 200, y: 110 },
      { x: 200, y: 200 },
    ]);
    expect(routes.get("l")?.ends).toEqual({
      a: { index: 0, count: 1, gap: 0 },
      b: { index: 0, count: 1, gap: 0 },
    });
  });

  it("横に並んだ 2 台は横 → 縦 → 横。下から上へ引く線は、点も b から a の順", () => {
    const routes = orthogonalRoutes(
      [line("h", "a", "b"), line("up", "b2", "a2")],
      devices({ a: [0, 0], b: [300, 40], a2: [0, 1000], b2: [0, 1200] }),
    );
    expect(route(routes, "h")).toEqual([
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 40 },
      { x: 300, y: 40 },
    ]);
    expect(route(routes, "up")).toEqual([
      { x: 0, y: 1200 },
      { x: 0, y: 1000 },
    ]);
  });

  it("縦にすき間があれば縦を優先し、どちらのすき間も無ければ中心どうしをまっすぐ結ぶ", () => {
    // 縦のすき間が 120 - 50 - 30 = 40 あるので、横に遠くても縦から出す
    const vertical = orthogonalRoutes([line("v", "a", "b")], devices({ a: [0, 0], b: [400, 120] }));
    expect(route(vertical, "v")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 70 },
      { x: 400, y: 70 },
      { x: 400, y: 120 },
    ]);
    // 縦のすき間が 100 - 50 - 30 = 20 しかなければ横から出す。c と d は重なっているので、まっすぐ
    const routes = orthogonalRoutes(
      [line("h", "a", "b"), line("s", "c", "d")],
      devices({ a: [0, 0], b: [400, 100], c: [1000, 0], d: [1020, 10] }),
    );
    expect(route(routes, "h")).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 400, y: 100 },
    ]);
    expect(route(routes, "s")).toEqual([
      { x: 1000, y: 0 },
      { x: 1020, y: 10 },
    ]);
  });

  it("同じ辺から出る線は、行き先の向きの順に、出る位置をずらす(真下の線はまっすぐ)", () => {
    const routes = orthogonalRoutes(
      [line("ab", "a", "b"), line("ac", "a", "c"), line("ad", "a", "d")],
      devices({ a: [0, 0], b: [-200, 200], c: [0, 200], d: [200, 200] }),
    );
    expect(route(routes, "ab")[0]).toEqual({ x: -18, y: 0 });
    expect(route(routes, "ac")).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 200 },
    ]);
    expect(route(routes, "ad")[0]).toEqual({ x: 18, y: 0 });
    // 左右に分かれる横の線は重ならないので、同じ段。線の多い上の端(3 本)から離し、すき間の 2/3 の所
    expect(route(routes, "ab")[1].y).toBe(50 + (120 * 2) / 3);
    expect(route(routes, "ad")[1].y).toBe(50 + (120 * 2) / 3);
    expect(crossings(routes)).toBe(0);
  });

  it("中ほどの線は、線の多い端から離す(すき間の 1/3〜2/3 の間)", () => {
    const children: Record<string, [number, number]> = { a: [0, 0] };
    const lines: RouteLine[] = [];
    for (let i = 0; i < 6; i++) {
      children[`c${i}`] = [-500 + i * 200, 200];
      lines.push(line(`l${i}`, "a", `c${i}`));
    }
    const routes = orthogonalRoutes(lines, devices(children));
    // 6 本と 1 本でも、2/3 より下には寄せない。左へ曲がる 3 本は、その位置を真ん中にして段をずらす
    const levels = ["l0", "l1", "l2"].map((id) => route(routes, id)[1].y);
    expect(levels).toEqual([112, 130, 148]);
  });

  it("辺に収まらないほど多いときは、間隔を詰める", () => {
    const children: Record<string, [number, number]> = { a: [0, 0] };
    const lines: RouteLine[] = [];
    for (let i = 0; i < 4; i++) {
      children[`c${i}`] = [-300 + i * 200, 200];
      lines.push(line(`l${i}`, "a", `c${i}`));
    }
    const routes = orthogonalRoutes(lines, devices(children));
    const xs = lines.map((l) => route(routes, l.id)[0].x);
    // アイコンの半分(26)から角の分(6)を除いた ±20 に収める
    expect(xs.map((x) => Math.round(x * 100) / 100)).toEqual([-20, -6.67, 6.67, 20]);
    expect(routes.get("l0")?.ends.a).toMatchObject({ count: 4, gap: 40 / 3 });
  });

  it("同じ向きに曲がる線は、外側の線が先に曲がる(交わらない)", () => {
    const routes = orthogonalRoutes(
      [line("near", "a", "c"), line("far", "a", "b")],
      devices({ a: [0, 0], b: [-400, 200], c: [-200, 200] }),
    );
    const far = route(routes, "far");
    const near = route(routes, "near");
    expect(far[0].x).toBeLessThan(near[0].x);
    expect(far[1].y).toBeLessThan(near[1].y);
    expect(crossings(routes)).toBe(0);
    expect(collinearOverlaps(routes)).toBe(0);
  });

  it("同じ 2 台の間の線(LAG)は、向きが混ざっていても交わらずに並ぶ", () => {
    const routes = orthogonalRoutes(
      [line("l1", "a", "b"), line("l2", "b", "a")],
      devices({ a: [0, 0], b: [200, 200] }),
    );
    const l1 = route(routes, "l1");
    const l2 = route(routes, "l2");
    // l1 は両端とも右、l2 は両端とも左
    expect(l1[0].x).toBe(9);
    expect(l1[3].x).toBe(209);
    expect(l2[3].x).toBe(-9);
    expect(l2[0].x).toBe(191);
    expect(crossings(routes)).toBe(0);
    expect(collinearOverlaps(routes)).toBe(0);
  });

  it("2 台のコアと 4 台のスイッチをすべて結んでも、線は重ならない", () => {
    const centers: Record<string, [number, number]> = { core1: [-100, 0], core2: [100, 0] };
    const lines: RouteLine[] = [line("cc", "core1", "core2")];
    for (let i = 0; i < 4; i++) {
      centers[`sw${i}`] = [-300 + i * 200, 200];
      lines.push(line(`a${i}`, "core1", `sw${i}`), line(`b${i}`, "core2", `sw${i}`));
    }
    const routes = orthogonalRoutes(lines, devices(centers));
    expect(collinearOverlaps(routes)).toBe(0);
    // コアどうしは横に並ぶので、まっすぐの横の線
    expect(route(routes, "cc")).toEqual([
      { x: -100, y: 0 },
      { x: 100, y: 0 },
    ]);
    // 同じ入力なら同じ結果
    expect(orthogonalRoutes(lines, devices(centers))).toEqual(routes);
  });

  it("ノードの無い線と、自分自身へのリンクは入れない", () => {
    const routes = orthogonalRoutes(
      [line("self", "a", "a"), line("missing", "a", "x")],
      devices({ a: [0, 0] }),
    );
    expect(routes.size).toBe(0);
  });

  it("ブリッジの箱は、箱の大きさで出る位置とすき間を決める", () => {
    const nodes = new Map([
      ["host", deviceRouteNode({ x: 0, y: 0 })],
      ["host:vmbr0", bridgeRouteNode({ x: 0, y: 120 }, 1)],
      ["vm1", deviceRouteNode({ x: -60, y: 240 })],
      ["vm2", deviceRouteNode({ x: 60, y: 240 })],
    ]);
    const routes = orthogonalRoutes(
      [
        line("u", "host:vmbr0", "host"),
        line("g1", "vm1", "host:vmbr0"),
        line("g2", "vm2", "host:vmbr0"),
      ],
      nodes,
    );
    expect(route(routes, "u")).toEqual([
      { x: 0, y: 120 },
      { x: 0, y: 0 },
    ]);
    // 箱の下の辺から 2 本(±9)。箱の下の 1 行(14px)の下から vm のアイコンの上までの、箱から 2/3 の所
    expect(last(route(routes, "g1"))).toEqual({ x: -9, y: 120 });
    expect(last(route(routes, "g2"))).toEqual({ x: 9, y: 120 });
    const top = 120 + 13 + 4 + 14;
    expect(route(routes, "g1")[1].y).toBeCloseTo(top + ((210 - top) * 2) / 3);
  });
});

describe("attachEnds", () => {
  const a = deviceRouteNode({ x: 0, y: 0 });
  const b = deviceRouteNode({ x: 200, y: 200 });

  it("最初の点がアイコンの幅の中にあれば、アイコンから縦(横)にまっすぐ出す", () => {
    expect(
      attachEnds(
        [
          { x: 0, y: 0 },
          { x: 10, y: 100 },
          { x: 190, y: 100 },
          { x: 200, y: 200 },
        ],
        a,
        b,
      ),
    ).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 100 },
      { x: 190, y: 100 },
      { x: 190, y: 200 },
    ]);
    expect(
      attachEnds(
        [
          { x: 0, y: 0 },
          { x: 100, y: 5 },
          { x: 200, y: 200 },
        ],
        a,
        b,
      )[0],
    ).toEqual({ x: 0, y: 5 });
  });

  it("アイコンの幅の外なら、中心からそのまま。曲げていない線は変えない", () => {
    const bent = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ];
    expect(attachEnds(bent, a, b)).toEqual(bent);
    const straight = [
      { x: 0, y: 0 },
      { x: 200, y: 200 },
    ];
    expect(attachEnds(straight, a, b)).toEqual(straight);
  });
});

describe("placeEndLabels(直角の線)", () => {
  it("ラベルは端の区間(縦の線)の上に置き、同じ辺から出る線のラベルは重ならない", () => {
    const centers = { a: [0, 0], b: [-200, 300], c: [0, 300], d: [200, 300] } as const;
    const routes = orthogonalRoutes(
      [line("ab", "a", "b"), line("ac", "a", "c"), line("ad", "a", "d")],
      devices(centers),
    );
    const text = "Gi0/1";
    const ids = ["ab", "ac", "ad"];
    const placed = placeEndLabels(
      ids.map((id) => {
        const r = routes.get(id) as OrthogonalRoute;
        const other = id[1] as "b" | "c" | "d";
        return {
          a: { node: "a", center: { x: 0, y: 0 }, text },
          b: { node: other, center: { x: centers[other][0], y: centers[other][1] }, text },
          points: r.points,
          ends: r.ends,
        };
      }),
    );
    const size = estimateLabelSize(text);
    const boxes = placed.map(({ a: at }) => ({ at, ...size }));
    for (let i = 0; i < boxes.length; i++) {
      // 機器の名前(下端 50)より下で、最初の角より上
      expect(boxes[i].at.y - size.height / 2).toBeGreaterThan(50);
      expect(boxes[i].at.y).toBeLessThan(route(routes, ids[i])[1]?.y ?? 300);
      for (let j = i + 1; j < boxes.length; j++) {
        const overlapX = Math.abs(boxes[i].at.x - boxes[j].at.x) < size.width;
        const overlapY = Math.abs(boxes[i].at.y - boxes[j].at.y) < size.height;
        expect(overlapX && overlapY).toBe(false);
      }
    }
    // 下の機器の側は、それぞれの縦の線の上(アイコンの上)
    placed.forEach(({ b: at }, i) => {
      expect(at.x).toBeCloseTo(last(route(routes, ids[i])).x);
      expect(at.y).toBeLessThan(300 - 30);
    });
  });
});
