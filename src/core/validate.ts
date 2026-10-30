// 意味のチェック(SPEC 4.5)。パース時に分かる問題(重複・不正な値など)は parse.ts で出す。

import { isMap, isScalar, isSeq, type Node, type YAMLMap } from "yaml";
import { findBridge, parseBridgeKey } from "./bridges";
import { hostTree } from "./hosts";
import { ifNameKey } from "./ifname";
import type { YamlBase } from "./parse";
import { portTypesCompatible } from "./ports";
import { endpointToString, findModel, isFlexibleDevice } from "./topology";
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

  // bond・ブリッジの members(SPEC 4.6): 無い IF と、2 つの bond・ブリッジに入っている IF
  for (const device of t.devices.values()) {
    const flexible = isFlexibleDevice(device, catalog);
    const names = new Set([...device.interfaces.keys()].map(ifNameKey));
    /** members の IF → それを members に書いた最初の IF */
    const owners = new Map<string, string>();
    for (const [name, info] of device.interfaces) {
      for (const member of new Set(info.members ?? [])) {
        const target: IssueTarget = { kind: "interface", device: device.id, name };
        const key = ifNameKey(member);
        if (!flexible && !portsOf(device).has(key) && !names.has(key)) {
          add(
            "error",
            "unknown-interface",
            `${device.id} の ${name} の members にある IF「${member}」はありません`,
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

  // ホストとゲスト(SPEC 4.6): 存在しないホスト、輪になる host、同じホストの中での VMID の重複
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
  for (const [host, guests] of tree.guestsOf) {
    const seen = new Map<number, string>();
    for (const id of guests) {
      const vmid = t.devices.get(id)?.vmid;
      if (vmid === undefined) continue;
      const first = seen.get(vmid);
      if (first === undefined) {
        seen.set(vmid, id);
      } else {
        add(
          "error",
          "duplicate-vmid",
          `${id} の VMID ${vmid} は ${first} と重なっています(どちらも ${host} の上で動いています)`,
          { kind: "device", id, field: "vmid" },
        );
      }
    }
  }

  /** ブリッジ(bridge)と相手(other)を結ぶリンクの問題。問題が無ければ undefined(SPEC 4.6) */
  const bridgeLinkProblem = (bridge: Endpoint, other: Endpoint): string | undefined => {
    if (!t.devices.has(other.device)) return undefined; // 存在しないデバイスは別のエラーで知らせる
    if (findBridge(t.devices.get(other.device), other.iface) !== undefined) {
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
      if (!port && !logical && !isFlexibleDevice(device, catalog)) {
        add(
          "error",
          "unknown-interface",
          `${ep.device} のモデル「${device.model}」に IF「${ep.iface}」はありません`,
          target,
        );
      }
      types[end === "a" ? 0 : 1] = port?.type;

      // ブリッジには何本でもつなげる(SPEC 4.3)。つなげるのは、そのホストの上で動くゲストの IF だけ
      if (findBridge(device, ep.iface) !== undefined) {
        const other = end === "a" ? link.b : link.a;
        const otherEnd = end === "a" ? "b" : "a";
        const reason = other && bridgeLinkProblem(ep, other);
        if (reason) add("error", "invalid-bridge-link", reason, { ...target, end: otherEnd });
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

  for (const id of t.layout.keys()) {
    const bridge = parseBridgeKey(id);
    if (bridge && findBridge(t.devices.get(bridge.host), bridge.bridge) === undefined) {
      add("warning", "unknown-layout-device", `layout の「${id}」に対応するブリッジがありません`, {
        kind: "layout",
        id,
      });
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

  return issues;
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
      return isSeq(seq) ? rangeOf(seq.items[target.index] as Node | undefined) : undefined;
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
