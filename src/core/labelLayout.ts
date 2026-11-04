// 手で動かした IF 名ラベルの位置(SPEC 4.3 の layout._labels・7.3)。
// キーはラベルの付く端(デバイスID:IF名。ブリッジとホストの間の線のホスト側のラベルは「ホスト:ブリッジ名」)。
// 位置は線の端から、線に沿った距離と横のずれで覚える(機器を動かしても、ラベルは線に付いていく)。

import { allBridges, endpointNodeId } from "./bridges";
import { ifNameKey, normalizeIfName } from "./ifname";
import { endpointToString, parseEndpoint } from "./topology";
import type { LabelOffset, Topology } from "./types";

/** ラベルの位置のキー。IF 名は短い形にそろえる */
export function labelKey(device: string, iface: string): string {
  return endpointToString({ device, iface: normalizeIfName(iface) });
}

/** キーを比べるための形(IF 名の書き方と大文字小文字の違いをならす) */
export function labelKeyNorm(key: string): string {
  const ep = parseEndpoint(key);
  return ep ? `${ep.device}\u0000${ifNameKey(ep.iface)}` : key;
}

/**
 * 手で動かせるラベルのキー。リンクの、ブリッジでない端と、members のあるブリッジのホスト側。
 * 自分自身へのリンク(輪)のラベルは動かせない
 */
export function movableLabelKeys(t: Topology): Set<string> {
  const keys = new Set<string>();
  for (const { a, b } of t.links) {
    if (!a || !b || !t.devices.has(a.device) || !t.devices.has(b.device)) continue;
    if (endpointNodeId(t, a) === endpointNodeId(t, b)) continue;
    for (const ep of [a, b]) {
      if (endpointNodeId(t, ep) === ep.device) keys.add(labelKey(ep.device, ep.iface));
    }
  }
  for (const { host, bridge, vnet } of allBridges(t)) {
    const members = vnet ? [] : (t.devices.get(host)?.interfaces.get(bridge)?.members ?? []);
    if (members.length > 0) keys.add(labelKey(host, bridge));
  }
  return keys;
}

/** ラベルの位置を書く(整数に丸める) */
export function setLabelOffset(t: Topology, key: string, offset: LabelOffset): void {
  t.labelLayout.set(key, { along: Math.round(offset.along), side: Math.round(offset.side) });
}

/** ラベルを自動の位置に戻す(keys を省けばすべて) */
export function resetLabels(t: Topology, keys?: Iterable<string>): void {
  if (keys === undefined) {
    if (t.labelLayout.size > 0) t.labelLayout.clear();
    return;
  }
  for (const key of keys) t.labelLayout.delete(key);
}

/**
 * 編集でラベルが無くなった端(消したリンクやデバイスなど)の位置を消す。before は編集の前の movableLabelKeys。
 * 前から対応するラベルの無かったキーは残す(YAML で書いたものかもしれないので、検証で知らせる)
 */
export function dropRemovedLabels(t: Topology, before: ReadonlySet<string>): void {
  if (t.labelLayout.size === 0) return;
  const now = movableLabelKeys(t);
  for (const key of [...t.labelLayout.keys()]) {
    if (before.has(key) && !now.has(key)) t.labelLayout.delete(key);
  }
}
