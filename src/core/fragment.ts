// コピー&ペースト用の断片(SPEC 7.4)。断片は小さなトポロジで、クリップボードには YAML の文字列で入れる。
// 外で書いた(AI に書かせた)YAML の断片も貼り付けられる。

import { bendKey, orientBends, parseBendKey } from "./bendKeys";
import { bendKeyNorm, linkBendKey, movableBendKeys, moveBends, setBends } from "./bends";
import { bridgeKey, parseBridgeKey } from "./bridges";
import { nextDeviceId, roundPosition } from "./edit";
import { copiedGroupId } from "./groups";
import { resolveGuest } from "./hosts";
import { labelKey, labelKeyNorm, movableLabelKeys } from "./labelLayout";
import { parseTopology } from "./parse";
import { serializeTopology } from "./serialize";
import {
  createEmptyTopology,
  createLinkId,
  createUid,
  parseEndpoint,
  resolveRole,
} from "./topology";
import type { ModelCatalog, Position, Topology } from "./types";

/**
 * 選んだデバイスと、その間で完結するリンク(両端とも選んだデバイスにある)と座標を取り出す。
 * ホストのブリッジの位置、そのリンクの曲げた点と手で動かしたラベルの位置も一緒に取り出す。
 * 選んだデバイスの入っているグループは、図にあるメンバーをすべて書いて取り出す
 * (貼り付けるとき、メンバーを全部複製したかどうかで扱いを変えるため。SPEC 7.4)
 */
export function extractFragment(t: Topology, deviceIds: Iterable<string>): Topology {
  const ids = new Set(deviceIds);
  const fragment = createEmptyTopology();
  for (const [id, device] of t.devices) {
    if (ids.has(id)) fragment.devices.set(id, structuredClone(device));
  }
  fragment.links = t.links
    .filter(
      (l) => l.a && l.b && fragment.devices.has(l.a.device) && fragment.devices.has(l.b.device),
    )
    .map((l) => structuredClone(l));
  for (const [id, pos] of t.layout) {
    const owner = parseBridgeKey(id)?.host ?? id;
    if (fragment.devices.has(owner)) fragment.layout.set(id, { ...pos });
  }
  const bends = new Set(
    fragment.links.flatMap((l) => {
      const key = linkBendKey(fragment, l);
      return key === undefined ? [] : [bendKeyNorm(key)];
    }),
  );
  for (const [key, points] of t.bends) {
    if (bends.has(bendKeyNorm(key))) fragment.bends.set(key, structuredClone(points));
  }
  const labels = new Set([...movableLabelKeys(fragment)].map(labelKeyNorm));
  for (const [key, offset] of t.labelLayout) {
    if (labels.has(labelKeyNorm(key))) fragment.labelLayout.set(key, { ...offset });
  }
  for (const group of t.groups) {
    if (!group.members.some((m) => fragment.devices.has(m))) continue;
    fragment.groups.push({
      ...structuredClone(group),
      members: group.members.filter((m) => t.devices.has(m)),
    });
  }
  return fragment;
}

/** 断片をクリップボードに入れる YAML の文字列にする */
export function fragmentToText(fragment: Topology): string {
  return serializeTopology(fragment).text;
}

/**
 * クリップボードの文字列を断片として読む。デバイスが 1 台も無い、または読めなければ undefined。
 * 外で書いた断片のために、`constella: 1` の行が無くても受け付ける。
 */
export function parseFragment(text: string, catalog: ModelCatalog): Topology | undefined {
  let result = parseTopology(text, { catalog });
  if (!result.ok && result.issues.every((i) => i.code === "missing-version")) {
    result = parseTopology(`constella: 1\n${text}`, { catalog });
  }
  return result.ok && result.topology.devices.size > 0 ? result.topology : undefined;
}

/**
 * 断片を貼り付ける。デバイスID は role ごとに振り直し(パレットから置いたときと同じ規則)、
 * 断片の中で両端がそろうリンクだけを追加する。座標は offset だけずらす(座標の無いデバイスはそのまま)。
 * ゲストの host は、ホストも一緒に貼り付けたならその新しい ID にし、図に無いホストなら外す。
 * 曲げた点(offset だけずらす)とラベルの位置は、新しい ID に付け替える。
 * グループは、メンバーの一部なら同じ ID のグループに入れ(無ければ作る)、全部なら新しいグループとして複製する。
 * 貼り付けたデバイスとリンクの ID を返す。
 */
