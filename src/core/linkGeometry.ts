// リンクの線とラベルの位置の計算(SPEC 7.3)。キャンバスと SVG の書き出しで共有する。
// 座標はフロー座標で、点はデバイスのアイコンの中心。

import type { LabelOffset } from "./types";

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

interface Size {
  width: number;
  height: number;
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

/** デバイス名の下に出す行(ホストの IP など。Canvas.css の .device-node-ip と合わせる)の 1 行の高さ */
export const NAME_DETAIL_LINE = 14;

/** デバイス名の下に出す行の大きさ(SPEC 7.3・フェーズ4-3 Q1) */
export interface NameDetails {
  width: number;
  lines: number;
}

/** 行の大きさの見積もり(IF 名ラベルと同じ字の大きさ) */
export function nameDetails(lines: readonly string[]): NameDetails | undefined {
  return lines.length === 0
    ? undefined
    : { width: estimateLabelSize(lines).width, lines: lines.length };
}

/** アイコンと、その下のデバイス名(と、その下の行)の範囲 */
function avoidBoxes(nameWidth = DEFAULT_NAME_WIDTH, details?: NameDetails): Box[] {
  const half = Math.max(nameWidth, DEFAULT_NAME_WIDTH) / 2;
  const boxes = [ICON_BOX, { left: -half, top: NAME_TOP, right: half, bottom: NAME_BOTTOM }];
  if (details) {
    const w = details.width / 2;
    boxes.push({
      left: -w,
      top: NAME_BOTTOM,
      right: w,
      bottom: NAME_BOTTOM + details.lines * NAME_DETAIL_LINE,
    });
  }
  return boxes;
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

/**
 * リンクの線の点(端 a から端 b の順。SPEC 7.3)。via は曲げる点(a から b の順。ずらす前)。
 * 同じ 2 台の間の線は offset だけ平行にずらす。ずらす向きは offsetLine と同じく、
 * ID の小さいデバイス → 大きいデバイスを基準にする(reversed は a の ID のほうが大きいとき)
 */
export function linkPoints(
  a: Point,
  b: Point,
  via: readonly Point[],
  offset: number,
  reversed: boolean,
): Point[] {
  const forward = [a, ...via, b];
  if (offset === 0) return forward;
  const shifted = offsetPolyline(reversed ? forward.reverse() : forward, offset);
  return reversed ? shifted.reverse() : shifted;
}

/**
 * 折れ線を、区間ごとに offsetLine と同じ向き(進む向き (dx, dy) に対して (-dy, dx) の向き)へ offset だけずらす。
 * 角は、ずらした 2 つの区間が交わる点にする(鋭い角で伸びすぎないよう、角からの距離は |offset| の 4 倍まで)
 */
function offsetPolyline(points: readonly Point[], offset: number): Point[] {
  const normals: (Point | undefined)[] = points.slice(1).map((q, i) => {
    const p = points[i];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    return len === 0 ? undefined : { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
  });
  // 長さ 0 の区間は、前(無ければ後ろ)の区間の向きを使う
  for (let i = 1; i < normals.length; i++) normals[i] ??= normals[i - 1];
  for (let i = normals.length - 2; i >= 0; i--) normals[i] ??= normals[i + 1];
  return points.map((p, i) => {
    const before = normals[i - 1] ?? normals[i];
    const after = normals[i] ?? normals[i - 1];
    if (!before || !after) return p;
    const mx = before.x + after.x;
    const my = before.y + after.y;
    const m = Math.hypot(mx, my);
    // 折り返す角は、手前の区間の向きでずらす
    if (m < 1e-9) return { x: p.x + before.x * offset, y: p.y + before.y * offset };
    // 角の半分の cos で割ると、ずらした 2 つの区間が交わる点になる
    const scale = offset / Math.max((mx * before.x + my * before.y) / m, 0.25);
    return { x: p.x + (mx / m) * scale, y: p.y + (my / m) * scale };
  });
}

/** 折れ線の、長さの真ん中の点(リンク中央のラベルの位置) */
export function polylineMidpoint(points: readonly Point[]): Point {
  const lengths = points.slice(1).map((q, i) => Math.hypot(q.x - points[i].x, q.y - points[i].y));
  let rest = lengths.reduce((sum, len) => sum + len, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0 && rest <= lengths[i]) {
      const t = rest / lengths[i];
      const p = points[i];
      const q = points[i + 1];
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    rest -= lengths[i];
  }
  return points[0];
}

/** 折れ線の SVG の path(d 属性)。format で数を書く形を変えられる */
export function polylinePath(
  points: readonly Point[],
  format: (value: number) => string | number = (value) => value,
): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${format(p.x)},${format(p.y)}`).join(" ");
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
 * origin(アイコンの中心から見た位置)から向き (ux, uy) に進んだとき、大きさ size のラベル(中心がその点)が、
 * アイコンとデバイス名のどちらとも LABEL_GAP 以上離れる最短の距離。
 * ラベルの中心が入ってはいけない範囲は、各範囲をラベルの半分の大きさと隙間の分だけ広げたもの
 */
function clearDistance(origin: Point, ux: number, uy: number, size: Size, boxes: Box[]): number {
  const grown = boxes.map((b) => ({
    left: b.left - size.width / 2 - LABEL_GAP,
    top: b.top - size.height / 2 - LABEL_GAP,
    right: b.right + size.width / 2 + LABEL_GAP,
    bottom: b.bottom + size.height / 2 + LABEL_GAP,
  }));
  const EPS = 1e-6;
  let d = 0;
  // 範囲の中にいれば、その範囲を抜けるところまで進む
  // (ひとつの範囲で進むのは 1 回までなので、範囲の数 + 1 回で止まる)
  for (let pass = 0; pass <= grown.length; pass++) {
    let moved = false;
    for (const g of grown) {
      const x = origin.x + ux * d;
      const y = origin.y + uy * d;
      if (x > g.left + EPS && x < g.right - EPS && y > g.top + EPS && y < g.bottom - EPS) {
        const tx =
          ux > 0 ? (g.right - origin.x) / ux : ux < 0 ? (g.left - origin.x) / ux : Infinity;
        const ty =
          uy > 0 ? (g.bottom - origin.y) / uy : uy < 0 ? (g.top - origin.y) / uy : Infinity;
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
 * デバイス名の下の行(details。ホストの IP など)を渡すと、その行にも重ならないようにする。
 * 並行リンクでラベルが隣の線のラベルと横に重なる向き(縦や斜めの線)なら、
 * 何本目かに応じて線に沿って段違いにずらす。線が短くて段違いでは収まらないときは、
 * ずらした向きに合わせて線の両側(横向きの線なら上下)に分けて置く。そのときも、同じ側に並ぶラベルと
 * 真ん中の線(本数が奇数のとき)のラベルは段違いにする。
 * a・b は offsetLine でずらした線の端。reversed は offsetLine に渡したものと同じにする。
 * 機器同士が近くてラベルがぶつかるときは、線の長さに合わせて内側に寄せる。
 */
export function endLabelPositions(
  a: Point,
  b: Point,
  aText: string | readonly string[],
  bText: string | readonly string[],
  slot: Slot = { index: 0, count: 1 },
  nameWidths: { a?: number; b?: number } = {},
  details: { a?: NameDetails; b?: NameDetails } = {},
  reversed = false,
): { a: Point; b: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { a, b };
  const ux = dx / len;
  const uy = dy / len;
  // ずらした向き(offsetLine と同じく、ID の小さいデバイス → 大きいデバイスを基準にする)
  const nx = reversed ? uy : -uy;
  const ny = reversed ? -ux : ux;
  const sizeA = estimateLabelSize(aText);
  const sizeB = estimateLabelSize(bText);
  // 線の向き(along)と、線に垂直な向き(across)のラベルの半分の長さ
  const along = ({ width, height }: Size) =>
    (Math.abs(ux) * width) / 2 + (Math.abs(uy) * height) / 2;
  const across = ({ width, height }: Size) =>
    (Math.abs(uy) * width) / 2 + (Math.abs(ux) * height) / 2;
  const halfA = along(sizeA);
  const halfB = along(sizeB);
  const stepA = 2 * halfA + LABEL_GAP;
  const stepB = 2 * halfB + LABEL_GAP;
  const boxesA = avoidBoxes(nameWidths.a, details.a);
  const boxesB = avoidBoxes(nameWidths.b, details.b);
  // 真ん中の線から横に lateral 離れたところから、線に沿ってアイコンと名前を避ける距離
  const clearA = (lateral: number) =>
    clearDistance({ x: nx * lateral, y: ny * lateral }, ux, uy, sizeA, boxesA);
  const clearB = (lateral: number) =>
    clearDistance({ x: nx * lateral, y: ny * lateral }, -ux, -uy, sizeB, boxesB);
  const nearA = clearA(0);
  const nearB = clearB(0);
  const overlaps = slot.count > 1 && Math.max(across(sizeA), across(sizeB)) * 2 > PARALLEL_GAP;
  // 段違いで収まらないなら、線の両側に分ける(いちばん外まで段違いにするリンクで確かめる)
  const last = slot.count - 1;
  const split = overlaps && nearA + last * stepA + halfA + nearB + last * stepB + halfB > len;
  // 真ん中の線から何本目か(ずらした向きが正。2 本なら ±0.5、3 本なら -1, 0, 1)
  const order = (index: number) => index - (slot.count - 1) / 2;
  const own = order(slot.index);
  const onLine = own * PARALLEL_GAP;

  /** 線の両側に分けたときの、アイコンの中心から線に沿った距離と、真ん中の線からの横の位置 */
  const column = (clear: (lateral: number) => number, size: Size, step: number) => {
    // 隣の線のラベルと隙間があくところまで外へ出す(自分の線より内側にはしない)
    const lateralOf = (q: number) =>
      Math.sign(q) * Math.max(Math.abs(q) * PARALLEL_GAP, LABEL_GAP / 2 + across(size));
    const orders = Array.from({ length: slot.count }, (_, i) => order(i));
    // 同じ側のラベルは、いちばん遠くまで避けるものにそろえてから段違いにする
    const base = (side: number) =>
      Math.max(0, ...orders.filter((q) => Math.sign(q) === side).map((q) => clear(lateralOf(q))));
    if (own === 0) {
      // 真ん中の線のラベルは、両側のラベルより線の中ほどに置く
      return {
        distance: Math.max(clear(0), base(1), base(-1)) + Math.floor(slot.count / 2) * step,
        lateral: 0,
      };
    }
    return {
      distance: base(Math.sign(own)) + (Math.ceil(Math.abs(own)) - 1) * step,
      lateral: lateralOf(own),
    };
  };

  const stagger = overlaps ? slot.index : 0;
  const endA = split
    ? column(clearA, sizeA, stepA)
    : { distance: nearA + stagger * stepA, lateral: onLine };
  const endB = split
    ? column(clearB, sizeB, stepB)
    : { distance: nearB + stagger * stepB, lateral: onLine };
  let da = endA.distance;
  let db = endB.distance;
  // 2 つのラベルが重なる(または線より長い)なら、比率を保って内側に寄せる。
  // 重ならない条件: (da + halfA) + (db + halfB) <= len
  const room = len - 2 * (halfA + halfB);
  if (da - halfA + (db - halfB) > room) {
    const scale = Math.max(room, 0) / (da - halfA + (db - halfB));
    da = halfA + (da - halfA) * scale;
    db = halfB + (db - halfB) * scale;
  }
  // a・b は真ん中の線から onLine ずれているので、その分を引いて横に動かす
  const shiftA = endA.lateral - onLine;
  const shiftB = endB.lateral - onLine;
  return {
    a: { x: a.x + ux * da + nx * shiftA, y: a.y + uy * da + ny * shiftA },
    b: { x: b.x - ux * db + nx * shiftB, y: b.y - uy * db + ny * shiftB },
  };
}

/** placeEndLabels に渡す、線の片方の端 */
export interface LabelEnd {
  /** つながるノード(デバイスかブリッジの箱)の ID。同じノードに付くラベルどうしを重ならないようにする */
  node: string;
  /** アイコン(ブリッジなら箱)の中心 */
  center: Point;
  /** ラベルの行。空ならラベルを置かない */
  text: string | readonly string[];
  /** デバイス名の幅と、名前の下の行(endLabelPositions の nameWidths・details) */
  nameWidth?: number;
  details?: NameDetails;
  /** 手で動かした位置(SPEC 7.3)。あればそこに置き、自動ではずらさない(ほかのラベルが避ける) */
  offset?: LabelOffset;
}

/** placeEndLabels に渡す線 */
export interface LabeledLine {
  a: LabelEnd;
  b: LabelEnd;
  /** 同じ 2 台の間のリンクのうち何本目か(offsetLine でずらしてから置く) */
  slot?: Slot;
  /** offsetLine に渡すものと同じ */
  reversed?: boolean;
  /** 曲げる点(a から b の順。ずらす前。SPEC 7.3)。あれば、ラベルは端の区間に沿って置く */
  via?: readonly Point[];
}

/** placeEndLabels で置いたラベル */
interface PlacedLabel {
  end: LabelEnd;
  /** ラベルの中心 */
  at: Point;
  /** 線に沿って、ノードから離れる向き */
  dir: Point;
  size: Size;
  /** 線の向きのラベルの半分の長さ */
  half: number;
  /** 手で動かしたラベル(ずらさない) */
  fixed: boolean;
  /**
   * 外へずらすときの行き止まり。まっすぐな線は反対の端のラベル(ラベルの無い端でも、置くはずの位置を持つ。
   * 両端を作ってから結ぶ)、曲げた線は最初の曲げる点
   */
  other?: PlacedLabel;
}

/** 線の区間(from が機器の側) */
interface Segment {
  from: Point;
  to: Point;
}

/**
 * ラベルを置く、線の両端の区間(機器の中心から、次の点まで。SPEC 7.3)。曲げる点が無ければ線全体。
 * 機器の中心に重なる曲げる点は飛ばす
 */
function endSegments(line: LabeledLine): { a: Segment; b: Segment; bent: boolean } {
  const { slot = { index: 0, count: 1 }, reversed = false, via = [] } = line;
  const points = linkPoints(line.a.center, line.b.center, via, slotOffset(slot), reversed);
  const first = points[0];
  const last = points[points.length - 1];
  const same = (p: Point, q: Point) => p.x === q.x && p.y === q.y;
  const inner = points.slice(1, -1);
  return {
    a: { from: first, to: inner.find((p) => !same(p, first)) ?? last },
    b: { from: last, to: [...inner].reverse().find((p) => !same(p, last)) ?? first },
    bent: inner.length > 0,
  };
}

const segmentLength = ({ from, to }: Segment) => Math.hypot(to.x - from.x, to.y - from.y);

/**
 * 全部の線の両端のラベルの中心(結果は lines と同じ順。SPEC 7.3)。
 * 線ごとに endLabelPositions で置いたあと、同じノードに付くラベル(別々の線のものも)が重なれば、
 * ノードに近いラベルはそのままにし、遠いほうをその線に沿って外へずらす。
 * 反対の端のラベルの手前までしかずらさないので、線が短いと重なりが残ることがある。
 * 曲げた線は、端の区間(機器から最初の曲げる点まで)に沿って置き、最初の曲げる点までしかずらさない。
 * 手で動かしたラベル(offset)は、その位置に置いてずらさず、ほかのラベルがそれを避ける。
 */
export function placeEndLabels(lines: readonly LabeledLine[]): { a: Point; b: Point }[] {
  const pairs = lines.map((line) => {
    const { a, b, slot = { index: 0, count: 1 }, reversed = false } = line;
    const seg = endSegments(line);
    const auto = seg.bent
      ? {
          a: endLabelPositions(
            seg.a.from,
            seg.a.to,
            a.text,
            [],
            slot,
            { a: a.nameWidth },
            { a: a.details },
            reversed,
          ).a,
          b: endLabelPositions(
            seg.b.to,
            seg.b.from,
            [],
            b.text,
            slot,
            { b: b.nameWidth },
            { b: b.details },
            reversed,
          ).b,
        }
      : endLabelPositions(
          seg.a.from,
          seg.b.from,
          a.text,
          b.text,
          slot,
          { a: a.nameWidth, b: b.nameWidth },
          { a: a.details, b: b.details },
          reversed,
        );
    const placed = (end: LabelEnd, { from, to }: Segment, at: Point): PlacedLabel => {
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      const dir =
        len === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
      const size = estimateLabelSize(end.text);
      return {
        end,
        at: end.offset ? offsetPoint(from, dir, end.offset) : at,
        dir,
        size,
        // endLabelPositions の along と同じ
        half: (Math.abs(dir.x) * size.width + Math.abs(dir.y) * size.height) / 2,
        fixed: end.offset !== undefined,
      };
    };
    const pa = placed(a, seg.a, auto.a);
    const pb = placed(b, seg.b, auto.b);
    if (seg.bent) {
      const corner = (label: PlacedLabel, at: Point): PlacedLabel => ({
        ...label,
        at,
        size: { width: 0, height: 0 },
        half: 0,
      });
      pa.other = corner(pa, seg.a.to);
      pb.other = corner(pb, seg.b.to);
    } else {
      pa.other = pb;
      pb.other = pa;
    }
    return { pa, pb, lenA: segmentLength(seg.a), lenB: segmentLength(seg.b) };
  });

  const byNode = new Map<string, PlacedLabel[]>();
  for (const { pa, pb, lenA, lenB } of pairs) {
    for (const [label, len] of [
      [pa, lenA],
      [pb, lenB],
    ] as const) {
      if (len === 0 || !hasText(label.end.text)) continue;
      const list = byNode.get(label.end.node);
      if (list) list.push(label);
      else byNode.set(label.end.node, [label]);
    }
  }
  // ノードごとに、手で動かしたラベル、ノードに近いラベルの順に置き、先に置いたラベルと重なれば外へずらす
  for (const labels of byNode.values()) {
    const distance = ({ at, end }: PlacedLabel) =>
      Math.hypot(at.x - end.center.x, at.y - end.center.y);
    labels.sort((p, q) => Number(q.fixed) - Number(p.fixed) || distance(p) - distance(q));
    const done: PlacedLabel[] = [];
    for (const label of labels) {
      if (!label.fixed && done.some((other) => overlapping(label, other))) moveOut(label, done);
      done.push(label);
    }
  }
  return pairs.map(({ pa, pb }) => ({ a: pa.at, b: pb.at }));
}

/**
 * ラベルを at に置いたときの、手で動かした位置(線の端から線に沿った距離と、横のずれ。整数に丸める)。
 * line は placeEndLabels に渡すものと同じ。曲げた線は、端の区間を基準にする
 */
export function endLabelOffset(line: LabeledLine, end: "a" | "b", at: Point): LabelOffset {
  const { from, to } = endSegments(line)[end];
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return { along: 0, side: 0 };
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  // 横のずれは、線に沿って外を向いたときの右(画面の座標で (-uy, ux) の向き)がプラス
  return { along: Math.round(dx * ux + dy * uy), side: Math.round(dy * ux - dx * uy) };
}

/** 線の端 from から、向き dir に along、その右に side 進んだ点(endLabelOffset の逆) */
function offsetPoint(from: Point, dir: Point, { along, side }: LabelOffset): Point {
  return { x: from.x + dir.x * along - dir.y * side, y: from.y + dir.y * along + dir.x * side };
}

function hasText(text: string | readonly string[]): boolean {
  return typeof text === "string" ? text !== "" : text.length > 0;
}

/** 2 つのラベルが重なるか(接しているだけなら重ならない) */
function overlapping(p: PlacedLabel, q: PlacedLabel): boolean {
  const EPS = 1e-6;
  return (
    Math.abs(p.at.x - q.at.x) < (p.size.width + q.size.width) / 2 - EPS &&
    Math.abs(p.at.y - q.at.y) < (p.size.height + q.size.height) / 2 - EPS
  );
}

/**
 * label を線に沿って外へ、先に置いたラベル(done)とノードのアイコン・名前から LABEL_GAP 以上離れるところまでずらす。
 * ただし反対の端のラベルとは重ならないところまで
 */
function moveOut(label: PlacedLabel, done: PlacedLabel[]): void {
  const { end, dir, other } = label;
  const c = end.center;
  // 範囲はノードの中心から見た座標
  const boxes: Box[] = [
    ...avoidBoxes(end.nameWidth, end.details),
    ...done.map(({ at, size }) => ({
      left: at.x - c.x - size.width / 2,
      top: at.y - c.y - size.height / 2,
      right: at.x - c.x + size.width / 2,
      bottom: at.y - c.y + size.height / 2,
    })),
  ];
  const push = clearDistance(
    { x: label.at.x - c.x, y: label.at.y - c.y },
    dir.x,
    dir.y,
    label.size,
    boxes,
  );
  // 線の向きの位置(ノードの中心から測る)。反対の端のラベルの手前まで
  const along = (p: Point) => (p.x - c.x) * dir.x + (p.y - c.y) * dir.y;
  const room = other
    ? along(other.at) - other.half - (along(label.at) + label.half)
    : Number.POSITIVE_INFINITY;
  const d = Math.max(0, Math.min(push, room));
  label.at = { x: label.at.x + dir.x * d, y: label.at.y + dir.y * d };
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
