// Proxmox VE からの取り込み(SPEC 4.7・フェーズ5-1)。書き出しスクリプト(scripts/proxmox-export.sh)が
// 作った JSON を、トポロジと YAML の文字列に変える。JSON の中身は Proxmox VE の API(pvesh)が返す形のまま。

import { ifNameKey } from "./ifname";
import { vlanInterface } from "./logicalIfs";
import { serializeTopology } from "./serialize";
import { createEmptyTopology, createLinkId, createUid, DEVICE_ID_PATTERN } from "./topology";
import {
  BOND_MODES,
  type BondMode,
  type Device,
  type GuestKind,
  type InterfaceInfo,
  SCHEMA_COMMENT,
  type Topology,
  VMID_MAX,
  VMID_MIN,
} from "./types";

/** 書き出しスクリプトの JSON の形式名と版 */
export const PROXMOX_EXPORT_FORMAT = "constella-proxmox";
export const PROXMOX_EXPORT_VERSION = 1;

export type ProxmoxImportResult =
  | {
      ok: true;
      topology: Topology;
      /** 開く YAML(先頭に JSON Schema のコメント行) */
      text: string;
      /** 読めなかったもの・取り込めなかったもの */
      warnings: string[];
    }
  | { ok: false; error: string };

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
const integer = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
};
const truthy = (v: unknown) => v === 1 || v === true || v === "1";
/** 空白で区切った名前の並び(bridge_ports・slaves など) */
const words = (v: unknown) => (text(v) ?? "").split(/\s+/).filter((w) => w !== "");
/** 数字の部分を数として比べる(eno2 < eno10) */
const naturalOrder = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

const GUEST_PREFIX: Record<GuestKind, string> = { vm: "vm", container: "ct" };
const GUEST_NAME: Record<GuestKind, string> = { vm: "VM", container: "CT" };
const GUEST_MODEL: Record<GuestKind, string> = { vm: "generic-vm", container: "generic-container" };
/** ノードの IF を並べる順(物理的な IF・bond・ブリッジ・VLAN インターフェース) */
const IF_ORDER = { physical: 0, bond: 1, bridge: 2, vlan: 3 } as const;

/**
 * 書き出しスクリプトの JSON を読み込む。形式が違えば ok: false。
 * 停止中のノードなど、読めなかったところは取り込まずに warnings に書く
 */
