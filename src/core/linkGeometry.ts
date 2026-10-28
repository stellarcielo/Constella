// リンクの線とラベルの位置の計算(SPEC 7.3)。キャンバスと SVG の書き出しで共有する。
// 座標はフロー座標で、点はデバイスのアイコンの中心。

export interface Point {
  x: number;
  y: number;
}

/** 並行リンクの間隔(ラベルが重ならない幅) */
export const PARALLEL_GAP = 18;

/** IF 名ラベルの大きさの見積もり(Canvas.css の .link-if-label と合わせる) */
const CHAR_WIDTH = 6.2;
const LABEL_PADDING_X = 8;
const LABEL_HEIGHT = 15;

/**
 * アイコンの中心から見た、ラベルを置いてはいけない範囲。
 * アイコン(52px 角)と、その下のデバイス名のラベルを覆う。
 */
const AVOID = { left: 30, right: 30, top: 30, bottom: 50 };
const LABEL_GAP = 4;

export interface Slot {
  /** 同じ 2 台の間のリンクのうち何本目か(0 始まり) */
  index: number;
  count: number;
}

/**
 * 同じ 2 台の間(向きは問わない)のリンクに番号を振る。
 * 自分自身へのリンクも、同じデバイスごとに番号を振る(ループの大きさに使う)。
 */
export function parallelSlots(
  links: { id: string; source: string; target: string }[],
): Map<string, Slot> {
  const groups = new Map<string, string[]>();
  for (const link of links) {
    const key = [link.source, link.target].sort().join("\u0000");
    const ids = groups.get(key);
    if (ids) ids.push(link.id);
    else groups.set(key, [link.id]);
  }
  const slots = new Map<string, Slot>();
  for (const ids of groups.values()) {
    ids.forEach((id, index) => slots.set(id, { index, count: ids.length }));
  }
  return slots;
}

/** 並行リンクのずらし幅。2 本なら ±9、3 本なら -18, 0, +18 */
export function slotOffset(slot: Slot): number {
  return (slot.index - (slot.count - 1) / 2) * PARALLEL_GAP;
}

/**
 * a と b を結ぶ線を、垂直方向に offset だけずらす。
 * ずらす向きは「ID の小さいデバイス → 大きいデバイス」を基準にするので、
 * A→B と B→A のリンクが混ざっていても重ならない。
 */
export function offsetLine(
  a: Point,
  b: Point,
  offset: number,
  reversed: boolean,
): { a: Point; b: Point } {
  const dx = reversed ? a.x - b.x : b.x - a.x;
  const dy = reversed ? a.y - b.y : b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0 || offset === 0) return { a, b };
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  return { a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } };
}

export function estimateLabelSize(text: string): { width: number; height: number } {
  return { width: text.length * CHAR_WIDTH + LABEL_PADDING_X, height: LABEL_HEIGHT };
}

/** 中心から向き (ux, uy) に進んだとき、AVOID の範囲を抜けるまでの距離 */
function exitDistance(ux: number, uy: number): number {
  const tx = ux > 0 ? AVOID.right / ux : ux < 0 ? AVOID.left / -ux : Infinity;
  const ty = uy > 0 ? AVOID.bottom / uy : uy < 0 ? AVOID.top / -uy : Infinity;
  return Math.min(tx, ty);
}

/**
 * 両端の IF 名ラベルの中心。線の上の、アイコン(とデバイス名)のすぐ外側に置く(Q1)。
 * 並行リンクでラベルが隣の線のラベルと横に重なる向き(縦や斜めの線)なら、
 * 何本目かに応じて線に沿って段違いにずらす。
 * 機器同士が近くてラベルがぶつかるときは、線の長さに合わせて内側に寄せる。
 */
export function endLabelPositions(
  a: Point,
  b: Point,
  aText: string,
  bText: string,
  slot: Slot = { index: 0, count: 1 },
): { a: Point; b: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { a, b };
  const ux = dx / len;
  const uy = dy / len;
  const sizeA = estimateLabelSize(aText);
  const sizeB = estimateLabelSize(bText);
  // 線の向き(along)と、線に垂直な向き(across)のラベルの半分の長さ
  const along = ({ width, height }: { width: number; height: number }) =>
    (Math.abs(ux) * width) / 2 + (Math.abs(uy) * height) / 2;
  const across = ({ width, height }: { width: number; height: number }) =>
    (Math.abs(uy) * width) / 2 + (Math.abs(ux) * height) / 2;
  const halfA = along(sizeA);
  const halfB = along(sizeB);
  const overlaps = slot.count > 1 && Math.max(across(sizeA), across(sizeB)) * 2 > PARALLEL_GAP;
  const stagger = overlaps ? slot.index : 0;
  let da = exitDistance(ux, uy) + LABEL_GAP + halfA + stagger * (2 * halfA + LABEL_GAP);
  let db = exitDistance(-ux, -uy) + LABEL_GAP + halfB + stagger * (2 * halfB + LABEL_GAP);
  // 2 つのラベルが重なる(または線より長い)なら、比率を保って内側に寄せる。
  // 重ならない条件: (da + halfA) + (db + halfB) <= len
  const room = len - 2 * (halfA + halfB);
  if (da - halfA + (db - halfB) > room) {
    const scale = Math.max(room, 0) / (da - halfA + (db - halfB));
    da = halfA + (da - halfA) * scale;
    db = halfB + (db - halfB) * scale;
  }
  return {
    a: { x: a.x + ux * da, y: a.y + uy * da },
    b: { x: b.x - ux * db, y: b.y - uy * db },
  };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * 自分自身へのリンクの輪(Q5)。アイコンの右側に描き、2 本目以降は少しずつ大きくする。
 * 上流の機器を上に置くレイアウト(SPEC 9章)では上下からのリンクが多いので、横に出す。
 * labelA / labelB は輪の上側と下側、label は輪の右端の外側(label 文字列の幅だけ右へ)。
 */
export function selfLoop(
  c: Point,
  index: number,
  labelText = "",
): { path: string; labelA: Point; labelB: Point; label: Point } {
  const right = c.x + 26;
  // 外側の輪ほど縦に広げ、上下のラベルが内側の輪のラベルとラベルの高さ以上ずれるようにする
  const spread = 12 + index * 18;
  const width = 46 + index * 22;
  const bulge = 18 + index * 14;
  const p0 = { x: right, y: c.y - spread };
  const p1 = { x: right + width, y: c.y - spread - bulge };
  const p2 = { x: right + width, y: c.y + spread + bulge };
  const p3 = { x: right, y: c.y + spread };
  const path = `M ${p0.x},${p0.y} C ${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`;
  const at = (t: number) => cubic(p0, p1, p2, p3, t);
  const labelGap = LABEL_HEIGHT / 2 + 3;
  const upper = at(0.25);
  const lower = at(0.75);
  const tip = at(0.5);
  return {
    path,
    labelA: { x: upper.x, y: upper.y - labelGap },
    labelB: { x: lower.x, y: lower.y + labelGap },
    label: { x: tip.x + LABEL_GAP + estimateLabelSize(labelText).width / 2, y: tip.y },
  };
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}
