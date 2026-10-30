// トポロジの編集操作(SPEC 7章)。
// 引数のトポロジを直接書き換える。ストアでは Immer の produce の中で呼ぶ。

import { bridgeKey, parseBridgeKey, resolveBridgeKey } from "./bridges";
import { resolveGuest } from "./hosts";
import { ifNameKey } from "./ifname";
import { canonicalIfName } from "./ports";
import { createLinkId, createUid, DEVICE_ID_PATTERN, findModel, resolveRole } from "./topology";
import type {
  Device,
  Endpoint,
  Extra,
  GuestKind,
  InterfaceInfo,
  Link,
  Meta,
  ModelCatalog,
  Position,
  Role,
  Topology,
} from "./types";

/** デバイスIDの自動採番に使う role ごとのプレフィックス(SPEC 7.1) */
export const ROLE_ID_PREFIX: Record<Role, string> = {
  router: "rt",
  l2switch: "sw",
  l3switch: "l3sw",
  firewall: "fw",
  server: "srv",
  hypervisor: "hv",
  pc: "pc",
  ap: "ap",
  cloud: "cloud",
  generic: "dev",
};

/** ゲストの ID のプレフィックス。ゲストは role ではなく種類で採番する(SPEC 7.1) */
export const GUEST_ID_PREFIX: Record<GuestKind, string> = { vm: "vm", container: "ct" };

/** プレフィックス + 今ある最大の番号 + 1(削除した ID を使い回さない)。ゲストなら guest を渡す */
export function nextDeviceId(t: Topology, role: Role, guest?: GuestKind): string {
  const prefix = guest === undefined ? ROLE_ID_PREFIX[role] : GUEST_ID_PREFIX[guest];
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
  /** ゲストにするとき、動いているホストのデバイスID */
  host?: string;
  position: Position;
}

/** デバイスを追加し、採番した ID を返す */
export function addDevice(t: Topology, spec: NewDevice, catalog: ModelCatalog): string {
  const device: Device = { id: "", uid: createUid(), interfaces: new Map(), extra: {} };
  if (spec.model !== undefined) device.model = spec.model;
  const modelRole = findModel(device, catalog)?.role;
  if (spec.role !== undefined && spec.role !== modelRole) device.role = spec.role;
  if (spec.host !== undefined) device.host = spec.host;
  device.id = nextDeviceId(t, spec.role ?? modelRole ?? "generic", resolveGuest(device, catalog));
  t.devices.set(device.id, device);
  t.layout.set(device.id, roundPosition(spec.position));
  return device.id;
}

/** デバイスとブリッジ(箱の ID で渡す)の座標を更新する(ドラッグを終えたときに 1 回呼ぶ) */
export function moveDevices(t: Topology, positions: Iterable<[string, Position]>): void {
  for (const [id, pos] of positions) {
    const key = t.devices.has(id) ? id : resolveBridgeKey(t, id);
    if (key !== undefined) t.layout.set(key, roundPosition(pos));
  }
}

/**
 * デバイスを削除する。接続していたリンク、layout(ブリッジの位置を含む)、グループのメンバーからも取り除く。
 * ホストを削除しても、ゲストは残して host を外す(フェーズ4-1 Q3)
 */
