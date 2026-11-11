// 曲げた線の点(SPEC 4.3 の layout._bends・7.3)。キーと点の並びの扱いは bendKeys.ts。
// 同じ 2 台の間の線(LAG など)は、まとめて同じ点を通る。

import { bendKey, parseBendKey } from "./bendKeys";
import { endpointNodeId, parseBridgeKey } from "./bridges";
import { ifNameKey } from "./ifname";
import type { Link, Position, Topology } from "./types";

/** キーを比べるための形(ノードの順と、ブリッジの IF 名の書き方の違いをならす) */
export function bendKeyNorm(key: string): string {
  const nodes = parseBendKey(key);
  if (!nodes) return key;
  const norm = nodes.map((node) => {
    const bridge = parseBridgeKey(node);
    return bridge ? `${bridge.host}:${ifNameKey(bridge.bridge)}` : node;
  });
  return norm.sort().join("\u0000");
}

/** リンクの曲げる点のキー。端が不正なリンクと、自分自身へのリンクは undefined */
export function linkBendKey(t: Topology, link: Link): string | undefined {
  if (!link.a || !link.b) return undefined;
  return bendKey(endpointNodeId(t, link.a), endpointNodeId(t, link.b));
}

/** 曲げられる線のキー(描けるリンクのうち、自分自身へのリンクでないものの両端) */
export function movableBendKeys(t: Topology): Set<string> {
  const keys = new Set<string>();
  for (const link of t.links) {
    if (!link.a || !link.b || !t.devices.has(link.a.device) || !t.devices.has(link.b.device)) {
      continue;
    }
    const key = linkBendKey(t, link);
    if (key !== undefined) keys.add(key);
  }
  return keys;
}

const round = ({ x, y }: Position): Position => ({ x: Math.round(x), y: Math.round(y) });

/** 曲げる点を書く(整数に丸める)。点が無ければ消す(まっすぐに戻す) */
export function setBends(t: Topology, key: string, points: readonly Position[]): void {
  if (points.length === 0) t.bends.delete(key);
  else t.bends.set(key, points.map(round));
}

/** 線をまっすぐに戻す(keys を省けばすべて) */
export function resetBends(t: Topology, keys?: Iterable<string>): void {
  if (keys === undefined) {
    if (t.bends.size > 0) t.bends.clear();
    return;
  }
  for (const key of keys) t.bends.delete(key);
}

/**
 * 編集で線が無くなった 2 台の点を消す。before は編集の前の movableBendKeys。
 * 前から対応する線の無かったキーは残す(YAML で書いたものかもしれないので、検証で知らせる)
 */
export function dropRemovedBends(t: Topology, before: ReadonlySet<string>): void {
  if (t.bends.size === 0) return;
  const now = movableBendKeys(t);
  for (const key of [...t.bends.keys()]) {
    if (before.has(key) && !now.has(key)) t.bends.delete(key);
  }
}

/** 消したデバイス(と、そのブリッジ)に付く線の点を消す */
export function removeBendsOf(t: Topology, devices: ReadonlySet<string>): void {
  for (const key of [...t.bends.keys()]) {
    const nodes = parseBendKey(key);
    if (nodes?.some((node) => devices.has(parseBridgeKey(node)?.host ?? node))) {
      t.bends.delete(key);
    }
  }
}

/** 両端がそろって(同じだけ)動いていれば、その量。片方だけ・そろっていない・動いていなければ undefined */
export function commonMove(a: Position | undefined, b: Position | undefined): Position | undefined {
  if (!a || !b || Math.abs(a.x - b.x) >= 0.5 || Math.abs(a.y - b.y) >= 0.5) return undefined;
  return a.x === 0 && a.y === 0 ? undefined : a;
}

/** 点を delta だけ動かす */
export function moveBends(points: readonly Position[], delta: Position): Position[] {
  return points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
}

/**
 * ノードを動かしたとき、両端のノードがそろって動いた線の点も同じだけ動かす(SPEC 7.3)。
 * moved はノード(デバイスID・ブリッジのキー)ごとの動いた量
 */
export function shiftBends(t: Topology, moved: ReadonlyMap<string, Position>): void {
  for (const [key, points] of t.bends) {
    const nodes = parseBendKey(key);
    const delta = nodes && commonMove(moved.get(nodes[0]), moved.get(nodes[1]));
    if (delta) t.bends.set(key, moveBends(points, delta).map(round));
  }
}

/**
 * ドラッグ中の点を、隣の点と水平・垂直にそろえる(SPEC 7.3)。
 * 横・縦それぞれ、threshold より近い隣の点のうち、いちばん近いものに合わせる
 */
export function snapBend(p: Position, neighbors: readonly Position[], threshold: number): Position {
  const snap = (axis: "x" | "y") => {
    let best = p[axis];
    let distance = threshold;
    for (const n of neighbors) {
      const d = Math.abs(n[axis] - p[axis]);
      if (d < distance) {
        best = n[axis];
        distance = d;
      }
    }
    return best;
  };
  return { x: snap("x"), y: snap("y") };
}
