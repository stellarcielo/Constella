// モデル(機種)定義ファイルの読み込みとカタログの組み立て(SPEC 5章)。

import { isMap, isScalar, isSeq, type Node, parseDocument, type YAMLMap } from "yaml";
import { ifNameKey, normalizeIfName } from "./ifname";
import { expandPortName } from "./portExpand";
import { yamlErrorMessage } from "./text";
import {
  type DeviceModel,
  type ModelCatalog,
  type ModelIssue,
  PORT_TYPES,
  type PortDef,
  type PortType,
  ROLES,
  type Role,
  type Severity,
} from "./types";

export type ModelParseResult =
  { ok: true; model: DeviceModel; issues: ModelIssue[] } | { ok: false; issues: ModelIssue[] };

const MODEL_KEYS = ["id", "vendor", "name", "role", "ports", "flexible", "icon"];
const PORT_KEYS = ["name", "type", "speed"];

/**
 * モデル定義の YAML を読む。エラーが 1 つでもあれば ok: false(カタログに入れない)。
 * ポート名は連番展開し、短い形に正規化する。
 */
export function parseModelDefinition(text: string): ModelParseResult {
  const issues: ModelIssue[] = [];
  const add = (severity: Severity, message: string, node: unknown) => {
    const range = (node as Node | null | undefined)?.range;
    issues.push(
      range
        ? { severity, message, range: { start: range[0], end: range[1] } }
        : { severity, message },
    );
  };

  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      issues.push({
        severity: "error",
        message: yamlErrorMessage(e.message),
        range: { start: e.pos[0], end: e.pos[1] },
      });
    }
    return { ok: false, issues };
  }
  const root = doc.contents;
  if (!isMap(root)) {
    add("error", "モデル定義の最上位はマップ(キー: 値 の形)である必要があります", root);
    return { ok: false, issues };
  }

  for (const pair of root.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : "";
    if (!MODEL_KEYS.includes(key)) {
      add("warning", `${key} は未知のキーです(使えるキー: ${MODEL_KEYS.join(", ")})`, pair.key);
    }
  }

  const id = optionalText(root, "id", add, true);
  const vendor = optionalText(root, "vendor", add);
  const name = optionalText(root, "name", add);
  const icon = optionalText(root, "icon", add);

  let role: Role | undefined;
  const roleNode = root.get("role", true) as Node | undefined;
  if (roleNode === undefined) {
    add("error", "role がありません", root);
  } else if (isScalar(roleNode) && (ROLES as readonly unknown[]).includes(roleNode.value)) {
    role = roleNode.value as Role;
  } else {
    add("error", `role の値が不正です(${ROLES.join(" / ")})`, roleNode);
  }

  let flexible = false;
  const flexibleNode = root.get("flexible", true) as Node | undefined;
  if (flexibleNode !== undefined) {
    if (isScalar(flexibleNode) && typeof flexibleNode.value === "boolean")
      flexible = flexibleNode.value;
    else add("error", "flexible は true か false で書いてください", flexibleNode);
  }

  const ports: PortDef[] = [];
  const portsNode = root.get("ports", true) as Node | undefined;
  if (portsNode === undefined) {
    if (!flexible) add("error", "ports がありません(flexible: true のときだけ省略できます)", root);
  } else if (!isSeq(portsNode)) {
    add("error", "ports は配列で書いてください", portsNode);
  } else {
    const seen = new Map<string, string>();
    for (const item of portsNode.items) {
      if (!isMap(item)) {
        add("error", "ポートは name と type を持つマップで書いてください", item);
        continue;
      }
      for (const pair of item.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : "";
        if (!PORT_KEYS.includes(key)) {
          add(
            "warning",
            `ports の ${key} は未知のキーです(使えるキー: ${PORT_KEYS.join(", ")})`,
            pair.key,
          );
        }
      }
      const pattern = optionalText(item, "name", add, true);
      const speed = optionalText(item, "speed", add);
      const typeNode = item.get("type", true) as Node | undefined;
      let type: PortType | undefined;
      if (typeNode === undefined) add("error", "ポートに type がありません", item);
      else if (isScalar(typeNode) && (PORT_TYPES as readonly unknown[]).includes(typeNode.value)) {
        type = typeNode.value as PortType;
      } else add("error", `ポートの type の値が不正です(${PORT_TYPES.join(" / ")})`, typeNode);
      if (pattern === undefined || type === undefined) continue;

      const expanded = expandPortName(pattern);
      if (!expanded.ok) {
        add("error", expanded.error, item.get("name", true));
        continue;
      }
      for (const raw of expanded.names) {
        const portName = normalizeIfName(raw);
        const first = seen.get(ifNameKey(portName));
        if (first !== undefined) {
          add("error", `ポート「${raw}」が「${first}」と重なっています`, item.get("name", true));
          continue;
        }
        seen.set(ifNameKey(portName), raw);
        ports.push(
          speed === undefined ? { name: portName, type } : { name: portName, type, speed },
        );
      }
    }
  }

  if (issues.some((i) => i.severity === "error") || id === undefined || role === undefined) {
    return { ok: false, issues };
  }
  const model: DeviceModel = { id, role, ports, flexible };
  if (vendor !== undefined) model.vendor = vendor;
  if (name !== undefined) model.name = name;
  if (icon !== undefined) model.icon = icon;
  return { ok: true, model, issues };
}

/** モデルを順に登録する。同じ id は後から渡したものが優先される(組み込み → ユーザーの順に渡す) */
export function buildCatalog(...sources: Iterable<DeviceModel>[]): ModelCatalog {
  const catalog = new Map<string, DeviceModel>();
  for (const models of sources) {
    for (const model of models) {
      catalog.delete(model.id);
      catalog.set(model.id, model);
    }
  }
  return catalog;
}

/** 文字列の項目。数値も文字列として受け付ける */
function optionalText(
  map: YAMLMap,
  key: string,
  add: (severity: Severity, message: string, node: unknown) => void,
  required = false,
): string | undefined {
  const node = map.get(key, true) as Node | undefined;
  if (node === undefined) {
    if (required) add("error", `${key} がありません`, map);
    return undefined;
  }
  if (isScalar(node) && (typeof node.value === "string" || typeof node.value === "number")) {
    const value = String(node.value);
    if (value !== "") return value;
  }
  add("error", `${key} の値が不正です(文字列)`, node);
  return undefined;
}
