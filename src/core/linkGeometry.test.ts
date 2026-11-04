import { describe, expect, it } from "vitest";
import {
  endLabelOffset,
  endLabelPositions,
  NAME_DETAIL_LINE,
  nameDetails,
  estimateLabelSize,
  estimateNameWidth,
  offsetLine,
  PARALLEL_GAP,
  parallelSlots,
  placeEndLabels,
  type Point,
  selfLoop,
  slotOffset,
} from "./linkGeometry";

describe("parallelSlots", () => {
  it("同じ 2 台の間のリンクに向きを問わず番号を振る", () => {
    const slots = parallelSlots([
      { id: "1", source: "rt1", target: "sw1" },
      { id: "2", source: "sw1", target: "rt1" },
      { id: "3", source: "rt1", target: "srv1" },
      { id: "4", source: "rt1", target: "sw1" },
      { id: "5", source: "rt1", target: "rt1" },
    ]);
    expect(slots.get("1")).toEqual({ index: 0, count: 3 });
    expect(slots.get("2")).toEqual({ index: 1, count: 3 });
    expect(slots.get("4")).toEqual({ index: 2, count: 3 });
    expect(slots.get("3")).toEqual({ index: 0, count: 1 });
    expect(slots.get("5")).toEqual({ index: 0, count: 1 });
  });
});

describe("slotOffset(Q2)", () => {
  it("中心から左右に等間隔", () => {
    expect(slotOffset({ index: 0, count: 1 })).toBe(0);
    expect([0, 1].map((index) => slotOffset({ index, count: 2 }))).toEqual([
      -PARALLEL_GAP / 2,
      PARALLEL_GAP / 2,
    ]);
    expect([0, 1, 2].map((index) => slotOffset({ index, count: 3 }))).toEqual([
      -PARALLEL_GAP,
      0,
      PARALLEL_GAP,
    ]);
  });
});

describe("offsetLine", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it("線に垂直な向きにずらす", () => {
    expect(offsetLine(a, b, 10, false)).toEqual({ a: { x: 0, y: 10 }, b: { x: 100, y: 10 } });
  });

  it("逆向きのリンクでも、基準の向きが同じなら同じ側にずらす", () => {
    const forward = offsetLine(a, b, 10, false);
    const backward = offsetLine(b, a, 10, true);
    expect(backward).toEqual({ a: forward.b, b: forward.a });
  });

  it("ずらし幅 0 ならそのまま", () => {
    expect(offsetLine(a, b, 0, false)).toEqual({ a, b });
  });
});

describe("endLabelPositions(Q1)", () => {
  it("横向きの線では、アイコンのすぐ外側に置く", () => {
    const { a, b } = endLabelPositions({ x: 0, y: 0 }, { x: 400, y: 0 }, "Gi0/1", "eth0");
    const halfA = estimateLabelSize("Gi0/1").width / 2;
    const halfB = estimateLabelSize("eth0").width / 2;
    expect(a.y).toBe(0);
    expect(a.x).toBeCloseTo(30 + 4 + halfA);
    expect(b.x).toBeCloseTo(400 - 30 - 4 - halfB);
  });

  it("下向きの線では、デバイス名の下まで避ける", () => {
    const { a, b } = endLabelPositions({ x: 0, y: 0 }, { x: 0, y: 400 }, "Gi0/1", "eth0");
    expect(a.y).toBeCloseTo(50 + 4 + 7.5);
    expect(b.y).toBeCloseTo(400 - 30 - 4 - 7.5);
  });

  it("機器が近いときは、ラベル同士が重ならないよう内側に寄せる", () => {
    const { a, b } = endLabelPositions({ x: 0, y: 0 }, { x: 120, y: 0 }, "Gi1/0/48", "Gi1/0/47");
    const half = estimateLabelSize("Gi1/0/48").width / 2;
    expect(b.x - a.x).toBeGreaterThanOrEqual(2 * half - 0.001);
    expect(a.x).toBeGreaterThanOrEqual(half - 0.001);
  });
});