export function importProxmox(json: string): ProxmoxImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "JSON として読めません" };
  }
  if (!isObject(data) || data.format !== PROXMOX_EXPORT_FORMAT) {
    return {
      ok: false,
      error: "Proxmox VE の書き出しスクリプト(proxmox-export.sh)で作ったファイルではありません",
    };
  }
  if (data.version !== PROXMOX_EXPORT_VERSION) {
    return {
      ok: false,
      error: `対応していない版です(version: ${String(data.version)}。読めるのは ${PROXMOX_EXPORT_VERSION})`,
    };
  }
  const nodes = Array.isArray(data.nodes) ? data.nodes.filter(isObject) : [];
  if (nodes.length === 0) return { ok: false, error: "ノードがありません" };

  const t = createEmptyTopology();
  const warnings: string[] = [];
  t.meta.title = "Proxmox VE";
  const exported = text(data.exported);
  const host = text(data.host);
  if (exported !== undefined || host !== undefined) {
    t.meta.description = `${exported ?? "?"} に ${host ?? "?"} で書き出した構成から取り込みました`;
  }

  /** 使えるデバイスID にする。使えない文字は - に、ほかと重なれば -suffix を付ける */
  const used = new Set<string>();
  const uniqueId = (name: string | undefined, suffix: string, fallback: string): string => {
    const safe = (name ?? "").replace(/[^A-Za-z0-9._-]/g, "-");
    let id = DEVICE_ID_PATTERN.test(safe) ? safe : fallback;
    if (used.has(id)) id = `${id}-${suffix}`;
    for (let n = 2; used.has(id); n++) id = `${fallback}-${n}`;
    used.add(id);
    return id;
  };

  // ノード(書き出した順)。ネットワークを読めたノードは、そのブリッジの名前を覚えておく
  const hosts: { device: Device; source: Json; bridges?: Set<string> }[] = [];
  nodes.forEach((source, i) => {
    const name = text(source.node);
    const device: Device = {
      id: uniqueId(name, String(i + 1), `node${i + 1}`),
      uid: createUid(),
      role: "hypervisor",
      interfaces: new Map(),
      extra: {},
    };
    t.devices.set(device.id, device);
    if (Array.isArray(source.network)) {
      device.interfaces = nodeInterfaces(source.network.filter(isObject));
      const bridges = [...device.interfaces]
        .filter(([, info]) => info.type === "bridge")
        .map(([n]) => ifNameKey(n));
      hosts.push({ device, source, bridges: new Set(bridges) });
    } else {
      warnings.push(
        `${device.id} のネットワークを読めませんでした(ゲストの設定から、ブリッジだけを作りました)`,
      );
      hosts.push({ device, source });
    }
  });

  // ゲスト(ノードごとに VMID の順)と、ブリッジへのリンク
  for (const { device: node, source, bridges } of hosts) {
    const guests = (["vm", "container"] as const)
      .flatMap((kind) => {
        const list = source[kind === "vm" ? "qemu" : "lxc"];
        return (Array.isArray(list) ? list.filter(isObject) : []).map((g) => ({ kind, g }));
      })
      .map(({ kind, g }) => ({ kind, vmid: integer(g.vmid), config: g.config }))
      .sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0));
    for (const { kind, vmid, config } of guests) {
      const what = `${GUEST_NAME[kind]} ${vmid ?? "?"}(${node.id})`;
      if (!isObject(config)) {
        warnings.push(`${what}の設定を読めませんでした`);
        continue;
      }
      if (truthy(config.template)) continue; // テンプレートは取り込まない
      const name = text(kind === "vm" ? config.name : config.hostname);
      const fallback = `${GUEST_PREFIX[kind]}${vmid ?? ""}`;
      const guest: Device = {
        id: uniqueId(name, String(vmid ?? ""), fallback),
        uid: createUid(),
        model: GUEST_MODEL[kind],
        host: node.id,
        interfaces: new Map(),
        extra: {},
      };
      if (name !== undefined && name !== guest.id) guest.label = name;
      if (vmid !== undefined && vmid >= VMID_MIN && vmid <= VMID_MAX) guest.vmid = vmid;
      t.devices.set(guest.id, guest);

      const nets = Object.keys(config)
        .map((key) => /^net(\d+)$/.exec(key))
        .filter((m): m is RegExpExecArray => m !== null)
        .sort((a, b) => Number(a[1]) - Number(b[1]));
      for (const [key, n] of nets) {
        const net = options(text(config[key]));
        const info = guestInterface(
          net,
          kind === "vm" ? options(text(config[`ipconfig${n}`])) : net,
        );
        // 書くことの無い IF は interfaces に書かない(リンクに出てくる)
        if (Object.keys(info).some((k) => k !== "extra")) guest.interfaces.set(key, info);
        const bridge = net.get("bridge");
        if (bridge === undefined) continue;
        if (bridges && !bridges.has(ifNameKey(bridge))) {
          warnings.push(
            `${guest.id} の ${key} のつなぎ先「${bridge}」は ${node.id} のブリッジに無いので、リンクを作りませんでした(SDN の VNet は、まだ取り込めません)`,
          );
          continue;
        }
        // ネットワークを読めなかったノードには、ゲストの bridge= からブリッジを作る
        if (
          !bridges &&
          ![...node.interfaces.keys()].some((k) => ifNameKey(k) === ifNameKey(bridge))
        ) {
          node.interfaces.set(bridge, { type: "bridge", extra: {} });
        }
        t.links.push({
          id: createLinkId(),
          a: { device: guest.id, iface: key },
          b: { device: node.id, iface: bridge },
          extra: {},
        });
      }
    }
  }

  const yaml = serializeTopology(t).text;
  return { ok: true, topology: t, text: `${SCHEMA_COMMENT}\n${yaml}`, warnings };
}

