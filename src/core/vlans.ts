// VLAN の一覧(vlans の書き方。SPEC 4.3)と、VLAN の通り道(SPEC 4.6・フェーズ4-4)。
// 通り道では、ゲストやホスト、SDN の VNet(フェーズ4-6)が使う VLAN が最初のスイッチまで通るかを確かめ、
// 止まる場所ごとにまとめる。

import { findBridge } from "./bridges";
import { interfaceInfo } from "./ifLabel";
import { ifNameKey } from "./ifname";
import { findLogicalIf, logicalIfsOf, vlanInterface } from "./logicalIfs";
import { zoneHosts, zoneOfVnet } from "./sdn";
import type { Device, Endpoint, InterfaceInfo, ModelCatalog, Topology } from "./types";

/** VLAN ID の範囲([最初, 最後])の並び。小さい順で、重ならない */
export type VlanRanges = [number, number][];

const VLAN_ID_MIN = 1;
const VLAN_ID_MAX = 4094;

/** VLAN aware なブリッジで vlans を省略したときに通す VLAN(Proxmox VE の bridge-vids の既定) */
export const BRIDGE_VLANS_DEFAULT = "2-4094";

/**
 * vlans を読む(SPEC 4.3)。`,`・`;`・空白で区切り、`10-20` の範囲と、`all`(すべて)・`none`(なし)も
 * 書ける。読めなければ undefined
 */
