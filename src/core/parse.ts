// YAML 文字列 → トポロジ(SPEC 4章)。
// 構文エラーと形式バージョンの不正は「パースエラー」として ok: false を返す。
// それ以外の問題は「意味のエラー・警告」として issues に積み、読める部分はトポロジに反映する。

import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  parseDocument,
  type YAMLMap,
} from "yaml";
import { bridgeKey, parseBridgeKey } from "./bridges";
import { ifNameKey, normalizeIfName } from "./ifname";
import { yamlErrorMessage } from "./text";
import { createLinkId, createUid, DEVICE_ID_PATTERN, parseEndpoint } from "./topology";
import {
  type Device,
  type Endpoint,
  type Extra,
  FORMAT_VERSION,
  GROUP_KINDS,
  type Group,
  BOND_MODES,
  GUEST_KINDS,
  INTERFACE_MODES,
  type InterfaceInfo,
  type Issue,
  type IssueCode,
  type IssueTarget,
  type Link,
  LOGICAL_IF_TYPES,
  MEDIA,
  type Meta,
  type ModelCatalog,
  ROLES,
  type Severity,
  type SourceRange,
  type Topology,
  VMID_MAX,
  VMID_MIN,
} from "./types";

/** 保存時にコメントやキー順を保つために、読み込んだ YAML ドキュメントを持ち回る */
export interface YamlBase {
  doc: Document;
  /** この doc から作った(または最後に書き出した)トポロジの複製。削除の検出に使う */
  topology: Topology;
  /** リンクID → YAML 上のリンクのノード */
  linkNodes: Map<string, YAMLMap>;
}

export type ParseResult =
  | { ok: true; topology: Topology; issues: Issue[]; base: YamlBase }
  | { ok: false; issues: Issue[] };

export interface ParseOptions {
  /** 渡すと、モデルのあるデバイスの IF 名をモデル側の表記にそろえる */
  catalog?: ModelCatalog;
}

const TOP_LEVEL_KEYS = ["constella", "meta", "devices", "links", "layout", "groups"];
const DEVICE_KEYS = ["model", "role", "label", "host", "guest", "vmid", "interfaces"];
const INTERFACE_KEYS = [
  "description",
  "ip",
  "mode",
  "vlan",
  "vlans",
  "type",
  "members",
  "bond-mode",
  "vlan-aware",
  "vlan-raw-device",
];

export function parseTopology(text: string, options: ParseOptions = {}): ParseResult {
  const doc = parseDocument(text, { uniqueKeys: false });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((e) => ({
        severity: "error",
        code: "yaml-syntax",
        message: yamlErrorMessage(e.message),
        target: { kind: "document" },
        range: { start: e.pos[0], end: e.pos[1] },
      })),
    };
  }

  const root = doc.contents;
  if (!isMap(root)) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "invalid-root",
          message: "トポロジ YAML の最上位はマップ(キー: 値 の形)である必要があります",
          target: { kind: "document" },
          range: rangeOf(root),
        },
      ],
    };
  }

  const version = root.get("constella", true);
  if (version === undefined) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "missing-version",
          message: `先頭に形式バージョン \`constella: ${FORMAT_VERSION}\` が必要です`,
          target: { kind: "document" },
          range: { start: 0, end: 0 },
        },
      ],
    };
  }
  if (!isScalar(version) || (version.value as unknown) !== FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "unsupported-version",
          message: `未対応の形式バージョンです(対応しているのは ${FORMAT_VERSION})`,
          target: { kind: "document" },
          range: rangeOf(version),
        },
      ],
    };
  }

  const p = new Parser(text);
  const topology = p.topology(root);
  if (options.catalog) canonicalizeIfNames(topology, options.catalog);
  // base 側は呼び出し元が編集しても変わらないよう複製して持つ
  const base = { doc, topology: structuredClone(topology), linkNodes: p.linkNodes };
  return { ok: true, topology, issues: p.issues, base };
}

// ---------------------------------------------------------------------------

type Ctx = { target: IssueTarget; path: string };

