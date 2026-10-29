import { describe, expect, it } from "vitest";
import {
  endLabelPositions,
  estimateLabelSize,
  estimateNameWidth,
  offsetLine,
  PARALLEL_GAP,
  parallelSlots,
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

  it("縦の線ではラベルが横に重なるので、何本目かに応じて段違いにする", () => {
    const first = endLabelPositions(top, bottom, "Gi0/1", "Gi0/1", { index: 0, count: 2 });
    const second = endLabelPositions(top, bottom, "Gi0/1", "Gi0/1", { index: 1, count: 2 });
    const height = estimateLabelSize("Gi0/1").height;
    expect(second.a.y - first.a.y).toBeCloseTo(height + 4);
    expect(first.b.y - second.b.y).toBeCloseTo(height + 4);
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
