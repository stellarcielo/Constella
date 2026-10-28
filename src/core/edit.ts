// トポロジの編集操作(SPEC 7章)。
// 引数のトポロジを直接書き換える。ストアでは Immer の produce の中で呼ぶ。

import { canonicalIfName } from "./ports";
import { createLinkId, findModel } from "./topology";
import type { Device, Endpoint, Link, ModelCatalog, Position, Role, Topology } from "./types";

/** デバイスIDの自動採番に使う role ごとのプレフィックス(SPEC 7.1) */
export const ROLE_ID_PREFIX: Record<Role, string> = {
  router: "rt",
  l2switch: "sw",
  l3switch: "l3sw",
  firewall: "fw",
  server: "srv",
  pc: "pc",
  ap: "ap",
  cloud: "cloud",
  generic: "dev",
};

/** プレフィックス + 今ある最大の番号 + 1(削除した ID を使い回さない) */
export function nextDeviceId(t: Topology, role: Role): string {
  const prefix = ROLE_ID_PREFIX[role];
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of t.devices.keys()) {
    const m = pattern.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

/** 座標は整数に丸めて持つ(YAML に小数が並ばないように) */
export function roundPosition(pos: Position): Position {
  return { x: Math.round(pos.x), y: Math.round(pos.y) };
}

export interface NewDevice {
  model?: string;
  /** model が無いとき、またはモデルの role を上書きするとき */
  role?: Role;
  position: Position;
}

/** デバイスを追加し、採番した ID を返す */
export function addDevice(t: Topology, spec: NewDevice, catalog: ModelCatalog): string {
  const device: Device = { id: "", interfaces: new Map(), extra: {} };
  if (spec.model !== undefined) device.model = spec.model;
  const modelRole = findModel(device, catalog)?.role;
  if (spec.role !== undefined && spec.role !== modelRole) device.role = spec.role;
  device.id = nextDeviceId(t, spec.role ?? modelRole ?? "generic");
  t.devices.set(device.id, device);
  t.layout.set(device.id, roundPosition(spec.position));
  return device.id;
}

/** デバイスの座標を更新する(ドラッグを終えたときに 1 回呼ぶ) */
export function moveDevices(t: Topology, positions: Iterable<[string, Position]>): void {
  for (const [id, pos] of positions) {
    if (t.devices.has(id)) t.layout.set(id, roundPosition(pos));
  }
}

/** デバイスを削除する。接続していたリンク、layout、グループのメンバーからも取り除く */
export function removeDevices(t: Topology, ids: Iterable<string>): void {
  const removed = new Set(ids);
  if (removed.size === 0) return;
  for (const id of removed) {
    t.devices.delete(id);
    t.layout.delete(id);
  }
  t.links = t.links.filter(
    (l) => !(l.a && removed.has(l.a.device)) && !(l.b && removed.has(l.b.device)),
  );
  for (const group of t.groups) {
    if (group.members.some((m) => removed.has(m))) {
      group.members = group.members.filter((m) => !removed.has(m));
    }
  }
}

/**
 * リンクを追加し、その ID を返す。IF 名はモデルや既存の IF の表記にそろえる。
 * 使用中のポートかどうかはここでは確かめない(ポート選択画面で選べなくしている。YAML で書かれた場合は検証でエラーになる)。
 */
export function addLink(t: Topology, a: Endpoint, b: Endpoint, catalog: ModelCatalog): string {
  const link: Link = {
    id: createLinkId(),
    a: { device: a.device, iface: canonicalIfName(t, a.device, a.iface, catalog) },
    b: { device: b.device, iface: canonicalIfName(t, b.device, b.iface, catalog) },
    extra: {},
  };
  t.links.push(link);
  return link.id;
}

export function removeLinks(t: Topology, ids: Iterable<string>): void {
  const removed = new Set(ids);
  if (removed.size === 0) return;
  t.links = t.links.filter((l) => !removed.has(l.id));
}