describe("endLabelPositions: 並行リンク", () => {
  const top = { x: 0, y: 0 };
  const bottom = { x: 0, y: 400 };
  /** index 本目のリンクのラベルを、ずらした線の上で求める(キャンバスと書き出しと同じ呼び方) */
  const parallel = (
    index: number,
    count: number,
    aText: string | string[],
    bText: string | string[],
    from = top,
    to = bottom,
    reversed = false,
  ) => {
    const slot = { index, count };
    const line = offsetLine(from, to, slotOffset(slot), reversed);
    return { line, ...endLabelPositions(line.a, line.b, aText, bText, slot, {}, {}, reversed) };
  };

  it("縦の線ではラベルが横に重なるので、何本目かに応じて段違いにする", () => {
    const first = endLabelPositions(top, bottom, "Gi0/1", "Gi0/1", { index: 0, count: 2 });
    const second = endLabelPositions(top, bottom, "Gi0/1", "Gi0/1", { index: 1, count: 2 });
    const height = estimateLabelSize("Gi0/1").height;
    expect(second.a.y - first.a.y).toBeCloseTo(height + 4);
    expect(first.b.y - second.b.y).toBeCloseTo(height + 4);
  });

  const short = { x: 0, y: 120 };

  it("線が短くて段違いでは収まらなければ、2 本は線の左右に分けて並べる", () => {
    const first = parallel(0, 2, "Gi0/1", "Gi0/1", top, short);
    const second = parallel(1, 2, "Gi0/1", "Gi0/1", top, short);
    const { width } = estimateLabelSize("Gi0/1");
    expect(second.a.y).toBeCloseTo(first.a.y);
    expect(Math.abs(second.a.x - first.a.x)).toBeCloseTo(width + 4);
    // ラベルは自分の線の側にあり、自分の線にかかる
    for (const { line, a } of [first, second]) {
      expect(Math.sign(a.x)).toBe(Math.sign(line.a.x));
      expect(Math.abs(a.x - line.a.x)).toBeLessThan(width / 2);
    }
  });

  it("線が短くても、2 本の両端のラベルはどれも重ならない", () => {
    const aText = ["Gi0/1", "trunk 10,20,30"];
    const bText = ["eno1", "bond0"];
    const boxes = [0, 1].flatMap((index) => {
      const { a, b } = parallel(index, 2, aText, bText, top, { x: 0, y: 150 });
      return [
        { ...a, ...estimateLabelSize(aText) },
        { ...b, ...estimateLabelSize(bText) },
      ];
    });
    for (const [i, p] of boxes.entries()) {
      for (const q of boxes.slice(i + 1)) {
        const apart =
          Math.abs(p.x - q.x) >= (p.width + q.width) / 2 ||
          Math.abs(p.y - q.y) >= (p.height + q.height) / 2;
        expect(apart).toBe(true);
      }
    }
  });

  it("3 本で分けるときは、外側の線のラベルを左右に置き、真ん中の線のラベルはその先に置く", () => {
    const [first, middle, last] = [0, 1, 2].map((index) =>
      parallel(index, 3, "Gi0/1", "Gi0/1", top, { x: 0, y: 170 }),
    );
    const { height } = estimateLabelSize("Gi0/1");
    expect(last.a.y).toBeCloseTo(first.a.y);
    expect(Math.sign(last.a.x)).toBe(-Math.sign(first.a.x));
    expect(middle.a.x).toBeCloseTo(0);
    expect(middle.a.y - first.a.y).toBeCloseTo(height + 4);
  });

  it("逆向きのリンクが混ざっても、分けたラベルは自分の線の側に置く", () => {
    // 2 本目は、下のデバイスから上へ向かうリンク(ずらす向きの基準は同じ)
    const first = parallel(0, 2, "Gi0/1", "eth0", top, short);
    const second = parallel(1, 2, "eth0", "Gi0/1", short, top, true);
    expect(Math.sign(second.line.b.x)).toBe(-Math.sign(first.line.a.x));
    // 上の端のラベルは first.a と second.b
    expect(Math.sign(first.a.x)).toBe(Math.sign(first.line.a.x));
    expect(Math.sign(second.b.x)).toBe(Math.sign(second.line.b.x));
    expect(Math.abs(first.a.x - second.b.x)).toBeCloseTo(estimateLabelSize("Gi0/1").width + 4);
  });

  it("横の線ではラベルの高さが間隔に収まるので、段違いにしない", () => {
    const left = { x: 0, y: 0 };
    const right = { x: 400, y: 0 };
    const first = endLabelPositions(left, right, "Gi0/1", "Gi0/1", { index: 0, count: 2 });
    const second = endLabelPositions(left, right, "Gi0/1", "Gi0/1", { index: 1, count: 2 });
    expect(second.a.x).toBeCloseTo(first.a.x);
  });
});