export function removeDevices(t: Topology, ids: Iterable<string>): void {
  const removed = new Set(ids);
  if (removed.size === 0) return;
  for (const id of removed) {
    t.devices.delete(id);
    t.layout.delete(id);
  }
  for (const key of t.layout.keys()) {
    const bridge = parseBridgeKey(key);
    if (bridge && removed.has(bridge.host)) t.layout.delete(key);
  }
  t.links = t.links.filter(
    (l) => !(l.a && removed.has(l.a.device)) && !(l.b && removed.has(l.b.device)),
  );
  for (const group of t.groups) {
    if (group.members.some((m) => removed.has(m))) {
      group.members = group.members.filter((m) => !removed.has(m));
    }
  }
  for (const device of t.devices.values()) {
    if (device.host !== undefined && removed.has(device.host)) delete device.host;
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

// ---------------------------------------------------------------------------
// インスペクタからの編集(SPEC 7.1)
// ---------------------------------------------------------------------------

/** デバイスID として使えるか。使えなければ理由を返す(currentId は今の自分の ID) */
export function checkDeviceId(t: Topology, id: string, currentId?: string): string | undefined {
  if (id === "") return "ID を入力してください";
  if (!DEVICE_ID_PATTERN.test(id)) return "英数字で始まり、英数字と . _ - だけを使えます";
  if (id !== currentId && t.devices.has(id)) return `「${id}」は既に使われています`;
  return undefined;
}

/**
 * デバイスID を変える。リンク・layout(ブリッジの位置のキーを含む)・グループ・ゲストの host の参照も
 * すべて書き換える
 */
export function renameDevice(t: Topology, oldId: string, newId: string): void {
  if (oldId === newId) return;
  const device = t.devices.get(oldId);
  if (!device) throw new Error(`デバイス「${oldId}」がありません`);
  const error = checkDeviceId(t, newId, oldId);
  if (error) throw new Error(error);

  device.id = newId;
  t.devices = renameKey(t.devices, oldId, newId);
  t.layout = new Map(
    [...t.layout].map(([key, pos]) => {
      if (key === oldId) return [newId, pos];
      const bridge = parseBridgeKey(key);
      return [bridge?.host === oldId ? bridgeKey(newId, bridge.bridge) : key, pos];
    }),
  );
  for (const link of t.links) {
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (ep?.device === oldId) link[end] = { device: newId, iface: ep.iface };
    }
  }
  for (const group of t.groups) {
    if (group.members.includes(oldId)) {
      group.members = group.members.map((m) => (m === oldId ? newId : m));
    }
  }
  for (const other of t.devices.values()) {
    if (other.host === oldId) other.host = newId;
  }
}

/** Map のキーを、順序を保ったまま付け替える */
function renameKey<V>(map: Map<string, V>, oldKey: string, newKey: string): Map<string, V> {
  return new Map([...map].map(([key, value]) => [key === oldKey ? newKey : key, value]));
}

/** ラベルを設定する。undefined か空文字なら消す(表示は ID になる) */
export function setDeviceLabel(t: Topology, id: string, label: string | undefined): void {
  const device = t.devices.get(id);
  if (device) applyChanges(device, { label });
}

/** role を設定する。undefined、またはモデルと同じ role なら消す(モデルに合わせる) */
export function setDeviceRole(
  t: Topology,
  id: string,
  role: Role | undefined,
  catalog: ModelCatalog,
): void {
  const device = t.devices.get(id);
  if (!device) return;
  const modelRole = findModel(device, catalog)?.role;
  applyChanges(device, { role: role === modelRole ? undefined : role });
}

/** ホストを設定する(SPEC 4.6)。undefined か空文字なら外す */
export function setDeviceHost(t: Topology, id: string, host: string | undefined): void {
  const device = t.devices.get(id);
  if (device) applyChanges(device, { host });
}

/** ゲストの種類を設定する。undefined、またはモデルと同じ種類なら消す(モデルに合わせる) */
export function setDeviceGuest(
  t: Topology,
  id: string,
  guest: GuestKind | undefined,
  catalog: ModelCatalog,
): void {
  const device = t.devices.get(id);
  if (!device) return;
  const modelGuest = findModel(device, catalog)?.guest;
  applyChanges(device, { guest: guest === modelGuest ? undefined : guest });
}

/** VMID を設定する。undefined なら消す */
export function setDeviceVmid(t: Topology, id: string, vmid: number | undefined): void {
  const device = t.devices.get(id);
  if (device) applyChanges(device, { vmid });
}

/** モデルを変えたときに使えなくなるもの */
export interface ModelChangeImpact {
  /** 新しいモデルに無いポートを使うリンク */
  links: Link[];
  /** 新しいモデルに無い IF の設定(interfaces のキー) */
  interfaces: string[];
}

/**
 * モデルを変えると使えなくなるリンクと IF 設定。
 * 新しいモデルがフレキシブル、モデルなし、カタログに無いモデルなら何も無くならない。
 */
export function modelChangeImpact(
  t: Topology,
  id: string,
  modelId: string | undefined,
  catalog: ModelCatalog,
): ModelChangeImpact {
  const device = t.devices.get(id);
  const model = modelId === undefined ? undefined : catalog.get(modelId);
  if (!device || !model || model.flexible) return { links: [], interfaces: [] };
  const ports = new Set(model.ports.map((p) => ifNameKey(p.name)));
  const lost = (ep: Endpoint | undefined) => ep?.device === id && !ports.has(ifNameKey(ep.iface));
  return {
    links: t.links.filter((l) => lost(l.a) || lost(l.b)),
    interfaces: [...device.interfaces.keys()].filter((name) => !ports.has(ifNameKey(name))),
  };
}

/**
 * モデルを変える(undefined ならモデルなし = フレキシブル)。
 * - role はモデルに合わせる。モデルなしにするときは、今の role を引き継いでアイコンを変えない
 * - removeLostPorts なら、新しいモデルに無いポートのリンクと IF 設定を削除する
 * - 残った IF 名は新しいモデルの表記にそろえる
 */
export function changeModel(
  t: Topology,
  id: string,
  modelId: string | undefined,
  catalog: ModelCatalog,
  { removeLostPorts }: { removeLostPorts: boolean },
): void {
  const device = t.devices.get(id);
  if (!device) return;
  const impact = removeLostPorts ? modelChangeImpact(t, id, modelId, catalog) : undefined;
  const roleBefore = resolveRole(device, catalog);
  applyChanges(device, { model: modelId, role: modelId === undefined ? roleBefore : undefined });

  if (impact) {
    removeLinks(
      t,
      impact.links.map((l) => l.id),
    );
    for (const name of impact.interfaces) device.interfaces.delete(name);
  }

  const canonical = (name: string) => canonicalIfName(t, id, name, catalog);
  for (const link of t.links) {
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (ep?.device === id && canonical(ep.iface) !== ep.iface) {
        link[end] = { device: id, iface: canonical(ep.iface) };
      }
    }
  }
  if ([...device.interfaces.keys()].some((name) => canonical(name) !== name)) {
    device.interfaces = new Map(
      [...device.interfaces].map(([name, info]) => [canonical(name), info]),
    );
  }
}

