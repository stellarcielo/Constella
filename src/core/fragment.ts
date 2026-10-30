// コピー&ペースト用の断片(SPEC 7.4)。断片は小さなトポロジで、クリップボードには YAML の文字列で入れる。
// 外で書いた(AI に書かせた)YAML の断片も貼り付けられる。

import { bridgeKey, parseBridgeKey } from "./bridges";
import { nextDeviceId, roundPosition } from "./edit";
import { resolveGuest } from "./hosts";
import { parseTopology } from "./parse";
import { serializeTopology } from "./serialize";
import { createEmptyTopology, createLinkId, createUid, resolveRole } from "./topology";
import type { ModelCatalog, Position, Topology } from "./types";

/**
 * 選んだデバイスと、その間で完結するリンク(両端とも選んだデバイスにある)と座標を取り出す。
 * ホストのブリッジの位置も一緒に取り出す
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
  return { devices: [...ids.values()], links };
}