class Parser {
  readonly issues: Issue[] = [];
  readonly linkNodes = new Map<string, YAMLMap>();
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  topology(root: YAMLMap): Topology {
    const doc: Ctx = { target: { kind: "document" }, path: "" };
    const extra: Extra = {};
    const t: Topology = {
      meta: { extra: {} },
      devices: new Map(),
      links: [],
      layout: new Map(),
      groups: [],
      extra,
    };
    for (const [key, value, keyNode] of this.entries(root, doc)) {
      switch (key) {
        case "constella":
          break;
        case "meta":
          t.meta = this.meta(value, doc);
          break;
        case "devices":
          t.devices = this.devices(value);
          break;
        case "links":
          t.links = this.links(value);
          break;
        case "layout":
          this.layout(value, t);
          break;
        case "groups":
          t.groups = this.groups(value);
          break;
        default:
          this.unknownKey(key, keyNode, doc, TOP_LEVEL_KEYS);
          extra[key] = toJS(value);
      }
    }
    return t;
  }

  private meta(node: Node | null, parent: Ctx): Meta {
    const meta: Meta = { extra: {} };
    const ctx: Ctx = { target: parent.target, path: "meta" };
    if (!this.mapOrNull(node, ctx)) return meta;
    for (const [key, value, keyNode] of this.entries(node, ctx)) {
      switch (key) {
        case "title":
        case "description":
          this.setText(meta, key, value, ctx);
          break;
        default:
          this.unknownKey(key, keyNode, ctx, ["title", "description"]);
          meta.extra[key] = toJS(value);
      }
    }
    return meta;
  }

  private devices(node: Node | null): Map<string, Device> {
    const devices = new Map<string, Device>();
    const ctx: Ctx = { target: { kind: "document" }, path: "devices" };
    if (!this.mapOrNull(node, ctx)) return devices;
    for (const pair of node.items) {
      const keyNode = pair.key as Node | null;
      const id = this.keyText(keyNode);
      const target: IssueTarget = { kind: "device", id };
      if (devices.has(id)) {
        this.add(
          "error",
          "duplicate-device-id",
          `デバイスID「${id}」が重複しています`,
          target,
          keyNode,
        );
        continue;
      }
      if (!DEVICE_ID_PATTERN.test(id)) {
        this.add(
          "error",
          "invalid-device-id",
          `デバイスID「${id}」は使えません(英数字で始まり、英数字と . _ - だけを使えます)`,
          target,
          keyNode,
        );
      }
      devices.set(
        id,
        this.device(id, pair.value as Node | null, { target, path: `devices.${id}` }),
      );
    }
    return devices;
  }

  private device(id: string, node: Node | null, ctx: Ctx): Device {
    const device: Device = { id, uid: createUid(), interfaces: new Map(), extra: {} };
    if (!this.mapOrNull(node, ctx)) return device;
    for (const [key, value, keyNode] of this.entries(node, ctx)) {
      switch (key) {
        case "model":
          if (isNonEmptyString(value)) device.model = value.value;
          else this.invalid(device.extra, key, value, ctx, "モデルIDの文字列");
          break;
        case "role": {
          const role = enumValue(value, ROLES);
          if (role) device.role = role;
          else this.invalid(device.extra, key, value, ctx, ROLES.join(" / "));
          break;
        }
        case "label":
          this.setText(device, key, value, ctx);
          break;
        case "host":
          if (isNonEmptyString(value)) device.host = value.value;
          else this.invalid(device.extra, key, value, ctx, "ホストのデバイスID");
          break;
        case "guest": {
          const guest = enumValue(value, GUEST_KINDS);
          if (guest) device.guest = guest;
          else this.invalid(device.extra, key, value, ctx, GUEST_KINDS.join(" / "));
          break;
        }
        case "vmid":
          if (isScalar(value) && Number.isInteger(value.value)) {
            const vmid = value.value as number;
            if (vmid >= VMID_MIN && vmid <= VMID_MAX) {
              device.vmid = vmid;
              break;
            }
          }
          this.invalid(device.extra, key, value, ctx, `${VMID_MIN}〜${VMID_MAX} の整数`);
          break;
        case "interfaces":
          device.interfaces = this.interfaces(id, value, ctx);
          break;
        default:
          this.unknownKey(key, keyNode, ctx, DEVICE_KEYS);
          device.extra[key] = toJS(value);
      }
    }
    return device;
  }

