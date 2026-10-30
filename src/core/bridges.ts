// ブリッジ(ホストの中の仮想スイッチ。SPEC 4.6)。ホストの interfaces の type: bridge の IF を、
// キャンバスでは小さな箱として描く。箱の ID と layout のキーは「ホストのデバイスID:ブリッジ名」
// (デバイスID には : が使えないので、デバイスの ID と重ならない)。

import { ifNameKey, normalizeIfName } from "./ifname";
import { findModel } from "./topology";
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

/** 箱の ID が指すブリッジがあれば、その箱の ID(表記をそろえたもの) */
export function resolveBridgeKey(t: Topology, key: string): string | undefined {
  const parsed = parseBridgeKey(key);
  if (!parsed) return undefined;
  const bridge = findBridge(t.devices.get(parsed.host), parsed.bridge);
  return bridge === undefined ? undefined : bridgeKey(parsed.host, bridge);
}

/** 図のすべてのブリッジ(デバイスの順、その中は YAML に書いた順) */
export function allBridges(t: Topology): { key: string; host: string; bridge: string }[] {
  return [...t.devices.values()].flatMap((device) =>
    bridgesOf(device).map((bridge) => ({
      key: bridgeKey(device.id, bridge),
      host: device.id,
      bridge,
    })),
  );
}

/** エンドポイントを描く箱の ID。ブリッジならその箱、それ以外はデバイス */
export function endpointNodeId(t: Topology, ep: Endpoint): string {
  const bridge = findBridge(t.devices.get(ep.device), ep.iface);
  return bridge === undefined ? ep.device : bridgeKey(ep.device, bridge);
}

/** エンドポイントがブリッジか */
export function isBridgeEndpoint(t: Topology, ep: Endpoint): boolean {
  return findBridge(t.devices.get(ep.device), ep.iface) !== undefined;
}

/** ブリッジにつながるリンク(YAML に書いた順) */
export function bridgeLinks(t: Topology, host: string, bridge: string): Link[] {
  const key = ifNameKey(bridge);
  const at = (ep: Endpoint | undefined) => ep?.device === host && ifNameKey(ep.iface) === key;
  return t.links.filter((l) => at(l.a) || at(l.b));
}

/** デバイスで使われている IF 名(モデルのポートと interfaces) */
function usedNames(device: Device, catalog: ModelCatalog): Set<string> {
  return new Set(
    [
      ...(findModel(device, catalog)?.ports.map((p) => p.name) ?? []),
      ...device.interfaces.keys(),
    ].map(ifNameKey),
  );
}

/** 新しいブリッジの名前(vmbr0, vmbr1 …。使われていない最小の番号。Proxmox VE と同じ) */
export function nextBridgeName(device: Device, catalog: ModelCatalog): string {
  const used = usedNames(device, catalog);
  for (let n = 0; ; n++) {
    const name = `vmbr${n}`;
    if (!used.has(ifNameKey(name))) return name;
  }
}

/** ブリッジの名前として使えるか。使えなければ理由を返す(current は今の自分の名前) */
export function checkBridgeName(
  device: Device,
  name: string,
  catalog: ModelCatalog,
  current?: string,
): string | undefined {
  if (name === "") return "名前を入力してください";
  if (/[\s:]/.test(name)) return "名前に空白と : は使えません";
  const key = ifNameKey(name);
  if (current !== undefined && ifNameKey(current) === key) return undefined;
  if (usedNames(device, catalog).has(key)) return `「${name}」は既に使われています`;
  return undefined;
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

/** ブリッジを消す(箱の ID で渡す)。つながっていたリンクと layout、ほかの IF の members からも取り除く */
export function removeBridges(t: Topology, keys: Iterable<string>): void {
  for (const key of keys) {
    const parsed = parseBridgeKey(key);
    const device = parsed && t.devices.get(parsed.host);
    const bridge = parsed && findBridge(device, parsed.bridge);
    if (!parsed || !device || bridge === undefined) continue;
    const gone = new Set(bridgeLinks(t, parsed.host, bridge));
    t.links = t.links.filter((l) => !gone.has(l));
    device.interfaces.delete(bridge);
    t.layout.delete(bridgeKey(parsed.host, bridge));
    for (const info of device.interfaces.values()) {
      if (info.members?.some((m) => ifNameKey(m) === ifNameKey(bridge))) {
        const members = info.members.filter((m) => ifNameKey(m) !== ifNameKey(bridge));
        if (members.length > 0) info.members = members;
        else delete info.members;
      }
    }
  }
}

/**
 * ブリッジの名前を変える。IF の順序は保ち、リンク・layout・ほかの IF の members と
 * vlan-raw-device も書き換える
 */
export function renameBridge(t: Topology, host: string, oldName: string, newName: string): void {
  const device = t.devices.get(host);
  const bridge = findBridge(device, oldName);
  if (!device || bridge === undefined) return;
  const name = normalizeIfName(newName);
  if (name === bridge) return;
  const oldKey = ifNameKey(bridge);
  const rename = (n: string) => (ifNameKey(n) === oldKey ? name : n);
  device.interfaces = new Map([...device.interfaces].map(([n, info]) => [rename(n), info]));
  for (const info of device.interfaces.values()) {
    if (info.members?.some((m) => ifNameKey(m) === oldKey)) info.members = info.members.map(rename);
    if (info.vlanRawDevice !== undefined) info.vlanRawDevice = rename(info.vlanRawDevice);
  }
  for (const link of t.links) {
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (ep?.device === host && ifNameKey(ep.iface) === oldKey)
        link[end] = { device: host, iface: name };
    }
  }
  const from = bridgeKey(host, bridge);
  if (t.layout.has(from)) {
    t.layout = new Map([...t.layout].map(([k, p]) => [k === from ? bridgeKey(host, name) : k, p]));
  }
}

/** ゲストのホストを変えると、どうなるリンクか(SPEC 7.1・フェーズ4-2 Q2) */
export interface HostChangeImpact {
  /** 新しいホストの、同じ名前のブリッジへ付け替えるリンク */
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
  const target = newHost === undefined ? undefined : t.devices.get(newHost);
  const impact: HostChangeImpact = { moved: [], lost: [] };
  for (const { link, end } of linksToHostBridges(t, guest)) {
    const ep = link[end];
    if (ep && findBridge(target, ep.iface) !== undefined) impact.moved.push(link);
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
  const target = newHost === undefined ? undefined : t.devices.get(newHost);
  const lost = new Set<Link>();
  for (const { link, end } of linksToHostBridges(t, guest)) {
    const ep = link[end];
    const bridge = ep && findBridge(target, ep.iface);
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