describe("selfLoop(Q5)", () => {
  it("アイコンの右側に描き、2 本目は大きくする", () => {
    const first = selfLoop({ x: 0, y: 0 }, 0);
    const second = selfLoop({ x: 0, y: 0 }, 1);
    expect(first.path.startsWith("M 26,-12 C")).toBe(true);
    expect(first.label.x).toBeGreaterThan(26);
    expect(second.label.x).toBeGreaterThan(first.label.x);
    expect(first.labelA.y).toBeLessThan(0);
    expect(first.labelB.y).toBeGreaterThan(0);
  });

  it("輪の上下のラベルはデバイス名(アイコンの下)と重ならない", () => {
    const { labelA, labelB } = selfLoop({ x: 0, y: 0 }, 0);
    expect(labelA.x).toBeGreaterThan(26);
    expect(labelB.x).toBeGreaterThan(26);
  });

  it("同じデバイスの輪が複数あっても、上下のラベルが重ならない", () => {
    const loops = [0, 1, 2].map((i) => selfLoop({ x: 0, y: 0 }, i));
    for (let i = 1; i < loops.length; i++) {
      expect(loops[i - 1].labelA.y - loops[i].labelA.y).toBeGreaterThanOrEqual(15);
      expect(loops[i].labelB.y - loops[i - 1].labelB.y).toBeGreaterThanOrEqual(15);
    }
  });

  it("中央のラベルは文字の幅だけ右に出す", () => {
    const short = selfLoop({ x: 0, y: 0 }, 0, "a");
    const long = selfLoop({ x: 0, y: 0 }, 0, "a long label");
    expect(long.label.x).toBeGreaterThan(short.label.x);
  });
});

describe("複数行のラベル(IF 名の下の IP・VLAN。フェーズ3-2)", () => {
  const lines = ["Gi0/1", "192.168.10.1/24", "VLAN 10"];

  it("幅はいちばん長い行、高さは行数で見積もる", () => {
    expect(estimateLabelSize(lines)).toEqual({
      width: estimateLabelSize("192.168.10.1/24").width,
      height: 3 * 13 + 2,
    });
    expect(estimateLabelSize(["Gi0/1"])).toEqual(estimateLabelSize("Gi0/1"));
  });

  it("下へ出る線でも、ラベルがアイコンと名前に重ならない", () => {
    const { a } = endLabelPositions({ x: 0, y: 0 }, { x: 0, y: 400 }, lines, "eth0");
    // アイコンの中心から下 50 までがアイコンとデバイス名
    expect(a.y - estimateLabelSize(lines).height / 2).toBeGreaterThanOrEqual(50);
  });

  it("横の並行リンクでも、背の高いラベルは段違いにして重ねない", () => {
    const left = { x: 0, y: 0 };
    const right = { x: 600, y: 0 };
    const first = endLabelPositions(left, right, lines, lines, { index: 0, count: 2 });
    const second = endLabelPositions(left, right, lines, lines, { index: 1, count: 2 });
    expect(second.a.x - first.a.x).toBeGreaterThanOrEqual(estimateLabelSize(lines).width);
  });

  it("横の線が短ければ、背の高いラベルは線の上下に分けて重ねない", () => {
    const left = { x: 0, y: 0 };
    const right = { x: 300, y: 0 };
    const [first, second] = [0, 1].map((index) => {
      const slot = { index, count: 2 };
      const line = offsetLine(left, right, slotOffset(slot), false);
      return endLabelPositions(line.a, line.b, lines, lines, slot);
    });
    expect(second.a.x).toBeCloseTo(first.a.x);
    expect(Math.abs(second.a.y - first.a.y)).toBeCloseTo(estimateLabelSize(lines).height + 4);
  });

  it("自分自身への輪の上下のラベルは、高さの分だけ輪から離す", () => {
    const single = selfLoop({ x: 0, y: 0 }, 0);
    const tall = selfLoop({ x: 0, y: 0 }, 0, "", { a: lines, b: lines });
    const extra = (estimateLabelSize(lines).height - estimateLabelSize("x").height) / 2;
    expect(tall.labelA.y).toBeCloseTo(single.labelA.y - extra);
    expect(tall.labelB.y).toBeCloseTo(single.labelB.y + extra);
  });
});