  private interfaces(deviceId: string, node: Node | null, parent: Ctx): Map<string, InterfaceInfo> {
    const result = new Map<string, InterfaceInfo>();
    const ctx: Ctx = { target: parent.target, path: `${parent.path}.interfaces` };
    if (!this.mapOrNull(node, ctx)) return result;
    const seen = new Map<string, string>();
    for (const pair of node.items) {
      const keyNode = pair.key as Node | null;
      const raw = this.keyText(keyNode);
      // 論理的な IF(type を書いたもの)の名前は Linux の名前なので、書いたとおりに保つ
      // (Linux の VLAN インターフェース vlan10 を、Cisco の略称の Vl10 にしない。SPEC 4.4)
      const logical = isMap(pair.value) && pair.value.has("type");
      const name = logical ? raw.trim() : normalizeIfName(raw);
      const target: IssueTarget = { kind: "interface", device: deviceId, name };
      const first = seen.get(ifNameKey(name));
      if (first !== undefined) {
        this.add(
          "error",
          "duplicate-interface",
          `${deviceId} の IF「${raw}」は「${first}」と同じ IF です。どちらか一方にまとめてください`,
          target,
          keyNode,
        );
        continue;
      }
      seen.set(ifNameKey(name), raw);
      result.set(
        name,
        this.interfaceInfo(pair.value as Node | null, { target, path: `${ctx.path}.${raw}` }),
      );
    }
    return result;
  }

  private interfaceInfo(node: Node | null, ctx: Ctx): InterfaceInfo {
    const info: InterfaceInfo = { extra: {} };
    if (!this.mapOrNull(node, ctx)) return info;
    for (const [key, value, keyNode] of this.entries(node, ctx)) {
      switch (key) {
        case "description":
          this.setText(info, key, value, ctx);
          break;
        case "ip":
          if (isSeq(value) && value.items.every((i) => isNonEmptyString(i as Node))) {
            info.ip = value.items.map((i) => String((i as { value: unknown }).value));
          } else {
            this.invalid(info.extra, key, value, ctx, "IP アドレス文字列の配列");
          }
          break;
        case "mode": {
          const mode = enumValue(value, INTERFACE_MODES);
          if (mode) info.mode = mode;
          else this.invalid(info.extra, key, value, ctx, INTERFACE_MODES.join(" / "));
          break;
        }
        case "vlan":
          if (isScalar(value) && Number.isInteger(value.value)) {
            const vlan = value.value as number;
            if (vlan >= 1 && vlan <= 4094) {
              info.vlan = vlan;
              break;
            }
          }
          this.invalid(info.extra, key, value, ctx, "1〜4094 の整数");
          break;
        case "vlans":
          this.setText(info, key, value, ctx);
          break;
        case "type": {
          const type = enumValue(value, LOGICAL_IF_TYPES);
          if (type) info.type = type;
          else this.invalid(info.extra, key, value, ctx, LOGICAL_IF_TYPES.join(" / "));
          break;
        }
        case "members":
          if (isSeq(value) && value.items.every((i) => isNonEmptyString(i as Node))) {
            info.members = value.items.map((i) =>
              normalizeIfName(String((i as { value: unknown }).value)),
            );
          } else {
            this.invalid(info.extra, key, value, ctx, "IF 名の配列");
          }
          break;
        case "bond-mode": {
          const mode = enumValue(value, BOND_MODES);
          if (mode) info.bondMode = mode;
          else this.invalid(info.extra, key, value, ctx, BOND_MODES.join(" / "));
          break;
        }
        case "vlan-aware":
          if (isScalar(value) && typeof value.value === "boolean") info.vlanAware = value.value;
          else this.invalid(info.extra, key, value, ctx, "true か false");
          break;
        case "vlan-raw-device":
          if (isNonEmptyString(value)) info.vlanRawDevice = normalizeIfName(value.value);
          else this.invalid(info.extra, key, value, ctx, "IF 名");
          break;
        default:
          this.unknownKey(key, keyNode, ctx, INTERFACE_KEYS);
          info.extra[key] = toJS(value);
      }
    }
    return info;
  }