/** ノードのネットワーク(pvesh get /nodes/<node>/network)を IF にする。並べる順は IF_ORDER と名前 */
function nodeInterfaces(network: Json[]): Map<string, InterfaceInfo> {
  const types = new Map(network.map((e) => [text(e.iface) ?? "", text(e.type) ?? ""]));
  const items: { name: string; order: number; info: InterfaceInfo }[] = [];
  /** タグの無い OVSIntPort の IP は、そのブリッジに書く */
  const bridgeIps = new Map<string, string[]>();
  for (const entry of network) {
    const name = text(entry.iface);
    if (name === undefined || name === "") continue;
    const info: InterfaceInfo = { extra: {} };
    let order: number;
    switch (entry.type) {
      case "eth":
      case "OVSPort":
        order = IF_ORDER.physical;
        break;
      case "bond":
      case "OVSBond": {
        order = IF_ORDER.bond;
        info.type = "bond";
        const members = words(entry.type === "bond" ? entry.slaves : entry.ovs_bonds);
        if (members.length > 0) info.members = members;
        const mode = text(entry.bond_mode);
        if (mode !== undefined && (BOND_MODES as readonly string[]).includes(mode)) {
          info.bondMode = mode as BondMode;
        }
        break;
      }
      case "bridge":
      case "OVSBridge": {
        order = IF_ORDER.bridge;
        info.type = "bridge";
        // OVS のブリッジの内部ポート(OVSIntPort)は、ブリッジにつなぐ IF ではない
        const members = words(
          entry.type === "bridge" ? entry.bridge_ports : entry.ovs_ports,
        ).filter((m) => types.get(m) !== "OVSIntPort");
        if (members.length > 0) info.members = members;
        // OVS のブリッジは、いつも VLAN を区別して通す
        if (entry.type === "OVSBridge" || truthy(entry.bridge_vlan_aware)) {
          info.vlanAware = true;
          const vids = words(entry.bridge_vids).join(",");
          if (vids !== "" && vids !== "2-4094") info.vlans = vids;
        }
        break;
      }
      case "vlan":
      case "OVSIntPort": {
        const ovs = entry.type === "OVSIntPort";
        const parent = text(ovs ? entry.ovs_bridge : entry["vlan-raw-device"]);
        const vid = integer(ovs ? entry.ovs_tag : entry["vlan-id"]);
        if (ovs && vid === undefined) {
          if (parent !== undefined)
            bridgeIps.set(parent, [...(bridgeIps.get(parent) ?? []), ...ips(entry)]);
          continue;
        }
        order = IF_ORDER.vlan;
        info.type = "vlan";
        // 名前が「親.VLAN ID」(vlan10 なら VLAN ID)の形なら、名前から分かるので書かない
        const fromName = vlanInterface(name, { extra: {} });
        if (
          parent !== undefined &&
          (fromName.parent === undefined || ifNameKey(fromName.parent) !== ifNameKey(parent))
        ) {
          info.vlanRawDevice = parent;
        }
        if (vid !== undefined && fromName.vid !== vid) info.vlan = vid;
        break;
      }
      default:
        continue; // alias・SDN など
    }
    const address = ips(entry);
    if (address.length > 0) info.ip = address;
    const comment = (text(entry.comments) ?? text(entry.comments6))?.trim();
    if (comment) info.description = comment;
    items.push({ name, order, info });
  }
  for (const item of items) {
    const extra = bridgeIps.get(item.name);
    if (item.info.type === "bridge" && extra) item.info.ip = [...(item.info.ip ?? []), ...extra];
  }
  items.sort((a, b) => a.order - b.order || naturalOrder(a.name, b.name));
  return new Map(items.map((item) => [item.name, item.info]));
}

/** ネットワークの IF の IP(cidr・cidr6。無ければ address と netmask から) */
function ips(entry: Json): string[] {
  const result: string[] = [];
  for (const [cidr, address, netmask] of [
    ["cidr", "address", "netmask"],
    ["cidr6", "address6", "netmask6"],
  ] as const) {
    const value = text(entry[cidr]);
    const plain = text(entry[address]);
    if (value !== undefined) result.push(value);
    else if (plain !== undefined) {
      const prefix = prefixLength(text(entry[netmask]));
      result.push(prefix === undefined ? plain : `${plain}/${prefix}`);
    }
  }
  return result;
}

/** netmask(「24」か「255.255.255.0」)のプレフィックス長 */
function prefixLength(netmask: string | undefined): number | undefined {
  if (netmask === undefined) return undefined;
  if (/^\d+$/.test(netmask)) return Number(netmask);
  const parts = netmask.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return undefined;
  }
  const bits = parts.map((p) => p.toString(2).padStart(8, "0")).join("");
  if (!/^1*0*$/.test(bits)) return undefined;
  const zero = bits.indexOf("0");
  return zero === -1 ? 32 : zero;
}

/** 「virtio=BC:24:11:..,bridge=vmbr0,tag=10」のような設定の値を、キーと値に分ける */
function options(value: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (value ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0) result.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return result;
}

/**
 * ゲストの IF。net の tag → vlan、trunks → mode: trunk と vlans。
 * address(CT は net そのもの、VM は cloud-init の ipconfig)の ip・ip6 のうち、CIDR の形のものだけ ip に
 */
function guestInterface(net: Map<string, string>, address: Map<string, string>): InterfaceInfo {
  const info: InterfaceInfo = { extra: {} };
  const tag = integer(net.get("tag"));
  if (tag !== undefined && tag >= 1 && tag <= 4094) info.vlan = tag;
  const trunks = net.get("trunks");
  if (trunks !== undefined && trunks !== "") {
    info.mode = "trunk";
    info.vlans = trunks.split(";").join(",");
  }
  const ip = ["ip", "ip6"].flatMap((key) => {
    const value = address.get(key);
    return value !== undefined && value.includes("/") ? [value] : [];
  });
  if (ip.length > 0) info.ip = ip;
  return info;
}
