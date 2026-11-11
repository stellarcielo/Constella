// ブリッジ(ホストの中の仮想スイッチ。SPEC 4.6)。ホストの interfaces の type: bridge の IF を、
// キャンバスでは小さな箱として描く。箱の ID と layout のキーは「ホストのデバイスID:ブリッジ名」
// (デバイスID には : が使えないので、デバイスの ID と重ならない)。
// SDN の VNet も、ホストの中のブリッジとして同じ箱で描く(フェーズ4-6)。VNet の箱は、ゲストがつながって
// いるホストと、位置を覚えているホストにだけ描く(フェーズ4-6 Q1)。

import { renameBendNodes } from "./bendKeys";
import { ifNameKey } from "./ifname";
import { nextLogicalIfName, removeLogicalIf, renameLogicalIf } from "./logicalIfs";
import { findVnet, zoneOfVnet } from "./sdn";
import type { Device, Endpoint, Link, ModelCatalog, Position, Topology } from "./types";

/** キャンバスの箱の大きさ(Canvas.css の .bridge-node と合わせる)。箱の下に IP などを出す */
export const BRIDGE_BOX = { width: 80, height: 26 };
/** 自動レイアウトで取る大きさ(幅は機器と同じ。高さは箱と、その下の 1 行分) */
export const BRIDGE_NODE_SIZE = { width: 96, height: 40 };

export function bridgeKey(host: string, bridge: string): string {
  return `${host}:${bridge}`;
}

/** 箱の ID(layout のキー)をホストとブリッジ名に分ける。: が無ければ undefined */
export function parseBridgeKey(key: string): { host: string; bridge: string } | undefined {
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) return undefined;
  return { host: key.slice(0, i), bridge: key.slice(i + 1) };
}

/** デバイスのブリッジ(type: bridge の IF)の名前。YAML に書いた順 */
export function bridgesOf(device: Device | undefined): string[] {
  if (!device) return [];
  return [...device.interfaces].filter(([, info]) => info.type === "bridge").map(([name]) => name);
}

/** IF がブリッジなら、その表記(interfaces のキー)。長い名前・短い名前、大文字小文字の違いは同じとみなす */
export function findBridge(device: Device | undefined, iface: string): string | undefined {
  const key = ifNameKey(iface);
  return bridgesOf(device).find((name) => ifNameKey(name) === key);
}

/** ホストに描く VNet の箱の VNet ID(ゲストがつながっているか、位置を覚えているもの。sdn に書いた順) */
export function vnetsShownOn(t: Topology, host: string): string[] {
  const device = t.devices.get(host);
  if (!device || t.sdn.vnets.size === 0) return [];
  const shown = new Set<string>();
  const add = (iface: string) => {
    const vnet = findVnet(t, device, iface);
    if (vnet !== undefined) shown.add(vnet);
  };
  for (const link of t.links) {
    if (link.a?.device === host) add(link.a.iface);
    if (link.b?.device === host) add(link.b.iface);
  }
  for (const key of t.layout.keys()) {
    const parsed = parseBridgeKey(key);
    if (parsed?.host === host) add(parsed.bridge);
  }
  return [...t.sdn.vnets.keys()].filter((id) => shown.has(id));
}

/** ホストの箱の名前。ブリッジ(YAML に書いた順)と、描く VNet(sdn に書いた順) */
export function hostBridges(t: Topology, host: string): string[] {
  return [...bridgesOf(t.devices.get(host)), ...vnetsShownOn(t, host)];
}

/** IF がホストのブリッジか VNet なら、その表記(ブリッジは interfaces のキー、VNet は VNet ID) */
export function findHostBridge(t: Topology, host: string, iface: string): string | undefined {
  const device = t.devices.get(host);
  return findBridge(device, iface) ?? findVnet(t, device, iface);
}

/** 箱の ID が指すブリッジか VNet の箱があれば、その箱の ID(表記をそろえたもの) */
export function resolveBridgeKey(t: Topology, key: string): string | undefined {
  const parsed = parseBridgeKey(key);
  if (!parsed) return undefined;
  const device = t.devices.get(parsed.host);
  const bridge = findBridge(device, parsed.bridge);
  if (bridge !== undefined) return bridgeKey(parsed.host, bridge);
  const vnet = findVnet(t, device, parsed.bridge);
  return vnet !== undefined && vnetsShownOn(t, parsed.host).includes(vnet)
    ? bridgeKey(parsed.host, vnet)
    : undefined;
}