  private links(node: Node | null): Link[] {
    const links: Link[] = [];
    const ctx: Ctx = { target: { kind: "document" }, path: "links" };
    if (node === null || isEmptyScalar(node)) return links;
    if (!isSeq(node)) {
      this.add("error", "invalid-type", "links は配列で書いてください", ctx.target, node);
      return links;
    }
    for (const item of node.items) {
      const id = createLinkId();
      const linkCtx: Ctx = { target: { kind: "link", id }, path: "links[]" };
      if (!isMap(item)) {
        this.add(
          "error",
          "invalid-type",
          "リンクは a と b を持つマップで書いてください",
          linkCtx.target,
          item as Node,
        );
        continue;
      }
      const link: Link = { id, extra: {} };
      for (const [key, value, keyNode] of this.entries(item, linkCtx)) {
        switch (key) {
          case "a":
          case "b": {
            const ep = this.endpoint(value, { target: { kind: "link", id, end: key }, path: key });
            if (ep) link[key] = ep;
            else link.extra[key] = toJS(value);
            break;
          }
          case "media": {
            const media = enumValue(value, MEDIA);
            if (media) link.media = media;
            else this.invalid(link.extra, key, value, linkCtx, MEDIA.join(" / "));
            break;
          }
          case "label":
            this.setText(link, key, value, linkCtx);
            break;
          default:
            this.unknownKey(key, keyNode, linkCtx, ["a", "b", "media", "label"]);
            link.extra[key] = toJS(value);
        }
      }
      for (const end of ["a", "b"] as const) {
        if (!item.has(end)) {
          this.add("error", "missing-field", `リンクに ${end} がありません`, linkCtx.target, item);
        }
      }
      links.push(link);
      this.linkNodes.set(id, item);
    }
    return links;
  }

  private endpoint(node: Node | null, ctx: Ctx): Endpoint | undefined {
    const ep =
      isScalar(node) && typeof node.value === "string" ? parseEndpoint(node.value) : undefined;
    if (!ep) {
      this.add(
        "error",
        "invalid-endpoint",
        "エンドポイントは「デバイスID:IF名」の形で書いてください",
        ctx.target,
        node,
      );
      return undefined;
    }
    return { device: ep.device, iface: normalizeIfName(ep.iface) };
  }

  private layout(node: Node | null, t: Topology): void {
    const ctx: Ctx = { target: { kind: "document" }, path: "layout" };
    if (!this.mapOrNull(node, ctx)) return;
    for (const [key, value] of this.entries(node, ctx)) {
      if (key === "_viewport") {
        const v = this.numbers(value, ["x", "y", "zoom"], {
          target: ctx.target,
          path: "layout._viewport",
        });
        if (v) t.viewport = { x: v.x, y: v.y, zoom: v.zoom };
        continue;
      }
      const pos = this.numbers(value, ["x", "y"], {
        target: { kind: "layout", id: key },
        path: `layout.${key}`,
      });
      if (pos) t.layout.set(key, { x: pos.x, y: pos.y });
    }
  }

  private numbers<K extends string>(
    node: Node | null,
    keys: K[],
    ctx: Ctx,
  ): Record<K, number> | undefined {
    const bad = () => {
      this.add(
        "error",
        "invalid-value",
        `${ctx.path} は { ${keys.map((k) => `${k}: 数値`).join(", ")} } で書いてください`,
        ctx.target,
        node,
      );
      return undefined;
    };
    if (!isMap(node)) return bad();
    const result: Partial<Record<K, number>> = {};
    for (const [key, value, keyNode] of this.entries(node, ctx)) {
      if ((keys as string[]).includes(key)) {
        if (!isScalar(value) || typeof value.value !== "number" || !Number.isFinite(value.value))
          return bad();
        result[key as K] = value.value;
      } else {
        this.unknownKey(key, keyNode, ctx, keys);
      }
    }
    if (!keys.every((k) => result[k] !== undefined)) return bad();
    return result as Record<K, number>;
  }