describe("デバイス名を避ける(フェーズ3-2)", () => {
  it("斜め下へ出る線のラベルは、アイコンより幅の広いデバイス名にも重ならない", () => {
    const lines = ["Te1/1/1", "trunk 10,20,30"];
    const name = estimateNameWidth("コアスイッチ");
    const size = estimateLabelSize(lines);
    const overlapsName = (at: { x: number; y: number }) =>
      at.x - size.width / 2 < name / 2 &&
      at.x + size.width / 2 > -name / 2 &&
      at.y - size.height / 2 < 50 &&
      at.y + size.height / 2 > 26;
    const from = { x: 0, y: 0 };
    const to = { x: -300, y: 150 };
    // 名前の幅を知らなければ(アイコンの幅とみなすので)名前に重なる
    expect(overlapsName(endLabelPositions(from, to, lines, "Te0/25").a)).toBe(true);
    const { a } = endLabelPositions(from, to, lines, "Te0/25", undefined, { a: name });
    expect(overlapsName(a)).toBe(false);
  });

  it("名前の幅は、全角を 12px・半角を 7px として見積もる", () => {
    expect(estimateNameWidth("rt1")).toBe(12 + 3 * 7);
    expect(estimateNameWidth("コア")).toBe(12 + 2 * 12);
  });
});

describe("endLabelPositions: 名前の下の行(フェーズ4-3 Q1)", () => {
  it("名前の下に行があれば、その行も避けて外側に置く", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 400 };
    const plain = endLabelPositions(a, b, "eno1", "x");
    const withLines = endLabelPositions(
      a,
      b,
      "eno1",
      "x",
      undefined,
      {},
      {
        a: nameDetails(["bond1 10.20.0.11/24", "vlan30 10.30.0.11/24"]),
      },
    );
    expect(withLines.a.y).toBeGreaterThan(plain.a.y + 2 * NAME_DETAIL_LINE - 1);
    expect(nameDetails([])).toBeUndefined();
  });
});