/** VNet の箱の ID なら、ホストと VNet ID */
export function parseVnetKey(t: Topology, key: string): { host: string; vnet: string } | undefined {
  const parsed = parseBridgeKey(key);
  if (!parsed || resolveBridgeKey(t, key) !== key) return undefined;
  const device = t.devices.get(parsed.host);
  if (findBridge(device, parsed.bridge) !== undefined) return undefined;
  const vnet = findVnet(t, device, parsed.bridge);
  return vnet === undefined ? undefined : { host: parsed.host, vnet };
}

/**
 * 図のすべての箱(デバイスの順、その中はブリッジ・VNet の順)。vnet は VNet の箱か
 */
export function allBridges(
  t: Topology,
): { key: string; host: string; bridge: string; vnet: boolean }[] {
  return [...t.devices.values()].flatMap((device) => [
    ...bridgesOf(device).map((bridge) => ({
      key: bridgeKey(device.id, bridge),
      host: device.id,
      bridge,
      vnet: false,
    })),
    ...vnetsShownOn(t, device.id).map((vnet) => ({
      key: bridgeKey(device.id, vnet),
      host: device.id,
      bridge: vnet,
      vnet: true,
    })),
  ]);
}

/** エンドポイントを描く箱の ID。ブリッジや VNet ならその箱、それ以外はデバイス */
export function endpointNodeId(t: Topology, ep: Endpoint): string {
  const bridge = findHostBridge(t, ep.device, ep.iface);
  return bridge === undefined ? ep.device : bridgeKey(ep.device, bridge);
}

/** エンドポイントがブリッジか VNet か */
export function isBridgeEndpoint(t: Topology, ep: Endpoint): boolean {
  return findHostBridge(t, ep.device, ep.iface) !== undefined;
}

/**
 * VNet の箱から引く点線の先(SPEC 7.3)。vlan・qinq はゾーンのブリッジの箱(ホストに無ければ引かない)、
 * vxlan・evpn はホスト、simple は引かない
 */
export function vnetUplinkTarget(t: Topology, host: string, vnet: string): string | undefined {
  const zone = zoneOfVnet(t, vnet);
  switch (zone?.type) {
    case "vlan":
    case "qinq": {
      const bridge =
        zone.bridge === undefined ? undefined : findBridge(t.devices.get(host), zone.bridge);
      return bridge === undefined ? undefined : bridgeKey(host, bridge);
    }
    case "vxlan":
    case "evpn":
      return host;
    default:
      return undefined;
  }
}

/** ブリッジにつながるリンク(YAML に書いた順) */
export function bridgeLinks(t: Topology, host: string, bridge: string): Link[] {
  const key = ifNameKey(bridge);
  const at = (ep: Endpoint | undefined) => ep?.device === host && ifNameKey(ep.iface) === key;
  return t.links.filter((l) => at(l.a) || at(l.b));
}

/** 新しいブリッジの名前(vmbr0, vmbr1 …。使われていない最小の番号。Proxmox VE と同じ) */
export function nextBridgeName(device: Device, catalog: ModelCatalog): string {
  return nextLogicalIfName(device, "vmbr", catalog);
}

/** ホストにブリッジを足し、その名前を返す。position を渡すと、その位置に置く */
export function addBridge(
  t: Topology,
  host: string,
  catalog: ModelCatalog,
  position?: Position,
): string | undefined {
  const device = t.devices.get(host);
  if (!device) return undefined;
  const name = nextBridgeName(device, catalog);
  device.interfaces.set(name, { type: "bridge", extra: {} });
  if (position) {
    t.layout.set(bridgeKey(host, name), { x: Math.round(position.x), y: Math.round(position.y) });
  }
  return name;
}

/**
 * ブリッジを消す(箱の ID で渡す)。つながっていたリンクと layout、ほかの IF の members からも取り除く。
 * VNet の箱は、そのホストでつながっていたリンクと位置を消す(VNet の定義は残す。フェーズ4-6 Q4)
 */