export function parseVlanList(text: string): VlanRanges | undefined {
  const value = text.trim();
  if (/^all$/i.test(value)) return [[VLAN_ID_MIN, VLAN_ID_MAX]];
  if (/^none$/i.test(value)) return [];
  const tokens = value
    .replace(/\s*-\s*/g, "-")
    .split(/[\s,;]+/)
    .filter((token) => token !== "");
  if (tokens.length === 0) return undefined;
  const ranges: VlanRanges = [];
  for (const token of tokens) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!m) return undefined;
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < VLAN_ID_MIN || to > VLAN_ID_MAX || from > to) return undefined;
    ranges.push([from, to]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: VlanRanges = [];
  for (const [from, to] of ranges) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

/** vlans として読めるか。読めなければ理由を返す(インスペクタの入力欄) */
export function checkVlanList(text: string): string | undefined {
  return parseVlanList(text) === undefined
    ? "書き方が分かりません(例: 10,20,100-110。VLAN ID は 1〜4094)"
    : undefined;
}

export function vlanRangesHave(ranges: VlanRanges, vid: number): boolean {
  return ranges.some(([from, to]) => from <= vid && vid <= to);
}

/** VLAN ID を小さい順に「10,20,30-32」の形で書く(3 つ以上続けば範囲にする) */
export function formatVlanIds(vids: Iterable<number>): string {
  const sorted = [...new Set(vids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`${sorted[i]}-${sorted[j]}`);
    else parts.push(...sorted.slice(i, j + 1).map(String));
    i = j + 1;
  }
  return parts.join(",");
}

/**
 * ポートの VLAN の扱い。mode が無くても vlans があれば trunk とみなす(ラベルと同じ)。
 * routed や、mode・vlans のどちらも無ければ undefined
 */
export function portVlanMode(info: InterfaceInfo | undefined): "trunk" | "access" | undefined {
  if (info?.mode === "trunk" || (info?.mode === undefined && info?.vlans !== undefined)) {
    return "trunk";
  }
  return info?.mode === "access" ? "access" : undefined;
}

/**
 * VLAN を使っている IF(ゲストの IF・VLAN インターフェース・VNet の「ホスト:VNet ID」)と、
 * その IF の VLAN のうち止まるもの
 */
export interface VlanUse {
  source: Endpoint;
  vlans: number[];
}

/** VLAN が止まる場所と、そこを通らない VLAN(SPEC 4.6 の VLAN の通り道) */
export interface VlanBlock {
  /** ブリッジ、または物理的な IF にリンクでつながる相手のポート */
  at: Endpoint;
  kind: "bridge" | "trunk" | "access";
  /** ブリッジ・trunk の vlans(書いたとおり。ブリッジで省略されていれば 2-4094) */
  allowed?: string;
  /** 通らない VLAN ID(小さい順) */
  vlans: number[];
  uses: VlanUse[];
}

/** ゲストの IF の VLAN(タグと trunk の vlans)。trunk ですべて通すときは、trunk の分は確かめない */
function guestVlans(info: InterfaceInfo | undefined): number[] {
  if (!info) return [];
  const vids = new Set<number>(info.vlan === undefined ? [] : [info.vlan]);
  if (portVlanMode(info) === "trunk" && info.vlans !== undefined) {
    const ranges = parseVlanList(info.vlans) ?? [];
    const all = ranges.length === 1 && ranges[0][0] === VLAN_ID_MIN && ranges[0][1] === VLAN_ID_MAX;
    if (!all) for (const [from, to] of ranges) for (let v = from; v <= to; v++) vids.add(v);
  }
  return [...vids].sort((a, b) => a - b);
}

const endKey = (ep: Endpoint) => `${ep.device}\u0000${ifNameKey(ep.iface)}`;

/**
 * VLAN の通り道を確かめ、止まる場所ごとにまとめる(SPEC 4.6)。ゲストの IF はつながるブリッジから、
 * VLAN インターフェースは親から、SDN の VLAN はゾーンのブリッジから、物理的な IF にリンクでつながる
 * 相手のポートまでたどる。catalog は、ゾーンのホスト(nodes の省略時はロールが hypervisor の機器)を
 * 決めるのに使う
 */
export function vlanBlocks(t: Topology, catalog: ModelCatalog): VlanBlock[] {
  /** 物理的な IF などのリンクの相手(最初のリンク。二重使用は別のエラーで知らせる) */
  const peers = new Map<string, Endpoint>();
  for (const link of t.links) {
    if (!link.a || !link.b) continue;
    if (!peers.has(endKey(link.a))) peers.set(endKey(link.a), link.b);
    if (!peers.has(endKey(link.b))) peers.set(endKey(link.b), link.a);
  }

  const blocks = new Map<
    string,
    {
      at: Endpoint;
      kind: VlanBlock["kind"];
      allowed?: string;
      vlans: Set<number>;
      uses: Map<string, { source: Endpoint; vlans: Set<number> }>;
    }
  >();
  const stop = (
    at: Endpoint,
    kind: VlanBlock["kind"],
    allowed: string | undefined,
    source: Endpoint,
    vids: number[],
  ) => {
    if (vids.length === 0) return;
    let block = blocks.get(endKey(at));
    if (!block) {
      block = { at, kind, allowed, vlans: new Set(), uses: new Map() };
      blocks.set(endKey(at), block);
    }
    let use = block.uses.get(endKey(source));
    if (!use) {
      use = { source, vlans: new Set() };
      block.uses.set(endKey(source), use);
    }
    for (const vid of vids) {
      block.vlans.add(vid);
      use.vlans.add(vid);
    }
  };

  /** device の IF name から先へ進む。vids はここまで通ってきた VLAN、seen は通った IF */
  const walk = (
    device: Device,
    name: string,
    source: Endpoint,
    vids: number[],
    seen: Set<string>,
  ) => {
    const key = ifNameKey(name);
    if (vids.length === 0 || seen.has(key)) return;
    seen.add(key);
    const logical = findLogicalIf(device, name);
    // members の VLAN インターフェースの中では、タグが内側に包まれるので、その先は確かめない
    if (logical?.info.type === "vlan") return;
    if (logical) {
      let pass = vids;
      if (logical.info.type === "bridge" && logical.info.vlanAware === true) {
        const allowed = logical.info.vlans ?? BRIDGE_VLANS_DEFAULT;
        const ranges = parseVlanList(allowed);
        if (ranges) {
          const stopped = vids.filter((v) => !vlanRangesHave(ranges, v));
          stop({ device: device.id, iface: logical.name }, "bridge", allowed, source, stopped);
          pass = vids.filter((v) => vlanRangesHave(ranges, v));
        }
      }
      for (const member of logical.info.members ?? []) walk(device, member, source, pass, seen);
      return;
    }
    // 物理的な IF: リンクでつながる相手のポートで確かめる(機器のロールは問わない)
    const peer = peers.get(endKey({ device: device.id, iface: name }));
    const peerDevice = peer && t.devices.get(peer.device);
    if (!peer || !peerDevice || findLogicalIf(peerDevice, peer.iface)) return;
    const info = interfaceInfo(peerDevice, peer.iface);
    const mode = portVlanMode(info);
    if (mode === "access") {
      stop(peer, "access", undefined, source, vids);
    } else if (mode === "trunk" && info?.vlans !== undefined) {
      const ranges = parseVlanList(info.vlans);
      const stopped = ranges && vids.filter((v) => !vlanRangesHave(ranges, v));
      if (stopped) stop(peer, "trunk", info.vlans, source, stopped);
    }
  };

  // ブリッジにつながったゲストの IF(VNet につながったゲストの IF は、VNet が VLAN を決めるので確かめない)
  for (const link of t.links) {
    if (!link.a || !link.b) continue;
    const ends: [Endpoint, Endpoint][] = [
      [link.a, link.b],
      [link.b, link.a],
    ];
    for (const [ep, guestEnd] of ends) {
      const host = t.devices.get(ep.device);
      const bridge = findBridge(host, ep.iface);
      const guest = t.devices.get(guestEnd.device);
      if (!host || bridge === undefined || !guest) continue;
      if (findBridge(guest, guestEnd.iface) !== undefined) continue; // ブリッジどうし(エラー)
      walk(host, bridge, guestEnd, guestVlans(interfaceInfo(guest, guestEnd.iface)), new Set());
    }
  }
  // VLAN インターフェース。親が VLAN インターフェースなら、外側の VLAN はその親で確かめる
  for (const device of t.devices.values()) {
    for (const name of logicalIfsOf(device, "vlan")) {
      const info = device.interfaces.get(name);
      if (!info) continue;
      const { parent, vid } = vlanInterface(name, info);
      if (parent === undefined || vid === undefined || vid < VLAN_ID_MIN || vid > VLAN_ID_MAX) {
        continue; // 親や VLAN ID が分からなければ、エラーで知らせる
      }
      if (findLogicalIf(device, parent)?.info.type === "vlan") continue;
      walk(device, parent, { device: device.id, iface: name }, [vid], new Set());
    }
  }
  // SDN の VLAN(フェーズ4-6 Q3): vlan ゾーンは VNet の tag、qinq ゾーンはゾーンの tag(外側の VLAN)を、
  // ゾーンのすべてのホストで、ゾーンのブリッジから確かめる
  for (const [vnet, info] of t.sdn.vnets) {
    const zone = zoneOfVnet(t, vnet);
    if (!zone || zone.bridge === undefined) continue;
    const vid = zone.type === "vlan" ? info.tag : zone.type === "qinq" ? zone.tag : undefined;
    if (vid === undefined || vid < VLAN_ID_MIN || vid > VLAN_ID_MAX) continue;
    for (const host of zoneHosts(t, zone, catalog)) {
      const device = t.devices.get(host);
      const bridge = findBridge(device, zone.bridge);
      if (device && bridge !== undefined) {
        walk(device, bridge, { device: host, iface: vnet }, [vid], new Set());
      }
    }
  }

  return [...blocks.values()].map((block) => ({
    at: block.at,
    kind: block.kind,
    ...(block.allowed === undefined ? {} : { allowed: block.allowed }),
    vlans: [...block.vlans].sort((a, b) => a - b),
    uses: [...block.uses.values()].map((use) => ({
      source: use.source,
      vlans: [...use.vlans].sort((a, b) => a - b),
    })),
  }));
}
