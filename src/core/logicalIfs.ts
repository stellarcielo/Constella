// 論理的な IF(ホストの interfaces に type を書いた IF。SPEC 4.6)。
// bond と VLAN インターフェースはキャンバスに箱を置かず、ラベルに出す(ブリッジの箱は bridges.ts)。

import { ifNameKey } from "./ifname";
import { findModel } from "./topology";
import type { Device, InterfaceInfo, LogicalIfType, ModelCatalog, Topology } from "./types";

/** 論理的な IF の名前(YAML に書いた順) */
export function logicalIfsOf(device: Device | undefined, type: LogicalIfType): string[] {
  if (!device) return [];
  return [...device.interfaces].filter(([, info]) => info.type === type).map(([name]) => name);
}

/** IF が論理的な IF なら、その表記と情報。長い名前・短い名前、大文字小文字の違いは同じとみなす */
export function findLogicalIf(
  device: Device | undefined,
  name: string,
): { name: string; info: InterfaceInfo } | undefined {
  if (!device) return undefined;
  const key = ifNameKey(name);
  for (const [n, info] of device.interfaces) {
    if (info.type !== undefined && ifNameKey(n) === key) return { name: n, info };
  }
  return undefined;
}

/** IF を members に書いている論理的な IF(bond・ブリッジ)。except は数えない */
export function memberOwner(
  device: Device | undefined,
  name: string,
  except?: string,
): string | undefined {
  if (!device) return undefined;
  const key = ifNameKey(name);
  for (const [n, info] of device.interfaces) {
    if (except !== undefined && ifNameKey(n) === ifNameKey(except)) continue;
    if (info.members?.some((m) => ifNameKey(m) === key)) return n;
  }
  return undefined;
}

/** IF を束ねている bond(SPEC 7.3 の、物理的な線のラベルに添える) */
export function bondOf(device: Device | undefined, name: string): string | undefined {
  const owner = memberOwner(device, name);
  return owner !== undefined && device?.interfaces.get(owner)?.type === "bond" ? owner : undefined;
}

/**
 * VLAN インターフェースの親と VLAN ID(SPEC 4.3)。vlan-raw-device と vlan が無ければ、名前から決める
 * (`親.VLAN ID` なら両方、`vlan10` の形なら VLAN ID)。決められなければ undefined
 */
