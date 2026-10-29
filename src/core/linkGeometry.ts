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
/** 1 行の高さと、上下の枠線の分 */
const LINE_HEIGHT = 13;
const LABEL_BORDER = 2;

/** ラベルを置いてはいけない範囲(アイコンの中心から見た座標) */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** アイコン(52px 角)の箱 */
const ICON_BOX: Box = { left: -30, top: -30, right: 30, bottom: 30 };
/** アイコンの下のデバイス名の上端と下端。左右は名前の幅で決まる */
const NAME_TOP = 26;
const NAME_BOTTOM = 50;
/** デバイス名の幅が分からないときは、アイコンと同じ幅とみなす */
const DEFAULT_NAME_WIDTH = 60;
const LABEL_GAP = 4;

/** デバイス名(12px)の幅の見積もり。全角は 12px、半角は 7px、左右の余白が 12px */
export function estimateNameWidth(text: string): number {
  let width = 12;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 12 : 7;
  return width;
}

/** アイコンと、その下のデバイス名の範囲 */
function avoidBoxes(nameWidth = DEFAULT_NAME_WIDTH): Box[] {
  const half = Math.max(nameWidth, DEFAULT_NAME_WIDTH) / 2;
  return [ICON_BOX, { left: -half, top: NAME_TOP, right: half, bottom: NAME_BOTTOM }];
}

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

/** ラベルの大きさ。複数行(IF 名の下の IP・VLAN など)は行の配列で渡す */
export function estimateLabelSize(text: string | readonly string[]): {
  width: number;
  height: number;
} {
  const lines = typeof text === "string" ? [text] : text;
  const longest = Math.max(0, ...lines.map((line) => line.length));
  return {
    width: longest * CHAR_WIDTH + LABEL_PADDING_X,
    height: lines.length * LINE_HEIGHT + LABEL_BORDER,
  };
}

/**
 * 中心から向き (ux, uy) に進んだとき、大きさ size のラベル(中心がその点)が、
 * アイコンとデバイス名のどちらとも LABEL_GAP 以上離れる最短の距離。
 * ラベルの中心が入ってはいけない範囲は、各範囲をラベルの半分の大きさと隙間の分だけ広げたもの
 */
function clearDistance(
  ux: number,
  uy: number,
  size: { width: number; height: number },
  boxes: Box[],
): number {
  const grown = boxes.map((b) => ({
    left: b.left - size.width / 2 - LABEL_GAP,
    top: b.top - size.height / 2 - LABEL_GAP,
    right: b.right + size.width / 2 + LABEL_GAP,
    bottom: b.bottom + size.height / 2 + LABEL_GAP,
  }));
  const EPS = 1e-6;
  let d = 0;
  // 範囲の中にいれば、その範囲を抜けるところまで進む(範囲は 2 つなので数回で止まる)
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const g of grown) {
      const x = ux * d;
      const y = uy * d;
      if (x > g.left + EPS && x < g.right - EPS && y > g.top + EPS && y < g.bottom - EPS) {
        const tx = ux > 0 ? g.right / ux : ux < 0 ? g.left / ux : Infinity;
        const ty = uy > 0 ? g.bottom / uy : uy < 0 ? g.top / uy : Infinity;
        d = Math.min(tx, ty);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return d;
}

/**
 * 両端の IF 名ラベルの中心。線の上の、アイコンとデバイス名のすぐ外側に置く(Q1)。
 * デバイス名の幅(nameWidths)を渡すと、アイコンより幅の広い名前にも重ならないようにする。
 * 並行リンクでラベルが隣の線のラベルと横に重なる向き(縦や斜めの線)なら、
 * 何本目かに応じて線に沿って段違いにずらす。
 * 機器同士が近くてラベルがぶつかるときは、線の長さに合わせて内側に寄せる。
 */
export function endLabelPositions(
  a: Point,
  b: Point,
  aText: string | readonly string[],
  bText: string | readonly string[],
  slot: Slot = { index: 0, count: 1 },
  nameWidths: { a?: number; b?: number } = {},
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
  let da =
    clearDistance(ux, uy, sizeA, avoidBoxes(nameWidths.a)) + stagger * (2 * halfA + LABEL_GAP);
  let db =
    clearDistance(-ux, -uy, sizeB, avoidBoxes(nameWidths.b)) + stagger * (2 * halfB + LABEL_GAP);
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
 * labelA / labelB は輪の上側と下側(ends のラベルの高さだけ離す)、
 * label は輪の右端の外側(label 文字列の幅だけ右へ)。
 */
export function selfLoop(
  c: Point,
  index: number,
  labelText = "",
  ends: { a?: string | readonly string[]; b?: string | readonly string[] } = {},
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
  const gap = (text: string | readonly string[] = "") => estimateLabelSize(text).height / 2 + 3;
  const upper = at(0.25);
  const lower = at(0.75);
  const tip = at(0.5);
  return {
    path,
    labelA: { x: upper.x, y: upper.y - gap(ends.a) },
    labelB: { x: lower.x, y: lower.y + gap(ends.b) },
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