describe("placeEndLabels: 同じデバイスに付く、別々の線のラベル(SPEC 7.3)", () => {
  type Text = string | string[];
  const end = (node: string, center: Point, text: Text) => ({ node, center, text });
  /** 中心と行から見た 2 つのラベルが重なるか(接しているだけなら重ならない) */
  const overlaps = (p: Point, pText: Text, q: Point, qText: Text) => {
    const ps = estimateLabelSize(pText);
    const qs = estimateLabelSize(qText);
    return (
      Math.abs(p.x - q.x) < (ps.width + qs.width) / 2 - 1e-6 &&
      Math.abs(p.y - q.y) < (ps.height + qs.height) / 2 - 1e-6
    );
  };
  /** p が from と to を結ぶ線の上にあるか */
  const onLine = (p: Point, from: Point, to: Point) =>
    Math.abs((to.x - from.x) * (p.y - from.y) - (to.y - from.y) * (p.x - from.x)) /
      Math.hypot(to.x - from.x, to.y - from.y) <
    1e-6;

  it("近い角度の 2 本では、デバイスに近いラベルはそのままにし、遠いほうを線に沿って外へずらす", () => {
    // pve2 から、横の pve1 へ corosync の線、左上の sw1 へ bond の線
    const pve2 = { x: 0, y: 0 };
    const pve1 = { x: -500, y: 0 };
    const sw1 = { x: -500, y: -140 };
    const eno3 = ["eno3", "10.10.0.2/24 (corosync)"];
    const eno1 = ["eno1", "bond0"];
    const before = {
      corosync: endLabelPositions(pve2, pve1, eno3, "eno3"),
      bond: endLabelPositions(pve2, sw1, eno1, "Gi0/3"),
    };
    expect(overlaps(before.corosync.a, eno3, before.bond.a, eno1)).toBe(true);
    const [corosync, bond] = placeEndLabels([
      { a: end("pve2", pve2, eno3), b: end("pve1", pve1, "eno3") },
      { a: end("pve2", pve2, eno1), b: end("sw1", sw1, "Gi0/3") },
    ]);
    expect(bond.a).toEqual(before.bond.a);
    expect(onLine(corosync.a, pve2, pve1)).toBe(true);
    expect(corosync.a.x).toBeLessThan(before.corosync.a.x);
    expect(overlaps(corosync.a, eno3, bond.a, eno1)).toBe(false);
    // 反対の端のラベルは動かさない
    expect(corosync.b).toEqual(before.corosync.b);
    expect(bond.b).toEqual(before.bond.b);
  });

  it("ほぼ同じ向きの 3 本では、ラベルが線に沿って段違いに並び、どれも重ならない", () => {
    const sw = { x: 0, y: 0 };
    const targets = [
      { x: 600, y: -220 },
      { x: 600, y: -150 },
      { x: 600, y: -105 },
    ];
    const names = ["Gi0/5", "Gi0/2", "Gi0/3"];
    const before = targets.map((to, i) => endLabelPositions(sw, to, names[i], "eth0").a);
    expect(overlaps(before[0], names[0], before[1], names[1])).toBe(true);
    const placed = placeEndLabels(
      targets.map((to, i) => ({ a: end("sw", sw, names[i]), b: end(`d${i}`, to, "eth0") })),
    );
    for (const [i, { a }] of placed.entries()) {
      expect(onLine(a, sw, targets[i])).toBe(true);
      for (const [j, other] of placed.entries()) {
        if (j > i) expect(overlaps(a, names[i], other.a, names[j])).toBe(false);
      }
    }
  });

  it("重ならなければ、線ごとに置いた位置のまま(並行リンクも)", () => {
    const c = { x: 0, y: 0 };
    const right = { x: 300, y: 0 };
    const lines = [
      { a: end("c", c, "Gi0/1"), b: end("up", { x: 0, y: -300 }, "eth0") },
      { a: end("c", c, "Gi0/2"), b: end("down", { x: 0, y: 300 }, "eth0") },
      { a: end("left", { x: -300, y: 0 }, "eth0"), b: end("c", c, "Gi0/3") },
      // 横の並行リンク 2 本(ラベルは段違いにせず、上下に並ぶ)
      { a: end("c", c, "Gi0/4"), b: end("right", right, "eth0"), slot: { index: 0, count: 2 } },
      { a: end("c", c, "Gi0/5"), b: end("right", right, "eth1"), slot: { index: 1, count: 2 } },
    ];
    const expected = lines.map(({ a, b, slot = { index: 0, count: 1 } }) => {
      const line = offsetLine(a.center, b.center, slotOffset(slot), false);
      return endLabelPositions(line.a, line.b, a.text, b.text, slot);
    });
    expect(placeEndLabels(lines)).toEqual(expected);
  });

  it("線が短ければ、反対の端のラベルの手前までしかずらさない", () => {
    const sw = { x: 0, y: 0 };
    const pc = { x: -170, y: -26 };
    const [, short] = placeEndLabels([
      { a: end("sw", sw, "Gi0/1"), b: end("rt", { x: -600, y: 0 }, "Gi0/0") },
      { a: end("sw", sw, "Gi0/2"), b: end("pc", pc, "eth0") },
    ]);
    const before = endLabelPositions(sw, pc, "Gi0/2", "eth0");
    expect(short.a.x).toBeLessThan(before.a.x);
    expect(onLine(short.a, sw, pc)).toBe(true);
    expect(short.b).toEqual(before.b);
    // 線の向きで測ると、反対の端のラベル(eth0)に接したところで止まる
    const len = Math.hypot(pc.x, pc.y);
    const along = (p: Point) => (p.x * pc.x + p.y * pc.y) / len;
    const half = (text: string) => {
      const { width, height } = estimateLabelSize(text);
      return (Math.abs(pc.x) * width + Math.abs(pc.y) * height) / 2 / len;
    };
    expect(along(short.b) - along(short.a)).toBeCloseTo(half("Gi0/2") + half("eth0"));
  });

  it("片方の端だけにラベルがある線(ブリッジとホストの間)も、同じデバイスのラベルとして避ける", () => {
    const host = { x: 0, y: 0 };
    const bond = ["bond0", "eno1 + eno2(802.3ad)"];
    const before = {
      link: endLabelPositions(host, { x: 60, y: 400 }, "eno3", "Gi0/1"),
      uplink: endLabelPositions({ x: -40, y: 300 }, host, [], bond),
    };
    expect(overlaps(before.link.a, "eno3", before.uplink.b, bond)).toBe(true);
    const [link, uplink] = placeEndLabels([
      { a: end("pve1", host, "eno3"), b: end("sw1", { x: 60, y: 400 }, "Gi0/1") },
      { a: end("pve1/vmbr0", { x: -40, y: 300 }, []), b: end("pve1", host, bond) },
    ]);
    expect(overlaps(link.a, "eno3", uplink.b, bond)).toBe(false);
  });

  it("手で動かしたラベルは、線の端から線に沿った距離と、外を向いて右へのずれの位置に置く", () => {
    const [placed] = placeEndLabels([
      {
        a: { ...end("r1", { x: 0, y: 0 }, "Gi0/1"), offset: { along: 80, side: 20 } },
        b: { ...end("r2", { x: 400, y: 0 }, "Gi0/1"), offset: { along: 50, side: 10 } },
      },
    ]);
    // r1 から右を向くと右は下、r2 から左を向くと右は上
    expect(placed.a).toEqual({ x: 80, y: 20 });
    expect(placed.b).toEqual({ x: 350, y: -10 });
  });

  it("ドロップした点から求めた位置に置くと、その点に戻る(並行リンクのずらした線でも)", () => {
    const line = {
      a: end("r1", { x: 0, y: 0 }, "Gi0/1"),
      b: end("r2", { x: 300, y: 200 }, "Gi0/1"),
      slot: { index: 1, count: 2 },
    };
    const at = { x: 90, y: 20 };
    const offset = endLabelOffset(line, "a", at);
    const [placed] = placeEndLabels([{ ...line, a: { ...line.a, offset } }]);
    // 位置は整数に丸めて覚えるので、1px 以内
    expect(Math.hypot(placed.a.x - at.x, placed.a.y - at.y)).toBeLessThan(1);
  });

  it("手で動かしたラベルはずらさず、ほかのラベルがそれを避ける", () => {
    const c = { x: 0, y: 0 };
    const down = { x: 0, y: 300 };
    const before = endLabelPositions(c, down, "Gi0/1", "eth0").a;
    // 右への線のラベルを、下への線のラベルのところに手で置く
    const side = Math.round(before.y);
    const [toDown, toRight] = placeEndLabels([
      { a: end("c", c, "Gi0/1"), b: end("d", down, "eth0") },
      {
        a: { ...end("c", c, "Gi0/2"), offset: { along: 0, side } },
        b: end("r", { x: 300, y: 0 }, "eth0"),
      },
    ]);
    expect(toRight.a).toEqual({ x: 0, y: side });
    expect(onLine(toDown.a, c, down)).toBe(true);
    expect(toDown.a.y).toBeGreaterThan(before.y);
    expect(overlaps(toDown.a, "Gi0/1", toRight.a, "Gi0/2")).toBe(false);
  });
});