  private groups(node: Node | null): Group[] {
    const groups: Group[] = [];
    if (node === null || isEmptyScalar(node)) return groups;
    if (!isSeq(node)) {
      this.add(
        "error",
        "invalid-type",
        "groups は配列で書いてください",
        { kind: "document" },
        node,
      );
      return groups;
    }
    node.items.forEach((item, index) => {
      const ctx: Ctx = { target: { kind: "group", index }, path: `groups[${index}]` };
      if (!isMap(item)) {
        this.add(
          "error",
          "invalid-type",
          "グループはマップで書いてください",
          ctx.target,
          item as Node,
        );
        return;
      }
      const group: Group = { id: "", members: [], extra: {} };
      for (const [key, value, keyNode] of this.entries(item, ctx)) {
        switch (key) {
          case "id":
            if (isNonEmptyString(value)) group.id = value.value;
            else this.invalid(group.extra, key, value, ctx, "文字列");
            break;
          case "kind": {
            const kind = enumValue(value, GROUP_KINDS);
            if (kind) group.kind = kind;
            else this.invalid(group.extra, key, value, ctx, GROUP_KINDS.join(" / "));
            break;
          }
          case "label":
            this.setText(group, key, value, ctx);
            break;
          case "members":
            if (isSeq(value) && value.items.every((i) => isNonEmptyString(i as Node))) {
              group.members = value.items.map((i) => String((i as { value: unknown }).value));
            } else {
              this.invalid(group.extra, key, value, ctx, "デバイスIDの配列");
            }
            break;
          default:
            this.unknownKey(key, keyNode, ctx, ["id", "kind", "label", "members"]);
            group.extra[key] = toJS(value);
        }
      }
      if (group.id === "" && !("id" in group.extra)) {
        this.add("error", "missing-field", "グループに id がありません", ctx.target, item);
      }
      groups.push(group);
    });
    return groups;
  }

  // --- 共通処理 -------------------------------------------------------------

  /** マップのキーと値を順に返す。重複したキーはエラーにして 2 つ目以降を飛ばす */
  private *entries(map: YAMLMap, ctx: Ctx): Generator<[string, Node | null, Node | null]> {
    const seen = new Set<string>();
    for (const pair of map.items) {
      const keyNode = pair.key as Node | null;
      const key = this.keyText(keyNode);
      if (seen.has(key)) {
        this.add(
          "error",
          "duplicate-key",
          `${joinPath(ctx.path, key)} が重複しています`,
          ctx.target,
          keyNode,
        );
        continue;
      }
      seen.add(key);
      yield [key, pair.value as Node | null, keyNode];
    }
  }

  /** キーの文字列。`01` のような数値に見えるキーも書かれたとおりに扱う */
  private keyText(node: Node | null): string {
    if (isScalar(node)) {
      if (typeof node.value === "string") return node.value;
      if (node.range) return this.text.slice(node.range[0], node.range[1]);
      return String(node.value);
    }
    return node && node.range ? this.text.slice(node.range[0], node.range[1]) : "";
  }

  /** マップなら true、null(空)なら false、それ以外はエラーを出して false */
  private mapOrNull(node: Node | null, ctx: Ctx): node is YAMLMap {
    if (isMap(node)) return true;
    if (node !== null && !isEmptyScalar(node)) {
      this.add(
        "error",
        "invalid-type",
        `${ctx.path} はマップ(キー: 値 の形)で書いてください`,
        ctx.target,
        node,
      );
    }
    return false;
  }

  /** 文字列の項目。数値や真偽値も文字列として受け付ける */
  private setText<K extends string>(
    obj: { [P in K]?: string } & { extra: Extra },
    key: K,
    node: Node | null,
    ctx: Ctx,
  ): void {
    if (isScalar(node) && ["string", "number", "boolean"].includes(typeof node.value)) {
      obj[key] = String(node.value) as (typeof obj)[K];
    } else {
      this.invalid(obj.extra, key, node, ctx, "文字列");
    }
  }

