// 意味のチェック(SPEC 4.5)。パース時に分かる問題(重複・不正な値など)は parse.ts で出す。

import { isMap, isScalar, isSeq, type Node, type YAMLMap } from "yaml";
import { findBridge, findHostBridge, parseBridgeKey } from "./bridges";
import { clusterNetworks, clusterOfHosts, inClusterNetwork } from "./clusters";
import { hostTree } from "./hosts";
import { parseSubnet } from "./ip";
import { findLogicalIf, vlanInterface } from "./logicalIfs";
import { ifNameKey } from "./ifname";
import type { YamlBase } from "./parse";
import { portTypesCompatible } from "./ports";
import { findVnet, VNET_ID_MAX_LENGTH, zoneHosts, zoneOfVnet } from "./sdn";
import { endpointToString, findModel, isFlexibleDevice } from "./topology";
import { formatVlanIds, parseVlanList, type VlanBlock, vlanBlocks } from "./vlans";
import type {
  Device,
  Endpoint,
  Issue,
  IssueCode,
  IssueTarget,
  ModelCatalog,
  PortDef,
  PortType,
  Severity,
  SourceRange,
  Topology,
} from "./types";

/**
 * トポロジを検証する。base を渡すと、問題に YAML 上の位置を付ける。
 */
export function validateTopology(t: Topology, catalog: ModelCatalog, base?: YamlBase): Issue[] {
  const issues: Issue[] = [];
  const add = (severity: Severity, code: IssueCode, message: string, target: IssueTarget) => {
    const range = base && locateTarget(base, target);
    issues.push(
      range ? { severity, code, message, target, range } : { severity, code, message, target },
    );
  };

  const portCache = new Map<string, Map<string, PortDef>>();
  const portsOf = (device: Device): Map<string, PortDef> => {
    let ports = portCache.get(device.id);
    if (!ports) {
      ports = new Map((findModel(device, catalog)?.ports ?? []).map((p) => [ifNameKey(p.name), p]));
      portCache.set(device.id, ports);
    }
    return ports;
  };

  for (const device of t.devices.values()) {
    if (device.model !== undefined && !catalog.has(device.model)) {
      add("error", "unknown-model", `${device.id} のモデル「${device.model}」が見つかりません`, {
        kind: "device",
        id: device.id,
      });
    }
    if (isFlexibleDevice(device, catalog)) continue;
    for (const [name, info] of device.interfaces) {
      // 論理的な IF(bond・ブリッジ・VLAN インターフェース)は、モデルに無い名前でもよい(SPEC 4.3)
      if (info.type === undefined && !portsOf(device).has(ifNameKey(name))) {
        add(
          "error",
          "unknown-interface",
          `${device.id} のモデル「${device.model}」に IF「${name}」はありません`,
          {
            kind: "interface",
            device: device.id,
            name,
          },
        );
      }
    }
  }

  // bond・ブリッジの members と VLAN インターフェースの親(SPEC 4.6):
  // 無い IF、2 つの bond・ブリッジに入っている IF、bond に入れた物理的でない IF、ブリッジに入れたブリッジ
  for (const device of t.devices.values()) {
    const flexible = isFlexibleDevice(device, catalog);
    const names = new Set([...device.interfaces.keys()].map(ifNameKey));
    const exists = (name: string) =>
      flexible || portsOf(device).has(ifNameKey(name)) || names.has(ifNameKey(name));
    /** members の IF → それを members に書いた最初の IF */
    const owners = new Map<string, string>();
    for (const [name, info] of device.interfaces) {
      const target: IssueTarget = { kind: "interface", device: device.id, name };
      if (info.type === "vlan") {
        const { parent, vid } = vlanInterface(name, info);
        if (parent === undefined) {
          add(
            "error",
            "invalid-vlan-interface",
            `${device.id} の VLAN インターフェース ${name} の親の IF が分かりません(名前を「親.VLAN ID」の形にするか、vlan-raw-device を書いてください)`,
            target,
          );
        } else if (!exists(parent)) {
          add(
            "error",
            "unknown-interface",
            `${device.id} の VLAN インターフェース ${name} の親の IF「${parent}」はありません`,
            target,
          );
        }
        if (vid === undefined || vid < 1 || vid > 4094) {
          add(
            "error",
            "invalid-vlan-interface",
            vid === undefined
              ? `${device.id} の VLAN インターフェース ${name} の VLAN ID が分かりません(名前を「親.VLAN ID」か「vlan10」の形にするか、vlan を書いてください)`
              : `${device.id} の VLAN インターフェース ${name} の VLAN ID(${vid})は 1〜4094 の範囲にしてください`,
            target,
          );
        }
      }
      for (const member of new Set(info.members ?? [])) {
        const key = ifNameKey(member);
        if (!exists(member)) {
          add(
            "error",
            "unknown-interface",
            `${device.id} の ${name} の members にある IF「${member}」はありません`,
            target,
          );
        }
        // bond に束ねるのは物理的な IF だけ、ブリッジにつなぐのはブリッジ以外(SPEC 4.6)
        const memberType = findLogicalIf(device, member)?.info.type;
        if (info.type === "bond" && memberType !== undefined) {
          add(
            "error",
            "invalid-member",
            `${device.id} の bond ${name} の members に、物理的でない IF(${member})は入れられません`,
            target,
          );
        } else if (info.type === "bridge" && memberType === "bridge") {
          add(
            "error",
            "invalid-member",
            `${device.id} のブリッジ ${name} の members に、ブリッジ(${member})は入れられません`,
            target,
          );
        }
        const first = owners.get(key);
        if (first === undefined) {
          owners.set(key, name);
        } else if (first !== name) {
          add(
            "error",
            "member-in-use",
            `${device.id} の ${member} が、${first} と ${name} の両方の members に入っています`,
            target,
          );
        }
      }
    }
  }

  // ホストとゲスト(SPEC 4.6): 存在しないホスト、輪になる host、VMID の重複
  // (同じホストの中。ホストがクラスタに入っていれば、クラスタの中)
  for (const device of t.devices.values()) {
    if (device.host !== undefined && !t.devices.has(device.host)) {
      add(
        "error",
        "unknown-device",
        `${device.id} のホスト「${device.host}」に対応するデバイスがありません`,
        { kind: "device", id: device.id, field: "host" },
      );
    }
  }
  const tree = hostTree(t);
  for (const cycle of tree.cycles) {
    cycle.forEach((id, i) => {
      // そのデバイスから始めて、一周して戻るまでを書く
      const route = [...cycle.slice(i), ...cycle.slice(0, i), id].join(" → ");
      add(
        "error",
        "host-cycle",
        cycle.length === 1
          ? `${id} の host が自分自身になっています`
          : `host をたどると輪になります(${route})`,
        { kind: "device", id, field: "host" },
      );
    });
  }
  const clusterOf = clusterOfHosts(t);
  /** VMID を比べる範囲(クラスタかホスト)ごとの、VMID → 最初のゲスト */
  const vmids = new Map<string, Map<number, string>>();
  for (const device of t.devices.values()) {
    const host = tree.hostOf.get(device.id);
    if (host === undefined || device.vmid === undefined) continue;
    const cluster = clusterOf.get(host);
    const scope = cluster === undefined ? `host:${host}` : `cluster:${cluster}`;
    let seen = vmids.get(scope);
    if (!seen) {
      seen = new Map();
      vmids.set(scope, seen);
    }
    const first = seen.get(device.vmid);
    if (first === undefined) {
      seen.set(device.vmid, device.id);
      continue;
    }
    const firstHost = tree.hostOf.get(first);
    const reason =
      cluster === undefined || firstHost === host
        ? `どちらも ${host} の上で動いています`
        : `${firstHost} と ${host} は同じクラスタ「${t.groups[cluster].id}」に入っています`;
    add(
      "error",
      "duplicate-vmid",
      `${device.id} の VMID ${device.vmid} は ${first} と重なっています(${reason})`,
      { kind: "device", id: device.id, field: "vmid" },
    );
  }

  /** ゾーン ID → ゾーンのホスト(SDN。フェーズ4-6) */
  const zoneHostCache = new Map<string, string[]>();
  const hostsOfZone = (id: string): string[] => {
    let hosts = zoneHostCache.get(id);
    if (!hosts) {
      const zone = t.sdn.zones.get(id);
      hosts = zone ? zoneHosts(t, zone, catalog) : [];
      zoneHostCache.set(id, hosts);
    }
    return hosts;
  };
  /** ホストが VNet のゾーンに入っていなければ、そのゾーン ID(ゾーンが無ければ別のエラーで知らせる) */
  const zoneOutside = (host: string, vnet: string): string | undefined => {
    const zone = t.sdn.vnets.get(vnet)?.zone;
    if (zone === undefined || !t.sdn.zones.has(zone)) return undefined;
    return hostsOfZone(zone).includes(host) ? undefined : zone;
  };

  /** ブリッジ(bridge)と相手(other)を結ぶリンクの問題。問題が無ければ undefined(SPEC 4.6) */
  const bridgeLinkProblem = (bridge: Endpoint, other: Endpoint): string | undefined => {
    if (!t.devices.has(other.device)) return undefined; // 存在しないデバイスは別のエラーで知らせる
    if (findHostBridge(t, other.device, other.iface) !== undefined) {
      return `ブリッジどうしはつなげません(${endpointToString(bridge)} と ${endpointToString(other)})`;
    }
    const host = tree.hostOf.get(other.device);
    if (host === bridge.device) return undefined;
    return `${bridge.device} のブリッジ ${bridge.iface} につなげるのは、${bridge.device} の上で動くゲストだけです(${other.device} の host: ${host ?? "なし"})`;
  };

  /** キー = デバイスID + IF 名 → 最初に使ったリンクの相手側 */
  const used = new Map<string, Endpoint | undefined>();
  for (const link of t.links) {
    const types: (PortType | undefined)[] = [];
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (!ep) continue;
      const target: IssueTarget = { kind: "link", id: link.id, end };
      const device = t.devices.get(ep.device);
      if (!device) {
        add("error", "unknown-device", `デバイス「${ep.device}」は存在しません`, target);
        continue;
      }
      const port = portsOf(device).get(ifNameKey(ep.iface));
      const logical = [...device.interfaces].some(
        ([name, info]) => info.type !== undefined && ifNameKey(name) === ifNameKey(ep.iface),
      );
      const vnet = findVnet(t, device, ep.iface);
      if (!port && !logical && vnet === undefined && !isFlexibleDevice(device, catalog)) {
        add(
          "error",
          "unknown-interface",
          `${ep.device} のモデル「${device.model}」に IF「${ep.iface}」はありません`,
          target,
        );
      }
      types[end === "a" ? 0 : 1] = port?.type;

      // ブリッジ(VNet も)には何本でもつなげる(SPEC 4.3)。つなげるのは、そのホストの上で動くゲストの IF だけ
      if (findHostBridge(t, ep.device, ep.iface) !== undefined) {
        const other = end === "a" ? link.b : link.a;
        const otherEnd = end === "a" ? "b" : "a";
        const reason = other && bridgeLinkProblem(ep, other);
        if (reason) add("error", "invalid-bridge-link", reason, { ...target, end: otherEnd });
        // VNet を使えるのは、ゾーンのホストだけ(SPEC 4.6)
        const zone = vnet === undefined ? undefined : zoneOutside(ep.device, vnet);
        if (vnet !== undefined && zone !== undefined) {
          add(
            "error",
            "vnet-outside-zone",
            `${ep.device} はゾーン「${zone}」に入っていないので、VNet ${vnet} は使えません`,
            target,
          );
        }
        continue;
      }
      // bond・VLAN インターフェースには線をつながない(束ねた線は、メンバーの物理的な IF ごとに書く)
      const logicalType = findLogicalIf(device, ep.iface)?.info.type;
      if (logicalType === "bond" || logicalType === "vlan") {
        add(
          "error",
          "invalid-logical-link",
          logicalType === "bond"
            ? `${endpointToString(ep)} は bond なので、リンクはつなげません(束ねている物理的な IF につないでください)`
            : `${endpointToString(ep)} は VLAN インターフェースなので、リンクはつなげません`,
          target,
        );
        continue;
      }

      const key = `${ep.device}\u0000${ifNameKey(ep.iface)}`;
      if (used.has(key)) {
        const peer = used.get(key);
        const where = peer ? `(接続先: ${endpointToString(peer)})` : "";
        add(
          "error",
          "port-in-use",
          `${endpointToString(ep)} はすでに別のリンクで使われています${where}`,
          target,
        );
      } else {
        used.set(key, end === "a" ? link.b : link.a);
      }
    }

    if (link.a && link.b && link.a.device === link.b.device) {
      add("warning", "self-loop", `${link.a.device} が自分自身に接続されています`, {
        kind: "link",
        id: link.id,
      });
    }
    const [ta, tb] = types;
    if (ta && tb && !portTypesCompatible(ta, tb) && link.a && link.b) {
      add(
        "warning",
        "port-type-mismatch",
        `ポート種別が合いません: ${endpointToString(link.a)}(${ta})と ${endpointToString(link.b)}(${tb})`,
        { kind: "link", id: link.id },
      );
    }
  }

  // VLAN の通り道(SPEC 4.6・フェーズ4-4)。読めない vlans は警告にし、その場所は確かめない
  for (const device of t.devices.values()) {
    for (const [name, info] of device.interfaces) {
      if (info.vlans !== undefined && parseVlanList(info.vlans) === undefined) {
        add(
          "warning",
          "invalid-vlan-list",
          `${device.id} の ${name} の vlans「${info.vlans}」の書き方が分かりません(例: 10,20,100-110)`,
          { kind: "interface", device: device.id, name },
        );
      }
    }
  }
  for (const block of vlanBlocks(t, catalog)) {
    add("warning", "vlan-not-allowed", vlanBlockMessage(block), {
      kind: "interface",
      device: block.at.device,
      name: block.at.iface,
    });
  }

  for (const id of t.layout.keys()) {
    const bridge = parseBridgeKey(id);
    const vnet = bridge && findVnet(t, t.devices.get(bridge.host), bridge.bridge);
    const zone = bridge && vnet !== undefined ? zoneOutside(bridge.host, vnet) : undefined;
    if (bridge && findHostBridge(t, bridge.host, bridge.bridge) === undefined) {
      add("warning", "unknown-layout-device", `layout の「${id}」に対応するブリッジがありません`, {
        kind: "layout",
        id,
      });
    } else if (bridge && zone !== undefined) {
      add(
        "warning",
        "vnet-outside-zone",
        `${bridge.host} はゾーン「${zone}」に入っていないので、VNet ${vnet ?? ""} の箱は置けません(layout の「${id}」)`,
        { kind: "layout", id },
      );
    } else if (!bridge && !t.devices.has(id)) {
      add("warning", "unknown-layout-device", `layout の「${id}」に対応するデバイスがありません`, {
        kind: "layout",
        id,
      });
    }
  }

  // グループ(フェーズ3-1 Q6): 存在しないメンバー(SPEC 4.5 の「存在しないデバイスへの参照」)と id の重複
  const groupIds = new Set<string>();
  t.groups.forEach((group, index) => {
    const target: IssueTarget = { kind: "group", index };
    if (group.id !== "") {
      if (groupIds.has(group.id)) {
        add("error", "duplicate-group-id", `グループ id「${group.id}」が重複しています`, target);
      }
      groupIds.add(group.id);
    }
    for (const member of new Set(group.members)) {
      if (!t.devices.has(member)) {
        add(
          "error",
          "unknown-device",
          `グループ「${group.id}」のメンバー「${member}」に対応するデバイスがありません`,
          target,
        );
      }
    }
  });

  // クラスタ(SPEC 4.6・フェーズ4-5): 2 つ以上のクラスタに入るホスト、networks の書き方、
  // networks のサブネットに入る IP の無いホスト(ホストごとに 1 件)
  t.groups.forEach((group, index) => {
    const target: IssueTarget = { kind: "group", index };
    if (group.kind !== "cluster") {
      if (group.networks) {
        add(
          "warning",
          "networks-not-cluster",
          `グループ「${group.id}」は kind: cluster ではないので、networks を使いません`,
          { ...target, field: "networks" },
        );
      }
      return;
    }
    for (const member of new Set(group.members)) {
      const first = clusterOf.get(member);
      if (first !== undefined && first !== index) {
        add(
          "error",
          "multiple-clusters",
          `${member} は、クラスタ「${t.groups[first].id}」と「${group.id}」の両方に入っています(入れるクラスタは 1 つだけです)`,
          target,
        );
      }
    }
    for (const [name, text] of group.networks ?? []) {
      if (parseSubnet(text) === undefined) {
        add(
          "warning",
          "invalid-subnet",
          `クラスタ「${group.id}」のネットワーク ${name} のサブネット「${text}」の書き方が分かりません(例: 10.10.0.0/24)`,
          { ...target, network: name },
        );
      }
    }
    const networks = clusterNetworks(group);
    for (const member of new Set(group.members)) {
      const device = t.devices.get(member);
      // 図に無いホストと、ほかのクラスタで数えるホストは確かめない
      if (!device || clusterOf.get(member) !== index) continue;
      const ips = [...device.interfaces.values()].flatMap((info) => info.ip ?? []);
      const missing = networks.filter(
        (network) => !ips.some((ip) => inClusterNetwork(network, ip)),
      );
      if (missing.length === 0) continue;
      const list = missing.map((network) => `${network.name}(${network.text})`).join("・");
      add(
        "warning",
        "missing-cluster-network",
        `${member} に、クラスタ「${group.id}」のネットワーク ${list}に入る IP がありません`,
        { kind: "device", id: member },
      );
    }
  });

  // SDN(SPEC 4.6・フェーズ4-6): ゾーンの nodes・bridge・tag
  for (const [id, zone] of t.sdn.zones) {
    const target: IssueTarget = { kind: "sdn", section: "zones", id };
    for (const node of new Set(zone.nodes ?? [])) {
      if (!t.devices.has(node)) {
        add(
          "error",
          "unknown-device",
          `ゾーン「${id}」の nodes の「${node}」に対応するデバイスがありません`,
          { ...target, field: "nodes" },
        );
      }
    }
    if (zone.type === "vlan" || zone.type === "qinq") {
      if (zone.bridge !== undefined) {
        for (const host of hostsOfZone(id)) {
          if (findBridge(t.devices.get(host), zone.bridge) === undefined) {
            add(
              "error",
              "missing-zone-bridge",
              `${host} に、ゾーン「${id}」のブリッジ ${zone.bridge} がありません`,
              { kind: "device", id: host },
            );
          }
        }
      } else if (!("bridge" in zone.extra)) {
        add(
          "error",
          "missing-field",
          `ゾーン「${id}」(${zone.type})に bridge がありません`,
          target,
        );
      }
    }
    if (zone.type === "qinq" && zone.tag === undefined && !("tag" in zone.extra)) {
      add(
        "error",
        "missing-field",
        `ゾーン「${id}」(qinq)に tag(外側の VLAN ID)がありません`,
        target,
      );
    }
  }
  // VNet の ID・subnets・zone・tag
  for (const [id, vnet] of t.sdn.vnets) {
    const target: IssueTarget = { kind: "sdn", section: "vnets", id };
    if (id.length > VNET_ID_MAX_LENGTH) {
      add(
        "warning",
        "long-vnet-id",
        `VNet ID「${id}」が ${VNET_ID_MAX_LENGTH} 文字より長くなっています(Proxmox VE では ${VNET_ID_MAX_LENGTH} 文字まで)`,
        target,
      );
    }
    for (const subnet of vnet.subnets ?? []) {
      if (parseSubnet(subnet) === undefined) {
        add(
          "warning",
          "invalid-subnet",
          `VNet「${id}」の subnets の「${subnet}」の書き方が分かりません(例: 10.40.0.0/24)`,
          { ...target, field: "subnets" },
        );
      }
    }
    if (vnet.zone === undefined) continue; // 無ければパースで知らせる
    const zone = zoneOfVnet(t, id);
    if (!zone) {
      add("error", "unknown-sdn-zone", `VNet「${id}」のゾーン「${vnet.zone}」がありません`, {
        ...target,
        field: "zone",
      });
      continue;
    }
    if (zone.type !== undefined && zone.type !== "simple") {
      if (vnet.tag === undefined) {
        if (!("tag" in vnet.extra)) {
          add(
            "error",
            "missing-field",
            `VNet「${id}」に tag がありません(ゾーン「${vnet.zone}」は ${zone.type})`,
            target,
          );
        }
      } else if ((zone.type === "vlan" || zone.type === "qinq") && vnet.tag > 4094) {
        add(
          "error",
          "invalid-vnet-tag",
          `VNet「${id}」の tag(${vnet.tag})は 1〜4094 の範囲にしてください(ゾーン「${vnet.zone}」は ${zone.type})`,
          { ...target, field: "tag" },
        );
      }
    }
    // ゾーンのホストに、VNet ID と同じ名前の IF があると、どちらにつなぐのか分からない
    const key = ifNameKey(id);
    for (const host of hostsOfZone(vnet.zone)) {
      const device = t.devices.get(host);
      if (!device) continue;
      const names = [...device.interfaces.keys()];
      if (portsOf(device).has(key) || names.some((name) => ifNameKey(name) === key)) {
        add(
          "error",
          "vnet-name-conflict",
          `VNet「${id}」は、${host} の IF と同じ名前です(VNet ID か IF 名を変えてください)`,
          target,
        );
      }
    }
  }

  return issues;
}

