// 直角の線(SPEC 4.3 の layout._routing・7.3)。全部の線の道筋をまとめて決める(キャンバスと SVG の書き出しで共有)。
// 上下に離れた 2 台は縦 → 横 → 縦、横に並んだ 2 台は横 → 縦 → 横で結ぶ(縦にすき間があれば縦を優先)。
// 同じ機器の同じ辺から出る線は、行き先の向きの順に出る位置をずらし、中ほどの線(縦 → 横 → 縦なら横の線)が
// ほかの線と重なるときは、交わりが少なくなる順に段をずらす。中ほどの線は、IF 名ラベルの多い端から離す。
// 機器は避けない。

import { BRIDGE_BOX } from "./bridges";
import {
  NAME_BOTTOM,
  NAME_DETAIL_LINE,
  type NameDetails,
  PARALLEL_GAP,
  type Point,
  type Slot,
} from "./linkGeometry";

/** 道筋を決めるときのノード(デバイスかブリッジの箱) */
export interface RouteNode {
  /** アイコン(ブリッジなら箱)の中心 */
  center: Point;
  /** アイコン(ブリッジなら箱)の半分の幅と高さ。線はこの中から出す */
  half: { x: number; y: number };
  /** 中ほどの線を通さない範囲(アイコンと名前など)。中心から上・下・左・右への長さ */
  extent: { top: number; bottom: number; left: number; right: number };
}

/** 道筋を決める線。a・b は両端のノードの ID */
export interface RouteLine {
  id: string;
  a: string;
  b: string;
  /**
   * その端に IF 名ラベルが付くか(省けば両端とも付く)。ブリッジの箱の側には付かない。
   * 中ほどの線を、ラベルの多い端から離して、そちらの端の区間を長くするため
   */
  labeled?: { a: boolean; b: boolean };
}

export interface OrthogonalRoute {
  /** 線の点(端 a から端 b の順)。端は、アイコンの中の、辺から出る位置 */
  points: Point[];
  /** 両端が、その辺から出る線のうち何本目か(gap は出る位置をずらす幅。IF 名ラベルを段違いにするため) */
  ends: { a: Slot; b: Slot };
}

/** デバイスのアイコン(52px 角)の半分 */
const DEVICE_HALF = 26;
/** アイコンとデバイス名の外側(linkGeometry の、ラベルが避ける範囲と同じ) */
const ICON_REACH = 30;
/** 箱の外側に空ける幅 */
const BOX_MARGIN = 4;
/** 辺の角(丸めてある)から、出る位置を離す幅 */
const CORNER = 6;
/** 縦(横)から出すのに要る、2 台のすき間 */
const MIN_GAP = 24;
/** 中ほどの線の段の間隔(いちばん狭いとき) */
const MIN_TRACK_GAP = 4;
/** 同じ段の候補とみなす、中ほどの線の位置の差 */
const TRACK_NEAR = 2 * PARALLEL_GAP;
/** 中ほどの線を、すき間のどこまで片方へ寄せるか(IF 名ラベルの多い端の、ラベルの場所を空ける) */
const TRACK_BIAS = 1 / 3;
const EPS = 1e-6;

/** デバイスのノード。details はデバイス名の下の行(ホストの IP など。表示しているときだけ) */
export function deviceRouteNode(center: Point, details?: NameDetails): RouteNode {
  return {
    center,
    half: { x: DEVICE_HALF, y: DEVICE_HALF },
    extent: {
      top: ICON_REACH,
      bottom: NAME_BOTTOM + (details?.lines ?? 0) * NAME_DETAIL_LINE,
      left: ICON_REACH,
      right: ICON_REACH,
    },
  };
}

/** ブリッジの箱のノード。lines は箱の下に出す行(IP・VNet の tag)の数 */
export function bridgeRouteNode(center: Point, lines = 0): RouteNode {
  const half = { x: BRIDGE_BOX.width / 2, y: BRIDGE_BOX.height / 2 };
  return {
    center,
    half,
    extent: {
      top: half.y + BOX_MARGIN,
      bottom: half.y + BOX_MARGIN + lines * NAME_DETAIL_LINE,
      left: half.x + BOX_MARGIN,
      right: half.x + BOX_MARGIN,
    },
  };
}

type Side = "top" | "bottom" | "left" | "right";