export function pasteFragment(
  t: Topology,
  fragment: Topology,
  catalog: ModelCatalog,
  offset: Position,
): { devices: string[]; links: string[] } {
  const ids = new Map<string, string>();
  const existing = new Set(t.devices.keys());
  for (const device of fragment.devices.values()) {
    const id = nextDeviceId(t, resolveRole(device, catalog), resolveGuest(device, catalog));
    ids.set(device.id, id);
    t.devices.set(id, { ...structuredClone(device), id, uid: createUid() });
    const shift = (pos: Position) => roundPosition({ x: pos.x + offset.x, y: pos.y + offset.y });
    const pos = fragment.layout.get(device.id);
    if (pos) t.layout.set(id, shift(pos));
    // ブリッジの位置は、新しいホストの ID で置き直す
    for (const [key, at] of fragment.layout) {
      const bridge = parseBridgeKey(key);
      if (bridge?.host === device.id) t.layout.set(bridgeKey(id, bridge.bridge), shift(at));
    }
  }
  for (const id of ids.values()) {
    const device = t.devices.get(id);
    if (device?.host === undefined) continue;
    const host = ids.get(device.host);
    if (host !== undefined) device.host = host;
    else if (!existing.has(device.host)) delete device.host;
  }
  const links: string[] = [];
  for (const link of fragment.links) {
    const a = link.a && ids.get(link.a.device);
    const b = link.b && ids.get(link.b.device);
    if (!link.a || !link.b || !a || !b) continue;
    const id = createLinkId();
    t.links.push({
      ...structuredClone(link),
      id,
      a: { device: a, iface: link.a.iface },
      b: { device: b, iface: link.b.iface },
    });
    links.push(id);
  }

  /** 断片のノード(デバイスID・ブリッジのキー)の、貼り付けたあとの ID */
  const node = (id: string): string | undefined => {
    const bridge = parseBridgeKey(id);
    const host = ids.get(bridge?.host ?? id);
    return host === undefined || !bridge ? host : bridgeKey(host, bridge.bridge);
  };
  // 貼り付けたリンクの線とラベルの分だけ付け替える(外で書いた断片の、対応する線の無い点などは捨てる)
  const bends = new Set([...movableBendKeys(t)].map(bendKeyNorm));
  for (const [key, points] of fragment.bends) {
    const nodes = parseBendKey(key);
    const a = nodes && node(nodes[0]);
    const b = nodes && node(nodes[1]);
    const next = a !== undefined && b !== undefined ? bendKey(a, b) : undefined;
    // 点はキーの 1 つ目のノードの側から並ぶので、新しい ID で名前の順が変われば逆にする
    if (a !== undefined && b !== undefined && next !== undefined && bends.has(bendKeyNorm(next))) {
      setBends(t, next, orientBends(moveBends(points, offset), a, b));
    }
  }
  const labels = new Set([...movableLabelKeys(t)].map(labelKeyNorm));
  for (const [key, at] of fragment.labelLayout) {
    const ep = parseEndpoint(key);
    const device = ep && ids.get(ep.device);
    const next = ep && device !== undefined ? labelKey(device, ep.iface) : undefined;
    if (next !== undefined && labels.has(labelKeyNorm(next))) t.labelLayout.set(next, { ...at });
  }

  for (const group of fragment.groups) {
    const members = [...new Set(group.members.flatMap((m) => ids.get(m) ?? []))];
    if (members.length === 0) continue;
    const whole = group.members.every((m) => ids.has(m));
    const same = whole ? undefined : t.groups.find((g) => g.id === group.id);
    if (same) {
      for (const id of members) if (!same.members.includes(id)) same.members.push(id);
    } else {
      t.groups.push({
        ...structuredClone(group),
        id: copiedGroupId(t, group.id),
        uid: createUid(),
        members,
      });
    }
  }
  return { devices: [...ids.values()], links };
}