  /** 不正な値はエラーにし、元の値を extra に残す */
  private invalid(extra: Extra, key: string, node: Node | null, ctx: Ctx, expected: string): void {
    this.add(
      "error",
      "invalid-value",
      `${joinPath(ctx.path, key)} の値が不正です(${expected})`,
      ctx.target,
      node,
    );
    extra[key] = toJS(node);
  }

  private unknownKey(key: string, keyNode: Node | null, ctx: Ctx, known: readonly string[]): void {
    this.add(
      "warning",
      "unknown-key",
      `${joinPath(ctx.path, key)} は未知のキーです(使えるキー: ${known.join(", ")})`,
      ctx.target,
      keyNode,
    );
  }

  private add(
    severity: Severity,
    code: IssueCode,
    message: string,
    target: IssueTarget,
    node: Node | null,
  ): void {
    this.issues.push({ severity, code, message, target, range: rangeOf(node) });
  }
}

// ---------------------------------------------------------------------------

/**
 * IF 名の表記をそろえる。モデルのあるデバイスはモデル側の表記、
 * それ以外は最初に書かれた表記(interfaces → links の順)に合わせる。
 * members・vlan-raw-device と、layout のブリッジのキー(pve1:vmbr0)の IF 名もそろえる。
 */
function canonicalizeIfNames(t: Topology, catalog: ModelCatalog): void {
  const spellings = new Map<string, Map<string, string>>();
  const canonical = (deviceId: string, name: string): string => {
    let names = spellings.get(deviceId);
    if (!names) {
      names = new Map();
      const modelId = t.devices.get(deviceId)?.model;
      const model = modelId === undefined ? undefined : catalog.get(modelId);
      for (const port of model?.ports ?? []) {
        const n = normalizeIfName(port.name);
        if (!names.has(ifNameKey(n))) names.set(ifNameKey(n), n);
      }
      spellings.set(deviceId, names);
    }
    const key = ifNameKey(name);
    const found = names.get(key);
    if (found !== undefined) return found;
    names.set(key, name);
    return name;
  };

  for (const device of t.devices.values()) {
    const renamed = new Map<string, InterfaceInfo>();
    for (const [name, info] of device.interfaces) renamed.set(canonical(device.id, name), info);
    device.interfaces = renamed;
  }
  for (const link of t.links) {
    for (const end of ["a", "b"] as const) {
      const ep = link[end];
      if (ep) link[end] = { device: ep.device, iface: canonical(ep.device, ep.iface) };
    }
  }
  for (const device of t.devices.values()) {
    for (const info of device.interfaces.values()) {
      if (info.members) info.members = info.members.map((m) => canonical(device.id, m));
      if (info.vlanRawDevice !== undefined) {
        info.vlanRawDevice = canonical(device.id, info.vlanRawDevice);
      }
    }
  }
  if ([...t.layout.keys()].some((key) => parseBridgeKey(key) !== undefined)) {
    t.layout = new Map(
      [...t.layout].map(([key, pos]) => {
        const parsed = parseBridgeKey(key);
        const same = !parsed || !t.devices.has(parsed.host);
        return [same ? key : bridgeKey(parsed.host, canonical(parsed.host, parsed.bridge)), pos];
      }),
    );
  }
}

function rangeOf(node: Node | null | undefined): SourceRange | undefined {
  return node?.range ? { start: node.range[0], end: node.range[1] } : undefined;
}

function toJS(node: Node | null): unknown {
  return node === null ? null : node.toJSON();
}

function joinPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function isEmptyScalar(node: Node): boolean {
  return isScalar(node) && node.value === null;
}

function isNonEmptyString(node: Node | null): node is Node & { value: string } {
  return isScalar(node) && typeof node.value === "string" && node.value !== "";
}

function enumValue<T extends string>(node: Node | null, values: readonly T[]): T | undefined {
  if (
    isScalar(node) &&
    typeof node.value === "string" &&
    (values as readonly string[]).includes(node.value)
  ) {
    return node.value as T;
  }
  return undefined;
}
