// ポートの使用状況と、ポート選択に出す一覧(SPEC 7.2)。

import { ifNameKey, normalizeIfName } from "./ifname";
import { findModel } from "./topology";
import type { Device, Endpoint, ModelCatalog, PortType, Topology } from "./types";

/** 物理的に挿せる組み合わせを同じグループにする(SFP+ ポートに SFP を挿す等は不一致にしない) */
const PORT_FAMILY: Record<PortType, string> = {
  rj45: "rj45",
  sfp: "sfp",
  "sfp+": "sfp",
  sfp28: "sfp",
  "qsfp+": "qsfp",
  qsfp28: "qsfp",
  console: "console",
  serial: "serial",
  wireless: "wireless",
  virtual: "virtual",
};

export function portTypesCompatible(a: PortType, b: PortType): boolean {
  return PORT_FAMILY[a] === PORT_FAMILY[b];
}

export interface PortUse {
  /** 使っているリンク。undefined なら作りかけの接続で押さえているポート */
  linkId?: string;
  /** 接続先 */
  peer?: Endpoint;
}

/** デバイスID → (ifNameKey → 使用状況)。同じポートを複数のリンクが使っていたら最初のもの */
export type PortUsage = Map<string, Map<string, PortUse>>;

export function buildPortUsage(t: Topology): PortUsage {
  const usage: PortUsage = new Map();
  for (const link of t.links) {
    for (const [ep, peer] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      if (!ep) continue;
      let ports = usage.get(ep.device);
      if (!ports) {
        ports = new Map();
        usage.set(ep.device, ports);
      }
      const key = ifNameKey(ep.iface);
      if (!ports.has(key)) ports.set(key, peer ? { linkId: link.id, peer } : { linkId: link.id });
    }
  }
  return usage;
}

export interface PortEntry {
  name: string;
  type?: PortType;
  speed?: string;
  /** モデルに定義されたポートか(フレキシブルデバイスで使われているだけの IF は false) */
  defined: boolean;
  /** 使用中なら使用状況 */
  use?: PortUse;
}

/**
 * デバイスのポート一覧。モデルのポートを定義順に並べ、
 * その後ろにモデルに無いが使われている IF(interfaces とリンクに書かれたもの)を出てきた順に並べる。
 * reserved は作りかけの接続で押さえているポート(自分自身へつなぐとき用)。
 */
export function listDevicePorts(
  device: Device,
  t: Topology,
  catalog: ModelCatalog,
  usage: PortUsage = buildPortUsage(t),
  reserved?: Endpoint,
): PortEntry[] {
  const used = usage.get(device.id);
  const reservedKey = reserved?.device === device.id ? ifNameKey(reserved.iface) : undefined;
  const usageOf = (key: string): PortUse | undefined =>
    used?.get(key) ?? (key === reservedKey ? {} : undefined);

  const entries: PortEntry[] = [];
  const seen = new Set<string>();
  for (const port of findModel(device, catalog)?.ports ?? []) {
    const name = normalizeIfName(port.name);
    const key = ifNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const entry: PortEntry = { name, type: port.type, defined: true };
    if (port.speed !== undefined) entry.speed = port.speed;
    const use = usageOf(key);
    if (use) entry.use = use;
    entries.push(entry);
  }

  const extra = [
    ...device.interfaces.keys(),
    ...t.links.flatMap((l) =>
      [l.a, l.b].filter((ep) => ep?.device === device.id).map((ep) => ep?.iface ?? ""),
    ),
  ];
  for (const name of extra) {
    const key = ifNameKey(name);
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    const use = usageOf(key);
    entries.push(use ? { name, defined: false, use } : { name, defined: false });
  }
  return entries;
}

/** 先頭の空いている(モデルに定義された)ポート */
export function firstFreePort(entries: PortEntry[]): PortEntry | undefined {
  return entries.find((e) => e.defined && !e.use);
}

/**
 * IF 名の表記をそろえる。モデルのポートや既に使われている IF と同じなら、その表記に合わせる。
 * どれとも一致しなければ短い形にしたものを返す。
 */
export function canonicalIfName(
  t: Topology,
  deviceId: string,
  name: string,
  catalog: ModelCatalog,
): string {
  const key = ifNameKey(name);
  const device = t.devices.get(deviceId);
  if (device) {
    for (const entry of listDevicePorts(device, t, catalog)) {
      if (ifNameKey(entry.name) === key) return entry.name;
    }
  }
  return normalizeIfName(name);
}