/** 辺から外へ向かう向き */
const OUTWARD: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * 出る位置をずらす向き(外へ向かう向き (x, y) に対して (-y, x)。linkGeometry の endLabelPositions と同じ)。
 * 1 本の線の両端の辺は向かい合うので、この向きは逆になる
 */
const across = (side: Side): Point => ({ x: -OUTWARD[side].y, y: OUTWARD[side].x });

/** 道筋を決める線(折れ方が決まったもの) */
interface Planned {
  line: RouteLine;
  index: number;
  na: RouteNode;
  nb: RouteNode;
  /** 縦 → 横 → 縦なら true、横 → 縦 → 横なら false。どちらのすき間も無ければ undefined(まっすぐ) */
  vertical?: boolean;
  slotA: Slot;
  slotB: Slot;
  portA: Point;
  portB: Point;
  /** 両端の辺から出る線のうち、その辺の側に IF 名ラベルが付くものの数 */
  labelsA: number;
  labelsB: number;
}

/** 辺から出る線の端 */
interface PortEnd {
  planned: Planned;
  end: "a" | "b";
  node: string;
  other: string;
  self: RouteNode;
  toward: RouteNode;
  side: Side;
}

/** 中ほどの線。lo・hi は線の範囲、level は線の位置(縦 → 横 → 縦なら y) */
interface Track {
  planned: Planned;
  lo: number;
  hi: number;
  level: number;
  /** level を置いてよい範囲(2 台のすき間) */
  min: number;
  max: number;
  /** level の小さい側(上か左)の機器から来る線と、大きい側へ出る線の位置 */
  enter: number;
  leave: number;
}

/**
 * 直角の線の道筋(キー = 線の ID)。ノードの無い線と、自分自身へのリンクは入れない。
 * 同じ入力なら同じ結果になる(同じ向きの線の順は lines の順で決める)
 */
export function orthogonalRoutes(
  lines: readonly RouteLine[],
  nodes: ReadonlyMap<string, RouteNode>,
): Map<string, OrthogonalRoute> {
  const planned: Planned[] = [];
  lines.forEach((line, index) => {
    const na = nodes.get(line.a);
    const nb = nodes.get(line.b);
    if (!na || !nb || line.a === line.b) return;
    const single = { index: 0, count: 1 };
    planned.push({
      line,
      index,
      na,
      nb,
      vertical: orientation(na, nb),
      slotA: single,
      slotB: single,
      portA: na.center,
      portB: nb.center,
      labelsA: 0,
      labelsB: 0,
    });
  });

  assignPorts(planned);

  const vertical: Track[] = [];
  const horizontal: Track[] = [];
  for (const p of planned) {
    const track = trackOf(p);
    if (track) (p.vertical ? vertical : horizontal).push(track);
  }
  const levels = new Map<Planned, number>();
  for (const tracks of [vertical, horizontal]) {
    for (const [track, level] of assignLevels(tracks)) levels.set(track.planned, level);
  }

  const routes = new Map<string, OrthogonalRoute>();
  for (const p of planned) {
    const level = levels.get(p);
    const { portA: a, portB: b } = p;
    let points: Point[];
    if (level === undefined) points = [a, b];
    else if (p.vertical) {
      points = [a, { x: a.x, y: level }, { x: b.x, y: level }, b];
    } else {
      points = [a, { x: level, y: a.y }, { x: level, y: b.y }, b];
    }
    routes.set(p.line.id, { points, ends: { a: p.slotA, b: p.slotB } });
  }
  return routes;
}

/** 縦 → 横 → 縦にするか。縦のすき間を優先し、どちらのすき間も足りなければ undefined */
function orientation(na: RouteNode, nb: RouteNode): boolean | undefined {
  const [upper, lower] = na.center.y <= nb.center.y ? [na, nb] : [nb, na];
  const gapY = lower.center.y - lower.extent.top - (upper.center.y + upper.extent.bottom);
  if (gapY >= MIN_GAP) return true;
  const [left, right] = na.center.x <= nb.center.x ? [na, nb] : [nb, na];
  const gapX = right.center.x - right.extent.left - (left.center.x + left.extent.right);
  if (gapX >= MIN_GAP) return false;
  return undefined;
}

/**
 * 同じノードの同じ辺から出る線の、出る位置を決める。行き先がずらす向きのどちら寄りかの順に並べ、
 * 辺の中に収まるように間隔を詰める。同じ 2 台の間の線は、両端で同じ並びになるよう、
 * ID の小さいノードの側では lines の順、大きいノードの側では逆の順にする
 */
