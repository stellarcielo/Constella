// 意味のチェック(SPEC 4.5)。パース時に分かる問題(重複・不正な値など)は parse.ts で出す。

import { isMap, isScalar, isSeq, type Node, type YAMLMap } from "yaml";
import { ifNameKey } from "./ifname";
import type { YamlBase } from "./parse";
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

/** 物理的に挿せる組み合わせを同じグループにする(SFP+ ポートに SFP を挿す等は警告しない) */
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
    for (const name of device.interfaces.keys()) {
      if (!portsOf(device).has(ifNameKey(name))) {
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
      if (!port && !isFlexibleDevice(device, catalog)) {
        add(
          "error",
          "unknown-interface",
          `${ep.device} のモデル「${device.model}」に IF「${ep.iface}」はありません`,
          target,
        );
      }
      types[end === "a" ? 0 : 1] = port?.type;

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
    if (ta && tb && PORT_FAMILY[ta] !== PORT_FAMILY[tb] && link.a && link.b) {
      add(
        "warning",
        "port-type-mismatch",
        `ポート種別が合いません: ${endpointToString(link.a)}(${ta})と ${endpointToString(link.b)}(${tb})`,
        { kind: "link", id: link.id },
      );
    }
  }

  for (const id of t.layout.keys()) {
    if (!t.devices.has(id)) {
      add("warning", "unknown-layout-device", `layout の「${id}」に対応するデバイスがありません`, {
        kind: "layout",
        id,
      });
    }
  }

  return issues;
}

/** 問題の対象を YAML 上の位置に変換する。GUI で追加したばかりの要素など、見つからなければ undefined */
export function locateTarget(base: YamlBase, target: IssueTarget): SourceRange | undefined {
  const { doc } = base;
  switch (target.kind) {
    case "document":
      return undefined;
    case "device":
      return rangeOf(findPair(doc.get("devices", true), (k) => k === target.id)?.key);
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