/**
 * VLAN が止まる場所の警告の文(SPEC 4.6)。止まる VLAN が 2 つ以上なら、使っている IF ごとの VLAN も書く
 */
function vlanBlockMessage(block: VlanBlock): string {
  const vlans = formatVlanIds(block.vlans);
  const each = block.vlans.length > 1;
  const uses = block.uses
    .map((use) => {
      const source = endpointToString(use.source);
      return each ? `${source}(VLAN ${formatVlanIds(use.vlans)})` : source;
    })
    .join("・");
  const at = endpointToString(block.at);
  switch (block.kind) {
    case "bridge":
      return `ブリッジ ${at} の通す VLAN(${block.allowed ?? ""})に VLAN ${vlans} が入っていません(使っている IF: ${uses})`;
    case "trunk":
      return `${at}(trunk ${block.allowed ?? ""})を VLAN ${vlans} が通りません(使っている IF: ${uses})`;
    case "access":
      return `${at} は access なので、タグの付いた VLAN ${vlans} は通りません(使っている IF: ${uses})`;
  }
}

/** 問題の対象を YAML 上の位置に変換する。GUI で追加したばかりの要素など、見つからなければ undefined */
export function locateTarget(base: YamlBase, target: IssueTarget): SourceRange | undefined {
  const { doc } = base;
  switch (target.kind) {
    case "document":
      return undefined;
    case "device": {
      const pair = findPair(doc.get("devices", true), (k) => k === target.id);
      const value = pair?.value;
      // 項目の指定があれば、その値の位置(無ければデバイスID の位置)
      const field =
        target.field !== undefined && isMap(value) ? value.get(target.field, true) : undefined;
      return rangeOf(field ?? pair?.key);
    }
    case "interface": {
      const device = findPair(doc.get("devices", true), (k) => k === target.device)?.value;
      const ifs = isMap(device) ? device.get("interfaces", true) : undefined;
      const key = ifNameKey(target.name);
      return rangeOf(findPair(ifs, (k) => ifNameKey(k) === key)?.key);
    }
    case "link": {
      const node = base.linkNodes.get(target.id);
      if (!node) return undefined;
      return rangeOf(target.end ? (node.get(target.end, true) as Node | undefined) : node);
    }
    case "layout":
      return rangeOf(findPair(doc.get("layout", true), (k) => k === target.id)?.key);
    case "group": {
      const seq = doc.get("groups", true);
      const item = isSeq(seq) ? (seq.items[target.index] as Node | undefined) : undefined;
      if (target.network !== undefined && isMap(item)) {
        const pair = findPair(item.get("networks", true), (k) => k === target.network);
        if (pair) return rangeOf(pair.key);
      }
      // 項目の指定があれば、その値の位置(無ければグループ全体)
      const field =
        target.field !== undefined && isMap(item) ? item.get(target.field, true) : undefined;
      return rangeOf(field ?? item);
    }
    case "sdn": {
      const sdn = doc.get("sdn", true);
      const section = isMap(sdn) ? sdn.get(target.section, true) : undefined;
      const pair = findPair(section, (k) => k === target.id);
      // 項目の指定があれば、その値の位置(無ければゾーン・VNet の ID の位置)
      const value = pair?.value;
      const field =
        target.field !== undefined && isMap(value) ? value.get(target.field, true) : undefined;
      return rangeOf(field ?? pair?.key);
    }
  }
}

function findPair(
  map: unknown,
  match: (key: string) => boolean,
): { key: unknown; value: unknown } | undefined {
  if (!isMap(map)) return undefined;
  return (map as YAMLMap).items.find((p) => isScalar(p.key) && match(scalarText(p.key)));
}

function scalarText(node: unknown): string {
  if (!isScalar(node)) return "";
  return typeof node.value === "string" ? node.value : (node.source ?? String(node.value));
}

function rangeOf(node: unknown): SourceRange | undefined {
  const range = (node as Node | undefined)?.range;
  return range ? { start: range[0], end: range[1] } : undefined;
}