function assignPorts(planned: Planned[]): void {
  const groups = new Map<string, PortEnd[]>();
  for (const p of planned) {
    if (p.vertical === undefined) continue;
    const { na, nb } = p;
    const sideA: Side = p.vertical
      ? nb.center.y > na.center.y
        ? "bottom"
        : "top"
      : nb.center.x > na.center.x
        ? "right"
        : "left";
    const sideB = OPPOSITE[sideA];
    const ends: PortEnd[] = [
      { planned: p, end: "a", node: p.line.a, other: p.line.b, self: na, toward: nb, side: sideA },
      { planned: p, end: "b", node: p.line.b, other: p.line.a, self: nb, toward: na, side: sideB },
    ];
    for (const end of ends) {
      const key = `${end.node}\u0000${end.side}`;
      const group = groups.get(key);
      if (group) group.push(end);
      else groups.set(key, [end]);
    }
  }
  for (const group of groups.values()) {
    const { side, self } = group[0];
    const n = across(side);
    const along = (end: PortEnd) =>
      (end.toward.center.x - self.center.x) * n.x + (end.toward.center.y - self.center.y) * n.y;
    group.sort((p, q) => {
      const d = along(p) - along(q);
      if (Math.abs(d) > EPS) return d;
      if (p.other !== q.other) return p.other < q.other ? -1 : 1;
      const order = p.planned.index - q.planned.index;
      return p.node < p.other ? order : -order;
    });
    const count = group.length;
    const labels = group.filter((end) => end.planned.line.labeled?.[end.end] ?? true).length;
    const spread = (side === "top" || side === "bottom" ? self.half.x : self.half.y) - CORNER;
    const gap = count > 1 ? Math.min(PARALLEL_GAP, (2 * Math.max(spread, 0)) / (count - 1)) : 0;
    group.forEach((end, index) => {
      const slot: Slot = { index, count, gap };
      const offset = (index - (count - 1) / 2) * gap;
      const port = { x: self.center.x + n.x * offset, y: self.center.y + n.y * offset };
      if (end.end === "a") {
        end.planned.slotA = slot;
        end.planned.portA = port;
        end.planned.labelsA = labels;
      } else {
        end.planned.slotB = slot;
        end.planned.portB = port;
        end.planned.labelsB = labels;
      }
    });
  }
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** 中ほどの線。出る位置がそろっていて(まっすぐ結べる)、中ほどの線が要らなければ undefined */
function trackOf(p: Planned): Track | undefined {
  if (p.vertical === undefined) return undefined;
  const { na, nb, portA, portB } = p;
  // 縦 → 横 → 縦なら、x が線の範囲、y が段の位置(横 → 縦 → 横なら逆)
  const cross = (q: Point) => (p.vertical ? q.x : q.y);
  const main = (q: Point) => (p.vertical ? q.y : q.x);
  if (Math.abs(cross(portA) - cross(portB)) < 0.5) return undefined;
  const aFirst = main(na.center) <= main(nb.center);
  const [first, second] = aFirst ? [na, nb] : [nb, na];
  const [enter, leave] = aFirst ? [portA, portB] : [portB, portA];
  const min = main(first.center) + (p.vertical ? first.extent.bottom : first.extent.right);
  const max = main(second.center) - (p.vertical ? second.extent.top : second.extent.left);
  // IF 名ラベルの付く線の多い端から離して、そちらの端の区間(ラベルを置く)を長くする
  const [near, far] = aFirst ? [p.labelsA, p.labelsB] : [p.labelsB, p.labelsA];
  const share =
    near + far === 0 ? 0.5 : Math.min(Math.max(near / (near + far), TRACK_BIAS), 1 - TRACK_BIAS);
  return {
    planned: p,
    lo: Math.min(cross(portA), cross(portB)),
    hi: Math.max(cross(portA), cross(portB)),
    level: min + (max - min) * share,
    min,
    max,
    enter: cross(enter),
    leave: cross(leave),
  };
}

/**
 * 中ほどの線の位置を決める。位置が近く、範囲が重なる線どうしは、別々の段にする。
 * 段の順は、ほかの線の範囲の中を通る、出入りの線と交わらない順(交わりが避けられないときは少なくなる順)
 */
function assignLevels(tracks: readonly Track[]): Map<Track, number> {
  const overlaps = (s: Track, t: Track) => Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > -1;
  const near = (s: Track, t: Track) => Math.abs(s.level - t.level) < TRACK_NEAR;
  // 重なる線のまとまり(どれかと重なっていれば同じまとまり)
  const parent = tracks.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      if (overlaps(tracks[i], tracks[j]) && near(tracks[i], tracks[j])) {
        parent[root(i)] = root(j);
      }
    }
  }
  const clusters = new Map<number, Track[]>();
  tracks.forEach((track, i) => {
    const cluster = clusters.get(root(i));
    if (cluster) cluster.push(track);
    else clusters.set(root(i), [track]);
  });

  const levels = new Map<Track, number>();
  for (const cluster of clusters.values()) {
    if (cluster.length === 1) {
      levels.set(cluster[0], cluster[0].level);
      continue;
    }
    const order = trackOrder(cluster);
    // 先に並べた線と重なれば、その段より後ろの段にする
    const rank = new Map<Track, number>();
    order.forEach((track, i) => {
      let r = 0;
      for (const before of order.slice(0, i)) {
        if (overlaps(track, before)) r = Math.max(r, (rank.get(before) ?? 0) + 1);
      }
      rank.set(track, r);
    });
    const count = Math.max(...rank.values()) + 1;
    const center = cluster.reduce((sum, t) => sum + t.level, 0) / cluster.length;
    const min = Math.max(...cluster.map((t) => t.min));
    const max = Math.min(...cluster.map((t) => t.max));
    const room = max - min;
    const step = Math.max(MIN_TRACK_GAP, Math.min(PARALLEL_GAP, room / count));
    let first = center - ((count - 1) / 2) * step;
    // すき間に収まるなら、はみ出さないよう寄せる
    if ((count - 1) * step <= room) {
      first = Math.min(Math.max(first, min + step / 2), max - step / 2 - (count - 1) * step);
    }
    for (const [track, r] of rank) levels.set(track, first + r * step);
  }
  return levels;
}

