// ポートの使用状況と、ポート選択に出す一覧(SPEC 7.2)。

import { bridgeLinks, findHostBridge } from "./bridges";
import { findLogicalIf } from "./logicalIfs";
import { ifNameKey, normalizeIfName } from "./ifname";
import { findVnet, hostVnets } from "./sdn";
import { findModel } from "./topology";
import type { Device, Endpoint, ModelCatalog, PortType, Topology } from "./types";

/** ポート種別の表示名(画面と、問題のメッセージで使う) */
export const PORT_TYPE_LABELS: Record<PortType, string> = {
  rj45: "RJ45",
  sfp: "SFP",
  "sfp+": "SFP+",
  sfp28: "SFP28",
  "qsfp+": "QSFP+",
  qsfp28: "QSFP28",
  console: "コンソール",
  serial: "シリアル",
  wireless: "無線",
  virtual: "仮想",
};

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

/** エンドポイントのポート種別。フレキシブルデバイスでモデルに無い IF などは undefined */
export function portTypeOf(t: Topology, ep: Endpoint, catalog: ModelCatalog): PortType | undefined {
  const device = t.devices.get(ep.device);
  if (!device) return undefined;
  const key = ifNameKey(ep.iface);
  return findModel(device, catalog)?.ports.find((p) => ifNameKey(p.name) === key)?.type;
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
  /** 使用中なら使用状況(ブリッジは何本でもつなげるので、使用中にしない) */
  use?: PortUse;
  /** ブリッジ(SPEC 4.6)なら、つながっているリンクの本数。vnet は SDN の VNet か(フェーズ4-6) */
  bridge?: { links: number; vnet?: boolean };
  /** bond・VLAN インターフェース(線をつながないので、ポート選択には出さない) */
  logical?: "bond" | "vlan";
}

/**
 * デバイスのポート一覧。モデルのポートを定義順に並べ、
 * その後ろにモデルに無いが使われている IF(interfaces とリンクに書かれたもの)を出てきた順に並べ、
 * ゾーンのホストなら、使える VNet(SPEC 4.6)を最後に並べる。
 * ブリッジ・VNet は使用中にせず、つながっているリンクの本数を添える。bond・VLAN インターフェースには印を付ける。
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
    ...hostVnets(t, device.id, catalog),
  ];
  for (const name of extra) {
    const key = ifNameKey(name);
    if (name === "" || seen.has(key)) continue;
    seen.add(key);
    const bridge = findHostBridge(t, device.id, name);
    if (bridge !== undefined) {
      const links = bridgeLinks(t, device.id, name).length;
      const vnet = findVnet(t, device, name) !== undefined;
      entries.push({
        name: bridge,
        defined: false,
        bridge: vnet ? { links, vnet } : { links },
      });
      continue;
    }
    const logical = findLogicalIf(device, name)?.info.type;
    if (logical === "bond" || logical === "vlan") {
      entries.push({ name, defined: false, logical });
      continue;
    }
    const use = usageOf(key);
    entries.push(use ? { name, defined: false, use } : { name, defined: false });
  }
  return entries;
}

/**
 * ブリッジの members にできる IF(SPEC 4.6)。物理的な IF(モデルのポートと、使われている IF)と、
 * bond・VLAN インターフェース。ブリッジは除く
 */
export function bridgeMemberCandidates(
  device: Device,
  t: Topology,
  catalog: ModelCatalog,
): string[] {
  return listDevicePorts(device, t, catalog)
    .filter((entry) => !entry.bridge)
    .map((entry) => entry.name);
}

/** bond の members にできる IF(物理的な IF だけ。SPEC 4.6) */
export function bondMemberCandidates(device: Device, t: Topology, catalog: ModelCatalog): string[] {
  return listDevicePorts(device, t, catalog)
    .filter((entry) => !entry.bridge && !entry.logical)
    .map((entry) => entry.name);
}

/** VLAN インターフェースの親にできる IF(物理的な IF・bond・ブリッジ。VLAN インターフェースは除く) */
export function vlanParentCandidates(device: Device, t: Topology, catalog: ModelCatalog): string[] {
  return listDevicePorts(device, t, catalog)
    .filter((entry) => entry.logical !== "vlan")
    .map((entry) => entry.name);
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