export function vlanInterface(
  name: string,
  info: InterfaceInfo,
): { parent?: string; vid?: number } {
  const dotted = /^(.+)\.(\d+)$/.exec(name);
  const named = /^vlan(\d+)$/i.exec(name);
  const fromName = dotted ? Number(dotted[2]) : named ? Number(named[1]) : undefined;
  return { parent: info.vlanRawDevice ?? dotted?.[1], vid: info.vlan ?? fromName };
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

/** prefix + 使われていない最小の番号(bond0、vmbr0 …) */
export function nextLogicalIfName(device: Device, prefix: string, catalog: ModelCatalog): string {
  const used = usedNames(device, catalog);
  for (let n = 0; ; n++) {
    const name = `${prefix}${n}`;
    if (!used.has(ifNameKey(name))) return name;
  }
}

/** 論理的な IF の名前として使えるか。使えなければ理由を返す(current は今の自分の名前) */
export function checkLogicalIfName(
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

/**
 * 論理的な IF の名前を変える。IF の順序は保ち、リンクと、ほかの IF の members・vlan-raw-device も
 * 書き換える。変えたあとの名前を返す(ブリッジの位置のキーは bridges.ts の renameBridge で書き換える)
 */
export function renameLogicalIf(
  t: Topology,
  host: string,
  oldName: string,
  newName: string,
): string | undefined {
  const device = t.devices.get(host);
  const found = findLogicalIf(device, oldName);
  if (!device || !found) return undefined;
  const name = newName.trim();
  const oldKey = ifNameKey(found.name);
  const rename = (n: string) => (ifNameKey(n) === oldKey ? name : n);
  device.interfaces = new Map([...device.interfaces].map(([n, info]) => [rename(n), info]));
  for (const info of device.interfaces.values()) {
    if (info.members?.some((m) => ifNameKey(m) === oldKey)) info.members = info.members.map(rename);
    if (info.vlanRawDevice !== undefined) info.vlanRawDevice = rename(info.vlanRawDevice);
  }
  for (const link of t.links) {
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (ep?.device === host && ifNameKey(ep.iface) === oldKey) {
        link[end] = { device: host, iface: name };
      }
    }
  }
  return name;
}

/**
 * 論理的な IF を消す。つながっていたリンクと、ほかの IF の members からも取り除く
 * (ブリッジの位置は bridges.ts の removeBridges で消す)
 */
export function removeLogicalIf(t: Topology, host: string, name: string): void {
  const device = t.devices.get(host);
  const found = findLogicalIf(device, name);
  if (!device || !found) return;
  const key = ifNameKey(found.name);
  const at = (ep: { device: string; iface: string } | undefined) =>
    ep?.device === host && ifNameKey(ep.iface) === key;
  t.links = t.links.filter((l) => !at(l.a) && !at(l.b));
  device.interfaces.delete(found.name);
  for (const info of device.interfaces.values()) {
    if (info.members?.some((m) => ifNameKey(m) === key)) {
      const members = info.members.filter((m) => ifNameKey(m) !== key);
      if (members.length > 0) info.members = members;
      else delete info.members;
    }
  }
}

/** bond を足し、その名前を返す(bond0, bond1 …) */
export function addBond(t: Topology, host: string, catalog: ModelCatalog): string | undefined {
  const device = t.devices.get(host);
  if (!device) return undefined;
  const name = nextLogicalIfName(device, "bond", catalog);
  device.interfaces.set(name, { type: "bond", extra: {} });
  return name;
}

/**
 * VLAN インターフェースを足し、その名前(`親.VLAN ID`)を返す。VLAN ID は 10 から、
 * 名前が使われていない番号にする
 */
export function addVlanInterface(
  t: Topology,
  host: string,
  parent: string,
  catalog: ModelCatalog,
): string | undefined {
  const device = t.devices.get(host);
  if (!device) return undefined;
  const used = usedNames(device, catalog);
  let vid = 10;
  while (used.has(ifNameKey(`${parent}.${vid}`)) && vid < 4094) vid++;
  // 論理的な IF の名前は書いたとおりに保つ(SPEC 4.4)ので、略称にそろえない
  const name = `${parent}.${vid}`;
  device.interfaces.set(name, { type: "vlan", extra: {} });
  return name;
}

// ---------------------------------------------------------------------------
// ラベル(SPEC 7.3・フェーズ4-3 Q1・Q2)
// ---------------------------------------------------------------------------

/** IP の行の書き方。クラスタのネットワークの名前を添えるときに渡す(clusterIpText。フェーズ4-5) */
type IpText = (ip: string) => string;
const plainIp: IpText = (ip) => ip;

/** VLAN インターフェースの IP の行(「vmbr0.10 192.168.10.2/24」) */
function vlanIpLines(
  device: Device,
  onParent: (parent: string | undefined) => boolean,
  ipText: IpText,
): string[] {
  return logicalIfsOf(device, "vlan").flatMap((name) => {
    const info = device.interfaces.get(name);
    if (!info || !onParent(vlanInterface(name, info).parent)) return [];
    return (info.ip ?? []).map((ip) => `${name} ${ipText(ip)}`);
  });
}

/** ブリッジの箱の下に出す行。ブリッジの IP と、ブリッジの上の VLAN インターフェースの IP */
export function bridgeIpLines(device: Device, bridge: string, ipText = plainIp): string[] {
  const key = ifNameKey(bridge);
  return [
    ...(device.interfaces.get(bridge)?.ip ?? []).map(ipText),
    ...vlanIpLines(device, (parent) => parent !== undefined && ifNameKey(parent) === key, ipText),
  ];
}

/**
 * ホストの名前の下に出す行。bond の IP と、ブリッジ以外(bond・物理的な IF など)の上の
 * VLAN インターフェースの IP
 */
export function hostIpLines(device: Device, ipText = plainIp): string[] {
  const bonds = logicalIfsOf(device, "bond").flatMap((name) =>
    (device.interfaces.get(name)?.ip ?? []).map((ip) => `${name} ${ipText(ip)}`),
  );
  const onBridge = (parent: string | undefined) =>
    parent !== undefined && findLogicalIf(device, parent)?.info.type === "bridge";
  return [...bonds, ...vlanIpLines(device, (parent) => !onBridge(parent), ipText)];
}

/**
 * ブリッジとホストの間の線のラベル(ホスト側)。1 行目にブリッジの members、
 * bond があれば、その下に束ねた IF とモード(「eno1 + eno2(802.3ad)」)。members が無ければ空
 */
export function uplinkLabelLines(
  device: Device,
  bridge: string,
  show: (name: string) => string = (name) => name,
): string[] {
  const members = device.interfaces.get(bridge)?.members ?? [];
  if (members.length === 0) return [];
  const bonds = members.flatMap((member) => {
    const bond = findLogicalIf(device, member);
    if (bond?.info.type !== "bond" || !bond.info.members?.length) return [];
    const mode = bond.info.bondMode ? `(${bond.info.bondMode})` : "";
    return [`${bond.info.members.map(show).join(" + ")}${mode}`];
  });
  return [members.map(show).join(", "), ...bonds];
}