/**
 * まとまりの中の線を、段の小さい順(上か左から)に並べる。
 * t の範囲の中を s の入る線が通るなら s が先(t より手前で曲がる)、s の範囲の中を t の出る線が通るなら s が先。
 * 順が決まらない(輪になる)ときは、先に来るべき線の残りが少ないものから並べる
 */
function trackOrder(cluster: readonly Track[]): Track[] {
  const inside = (t: Track, at: number) => at > t.lo + EPS && at < t.hi - EPS;
  const before = new Map<Track, Set<Track>>(cluster.map((t) => [t, new Set<Track>()]));
  for (const s of cluster) {
    for (const t of cluster) {
      if (s !== t && (inside(t, s.enter) || inside(s, t.leave))) before.get(t)?.add(s);
    }
  }
  const tie = (s: Track, t: Track) => s.level - t.level || s.planned.index - t.planned.index;
  const rest = new Set(cluster);
  const order: Track[] = [];
  while (rest.size > 0) {
    let next: Track | undefined;
    let fewest = Infinity;
    for (const t of rest) {
      let waiting = 0;
      for (const s of before.get(t) ?? []) if (rest.has(s)) waiting++;
      if (waiting < fewest || (waiting === fewest && next && tie(t, next) < 0)) {
        next = t;
        fewest = waiting;
      }
    }
    if (!next) break;
    order.push(next);
    rest.delete(next);
  }
  return order;
}

/**
 * 直角の線の図で、手で曲げた線(SPEC 7.3)の端を、最初の点がアイコン(箱)の幅の中にあれば
 * アイコンからまっすぐ出す(縦か横)。points は端 a から端 b の順で、a・b はその端のノード
 */
export function attachEnds(points: readonly Point[], a: RouteNode, b: RouteNode): Point[] {
  const result = [...points];
  if (points.length < 3) return result;
  const last = points.length - 1;
  result[0] = attach(points[0], points[1], a);
  result[last] = attach(points[last], points[last - 1], b);
  return result;
}

function attach(end: Point, next: Point, node: RouteNode): Point {
  const dx = Math.abs(next.x - node.center.x);
  const dy = Math.abs(next.y - node.center.y);
  if (dx <= node.half.x && dy > node.half.y) return { x: next.x, y: end.y };
  if (dy <= node.half.y && dx > node.half.x) return { x: end.x, y: next.y };
  return end;
}