export function removeBridges(t: Topology, keys: Iterable<string>): void {
  for (const key of keys) {
    const parsed = parseBridgeKey(key);
    if (!parsed) continue;
    const device = t.devices.get(parsed.host);
    const bridge = findBridge(device, parsed.bridge);
    if (bridge !== undefined) {
      removeLogicalIf(t, parsed.host, bridge);
      t.layout.delete(bridgeKey(parsed.host, bridge));
      continue;
    }
    const vnet = findVnet(t, device, parsed.bridge);
    if (vnet === undefined) continue;
    const links = new Set(bridgeLinks(t, parsed.host, vnet));
    t.links = t.links.filter((l) => !links.has(l));
    for (const k of [...t.layout.keys()]) {
      const at = parseBridgeKey(k);
      if (at?.host === parsed.host && ifNameKey(at.bridge) === ifNameKey(vnet)) t.layout.delete(k);
    }
  }
}

/**
 * ブリッジの名前を変える。IF の順序は保ち、リンク・layout(箱とラベルの位置、曲げた線の点)・ほかの IF の members と
 * vlan-raw-device も書き換える
 */
export function renameBridge(t: Topology, host: string, oldName: string, newName: string): void {
  const bridge = findBridge(t.devices.get(host), oldName);
  if (bridge === undefined) return;
  const name = renameLogicalIf(t, host, bridge, newName);
  if (name === undefined || name === bridge) return;
  const from = bridgeKey(host, bridge);
  const to = bridgeKey(host, name);
  if (t.layout.has(from)) {
    t.layout = new Map([...t.layout].map(([k, p]) => [k === from ? to : k, p]));
  }
  // ホスト側のラベルの位置(SPEC 4.3。キーは箱と同じ「ホスト:ブリッジ名」)
  if (t.labelLayout.has(from)) {
    t.labelLayout = new Map([...t.labelLayout].map(([k, o]) => [k === from ? to : k, o]));
  }
  // 曲げた線の点(キーの片方が箱の ID)
  renameBendNodes(t, (node) => (node === from ? to : node));
}

/**
 * ゲストのホストを変えると、どうなるリンクか(SPEC 7.1・フェーズ4-2 Q2)。
 * VNet へのリンクは、新しいホストの同じ VNet へ付け替える(ゾーンに入っていなければエラーで知らせる)
 */
export interface HostChangeImpact {
  /** 新しいホストの、同じ名前のブリッジ(VNet)へ付け替えるリンク */
  moved: Link[];
  /** 新しいホストに同じ名前のブリッジが無く、消えるリンク */
  lost: Link[];
}

/** ゲストのリンクのうち、今のホストのブリッジへのもの */
function linksToHostBridges(t: Topology, guest: string): { link: Link; end: "a" | "b" }[] {
  const host = t.devices.get(guest)?.host;
  if (host === undefined || host === guest) return [];
  const result: { link: Link; end: "a" | "b" }[] = [];
  for (const link of t.links) {
    for (const [end, other] of [
      ["a", "b"],
      ["b", "a"],
    ] as const) {
      const ep = link[end];
      if (ep?.device === host && link[other]?.device === guest && isBridgeEndpoint(t, ep)) {
        result.push({ link, end });
      }
    }
  }
  return result;
}

export function hostChangeImpact(
  t: Topology,
  guest: string,
  newHost: string | undefined,
): HostChangeImpact {
  const impact: HostChangeImpact = { moved: [], lost: [] };
  for (const { link, end } of linksToHostBridges(t, guest)) {
    const ep = link[end];
    const bridge = ep && newHost !== undefined ? findHostBridge(t, newHost, ep.iface) : undefined;
    if (bridge !== undefined) impact.moved.push(link);
    else impact.lost.push(link);
  }
  return impact;
}

/**
 * ゲストのホストを変える(undefined ならホストなし)。今のホストのブリッジへのリンクは、
 * 新しいホストに同じ名前のブリッジがあれば付け替える。無ければ removeLost のときだけ消す
 */
export function changeHost(
  t: Topology,
  guest: string,
  newHost: string | undefined,
  { removeLost }: { removeLost: boolean },
): void {
  const device = t.devices.get(guest);
  if (!device) return;
  const lost = new Set<Link>();
  for (const { link, end } of linksToHostBridges(t, guest)) {
    const ep = link[end];
    const bridge = ep && newHost !== undefined ? findHostBridge(t, newHost, ep.iface) : undefined;
    if (newHost !== undefined && bridge !== undefined)
      link[end] = { device: newHost, iface: bridge };
    else if (removeLost) lost.add(link);
  }
  if (lost.size > 0) t.links = t.links.filter((l) => !lost.has(l));
  // GUI で設定した値は、YAML で解釈できなかった値(extra)より優先する
  Reflect.deleteProperty(device.extra, "host");
  if (newHost === undefined) delete device.host;
  else device.host = newHost;
}