export type InterfaceChanges = Partial<Omit<InterfaceInfo, "extra">>;

/**
 * IF の詳細を変える。設定が無ければ作り、すべて空になったら消す。
 * IF 名はモデルや既存の IF の表記にそろえる。
 */
export function updateInterface(
  t: Topology,
  deviceId: string,
  iface: string,
  changes: InterfaceChanges,
  catalog: ModelCatalog,
): void {
  const device = t.devices.get(deviceId);
  if (!device) return;
  const key = ifNameKey(iface);
  const existing = [...device.interfaces.keys()].find((name) => ifNameKey(name) === key);
  const name = existing ?? canonicalIfName(t, deviceId, iface, catalog);
  const info: InterfaceInfo = (existing && device.interfaces.get(existing)) || { extra: {} };
  applyChanges(info, changes);
  const empty =
    Object.keys(info).every((k) => k === "extra") && Object.keys(info.extra).length === 0;
  if (empty) device.interfaces.delete(name);
  else if (!existing) device.interfaces.set(name, info);
}

export type LinkChanges = Partial<Pick<Link, "media" | "label">>;

export function updateLink(t: Topology, linkId: string, changes: LinkChanges): void {
  const link = t.links.find((l) => l.id === linkId);
  if (link) applyChanges(link, changes);
}

export type MetaChanges = Partial<Pick<Meta, "title" | "description">>;

export function updateMeta(t: Topology, changes: MetaChanges): void {
  applyChanges(t.meta, changes);
}

/**
 * 項目をまとめて書き換える。undefined・空文字・空の配列は「消す」。
 * GUI で設定した項目は、YAML で解釈できなかった値(extra)より優先して extra から外す。
 */
function applyChanges<T extends { extra: Extra }>(target: T, changes: Partial<Omit<T, "extra">>) {
  for (const [key, value] of Object.entries(changes)) {
    Reflect.deleteProperty(target.extra, key);
    const empty =
      value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) Reflect.deleteProperty(target, key);
    else Reflect.set(target, key, value);
  }
}
