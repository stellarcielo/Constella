// 曲げた線の点(SPEC 4.3 の layout._bends)のキーと、点の並び。
// キーは線の両端のノード(デバイスID。ブリッジなら「ホスト:ブリッジ名」)を名前の順に並べて空白でつないだもの、
// 点はキーの 1 つ目のノードの側から順に並べる。ほかのモジュールに頼らないので、ブリッジの名前の変更
// (bridges.ts)からも使える。

import type { Position, Topology } from "./types";

/** 2 つのノードを結ぶ線の、曲げる点のキー。同じノード(自分自身へのリンク)なら undefined */
export function bendKey(a: string, b: string): string | undefined {
  if (a === b) return undefined;
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

/** キーの 2 つのノード(書いた順)。空白で 2 つに分けられなければ undefined */
export function parseBendKey(key: string): [string, string] | undefined {
  const parts = key.split(" ");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== ""
    ? [parts[0], parts[1]]
    : undefined;
}

/**
 * 点の並びを、from のノードから to のノードへの順にする(キーの順の点を、線の向きに合わせる)。
 * from から to の順の点を渡せば、キーの順(名前の小さいノードから)に戻る
 */
export function orientBends(points: readonly Position[], from: string, to: string): Position[] {
  return from < to ? [...points] : [...points].reverse();
}

/**
 * ノードの ID の付け替え(デバイスID・ブリッジの名前の変更)に合わせて、キーを書き換える。
 * 名前の順が変われば、点もキーの順に並べ直す
 */
export function renameBendNodes(t: Topology, rename: (node: string) => string): void {
  if (t.bends.size === 0) return;
  const next = new Map<string, Position[]>();
  for (const [key, points] of t.bends) {
    const nodes = parseBendKey(key);
    const [a, b] = nodes ? [rename(nodes[0]), rename(nodes[1])] : [];
    const renamed = a !== undefined && b !== undefined ? bendKey(a, b) : undefined;
    if (a === undefined || b === undefined || renamed === undefined) next.set(key, points);
    else next.set(renamed, orientBends(points, a, b));
  }
  t.bends = next;
}
