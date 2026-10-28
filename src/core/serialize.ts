// トポロジ → YAML 文字列(SPEC 8.2)。
// 読み込んだ YAML ドキュメントに差分だけを当てるので、コメント・キー順・書式は可能な限り残る。
// 新しい要素は末尾に追加し、IF 名は短い形で書き出す。

import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  Pair,
  type ToStringOptions,
  YAMLMap,
  YAMLSeq,
} from "yaml";
import { ifNameKey } from "./ifname";
import { parseTopology, type YamlBase } from "./parse";
import { endpointToString } from "./topology";
import type { Device, Extra, Group, InterfaceInfo, Link, Meta, Topology } from "./types";

export interface SerializeResult {
  text: string;
  /** 次回の serializeTopology に渡す */
  base: YamlBase;
}

export const STRINGIFY_OPTIONS: ToStringOptions = { lineWidth: 0 };

/**
 * base を渡すと、その YAML に差分を当てて書き出す(base 自体は変更しない)。
 * base が無ければ新しい YAML を作る。
 */
export function serializeTopology(topology: Topology, base?: YamlBase): SerializeResult {
  const from = base ?? emptyBase();
  const doc = from.doc.clone();
  const linkNodes = remapLinkNodes(from, doc);
  const w = new Writer(doc, from.topology, topology);

  const root = doc.contents;
  if (!isMap(root)) throw new Error("base.doc の最上位がマップではありません");
  w.syncFields(root, [["constella", 1]], {});
  w.meta(root, topology.meta);
  w.devices(root);
  const newLinkNodes = w.links(root, linkNodes);
  w.layout(root);
  w.groups(root, topology.groups);

  return {
    text: doc.toString(STRINGIFY_OPTIONS),
    base: { doc, topology: structuredClone(topology), linkNodes: newLinkNodes },
  };
}

function emptyBase(): YamlBase {
  const result = parseTopology("constella: 1\n");
  if (!result.ok) throw new Error("unreachable");
  return result.base;
}

/** clone した doc の中で、各リンクに対応するノードを探し直す */
function remapLinkNodes(base: YamlBase, doc: Document): Map<string, YAMLMap> {
  const result = new Map<string, YAMLMap>();
  const oldSeq = base.doc.get("links", true);
  const newSeq = doc.get("links", true);
  if (!isSeq(oldSeq) || !isSeq(newSeq)) return result;
  for (const [id, node] of base.linkNodes) {
    const item = newSeq.items[oldSeq.items.indexOf(node)];
    if (isMap(item)) result.set(id, item);
  }
  return result;
}

type Fields = [key: string, value: unknown][];

class Writer {
  private readonly doc: Document;
  private readonly before: Topology;
  private readonly after: Topology;

  constructor(doc: Document, before: Topology, after: Topology) {
    this.doc = doc;
    this.before = before;
    this.after = after;
  }

  meta(root: YAMLMap, meta: Meta): void {
    const fields: Fields = [
      ["title", meta.title],
      ["description", meta.description],
    ];
    const node = root.get("meta", true);
    if (isMap(node)) {
      this.syncFields(node, fields, meta.extra);
    } else if (hasContent(fields, meta.extra)) {
      this.setSection(root, "meta", this.newMap(fields, meta.extra));
    }
  }

  devices(root: YAMLMap): void {
    const devices = this.after.devices;
    const found = root.get("devices", true) as Node | undefined;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else if (devices.size === 0) return;
    else map = this.setSection(root, "devices", new YAMLMap());

    // 削除されたデバイス
    map.items = map.items.filter((pair) => {
      const id = keyText(pair.key);
      return devices.has(id) || !this.before.devices.has(id);
    });

    for (const device of devices.values()) {
      const pair = map.items.find((p) => keyText(p.key) === device.id);
      if (!pair) {
        map.items.push(new Pair(this.doc.createNode(device.id), this.deviceNode(device)));
        continue;
      }
      keepKeyText(pair);
      const value = pair.value as Node | null;
      if (isMap(value)) this.syncDevice(value, device);
      else if (hasContent(deviceFields(device), device.extra) || device.interfaces.size > 0) {
        pair.value = this.deviceNode(device);
      }
    }
  }

  private syncDevice(map: YAMLMap, device: Device): void {
    this.syncFields(map, deviceFields(device), device.extra);
    const node = map.get("interfaces", true);
    if (device.interfaces.size === 0) {
      if (isMap(node) && !("interfaces" in device.extra)) map.delete("interfaces");
      return;
    }
    if (!isMap(node)) {
      map.set("interfaces", this.interfacesNode(device.interfaces));
      return;
    }

    const byKey = new Map([...device.interfaces.keys()].map((name) => [ifNameKey(name), name]));
    const matched = new Set<string>();
    node.items = node.items.filter((pair) => byKey.has(ifNameKey(keyText(pair.key))));
    for (const pair of node.items) {
      const name = byKey.get(ifNameKey(keyText(pair.key)));
      // 同じ IF が重複している場合(エラー)は 2 つ目以降に触らない
      if (name === undefined || matched.has(name)) continue;
      matched.add(name);
      if (isScalar(pair.key) && pair.key.value !== name) pair.key.value = name;
      const info = device.interfaces.get(name);
      if (!info) continue;
      const value = pair.value as Node | null;
      if (isMap(value)) this.syncFields(value, infoFields(info), info.extra);
      else if (hasContent(infoFields(info), info.extra)) pair.value = this.infoNode(info);
    }
    for (const [name, info] of device.interfaces) {
      if (!matched.has(name))
        node.items.push(new Pair(this.doc.createNode(name), this.infoNode(info)));
    }
  }

  links(root: YAMLMap, nodes: Map<string, YAMLMap>): Map<string, YAMLMap> {
    const result = new Map<string, YAMLMap>();
    const links = this.after.links;
    const found = root.get("links", true) as Node | undefined;
    let seq: YAMLSeq;
    if (isSeq(found)) seq = found;
    else if (links.length === 0) return result;
    else seq = this.setSection(root, "links", new YAMLSeq());
    const items = seq.items;

    const ids = new Set(links.map((l) => l.id));
    for (const [id, node] of nodes) {
      if (ids.has(id)) continue;
      const i = items.indexOf(node);
      if (i >= 0) items.splice(i, 1);
    }

    for (const link of links) {
      let node = nodes.get(link.id);
      if (node && items.includes(node)) {
        this.syncFields(node, linkFields(link), link.extra);
      } else {
        node = this.newMap(linkFields(link), link.extra);
        items.push(node);
      }
      result.set(link.id, node);
    }
    return result;
  }

  layout(root: YAMLMap): void {
    const { layout, viewport } = this.after;
    const found = root.get("layout", true) as Node | undefined;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else if (layout.size === 0 && !viewport) return;
    else map = this.setSection(root, "layout", new YAMLMap());

    map.items = map.items.filter((pair) => {
      const key = keyText(pair.key);
      if (key === "_viewport") return viewport !== undefined || this.before.viewport === undefined;
      return layout.has(key) || !this.before.layout.has(key);
    });

    const entries: [string, Fields][] = [...layout].map(([id, pos]) => [
      id,
      [
        ["x", pos.x],
        ["y", pos.y],
      ],
    ]);
    if (viewport) {
      entries.push([
        "_viewport",
        [
          ["x", viewport.x],
          ["y", viewport.y],
          ["zoom", viewport.zoom],
        ],
      ]);
    }
    for (const [key, fields] of entries) {
      const pair = map.items.find((p) => keyText(p.key) === key);
      const value = pair?.value as Node | null | undefined;
      if (pair && isMap(value)) {
        this.syncFields(value, fields, {});
      } else {
        const flow = this.newMap(fields, {});
        flow.flow = true;
        if (pair) pair.value = flow;
        else map.items.push(new Pair(this.doc.createNode(key), flow));
      }
    }
  }

  groups(root: YAMLMap, groups: Group[]): void {
    const found = root.get("groups", true) as Node | undefined;
    let seq: YAMLSeq;
    if (isSeq(found)) seq = found;
    else if (groups.length === 0) return;
    else seq = this.setSection(root, "groups", new YAMLSeq());
    const items = seq.items;
    // グループには ID 以外の識別子が無いので、マップの項目を順番で対応させる
    const maps = items.filter((i) => isMap(i));
    maps.forEach((node, i) => {
      const group = groups[i];
      if (group) this.syncFields(node, groupFields(group), group.extra);
      else items.splice(items.indexOf(node), 1);
    });
    for (const group of groups.slice(maps.length)) items.push(this.groupNode(group));
  }

  // --- ノードの作成 -----------------------------------------------------------

  private deviceNode(device: Device): YAMLMap {
    const map = this.newMap(deviceFields(device), {});
    if (device.interfaces.size > 0)
      map.items.push(
        new Pair(this.doc.createNode("interfaces"), this.interfacesNode(device.interfaces)),
      );
    this.appendExtra(map, device.extra);
    return map;
  }

  private interfacesNode(interfaces: Map<string, InterfaceInfo>): YAMLMap {
    const map = new YAMLMap();
    for (const [name, info] of interfaces)
      map.items.push(new Pair(this.doc.createNode(name), this.infoNode(info)));
    return map;
  }

  private infoNode(info: InterfaceInfo): YAMLMap {
    const map = this.newMap(infoFields(info), info.extra);
    const ip = map.get("ip", true);
    if (isSeq(ip)) ip.flow = true;
    return map;
  }

  private groupNode(group: Group): YAMLMap {
    const map = this.newMap(groupFields(group), group.extra);
    const members = map.get("members", true);
    if (isSeq(members)) members.flow = true;
    return map;
  }

  private newMap(fields: Fields, extra: Extra): YAMLMap {
    const map = new YAMLMap();
    for (const [key, value] of fields) {
      if (value !== undefined)
        map.items.push(new Pair(this.doc.createNode(key), this.doc.createNode(value)));
    }
    this.appendExtra(map, extra);
    return map;
  }

  private appendExtra(map: YAMLMap, extra: Extra): void {
    for (const [key, value] of Object.entries(extra)) {
      if (!map.has(key))
        map.items.push(new Pair(this.doc.createNode(key), this.doc.createNode(value)));
    }
  }

  /** 最上位にセクションを追加する(前に空行を入れる) */
  private setSection<T extends YAMLMap | YAMLSeq>(root: YAMLMap, key: string, node: T): T {
    const pair = root.items.find((p) => keyText(p.key) === key);
    if (pair) {
      pair.value = node;
    } else {
      const keyNode = this.doc.createNode(key);
      keyNode.spaceBefore = true;
      root.items.push(new Pair(keyNode, node));
    }
    return node;
  }

  // --- 差分の適用 -------------------------------------------------------------

  /**
   * 各項目を書き込む。値が同じなら触らない(コメントや書式が残る)。
   * undefined の項目は削除する。ただし解釈できなかった値(extra にあるもの)は残す。
   */
  syncFields(map: YAMLMap, fields: Fields, extra: Extra): void {
    for (const [key, value] of fields) {
      if (value === undefined) {
        if (!(key in extra) && map.has(key)) map.delete(key);
        continue;
      }
      const current = map.get(key, true) as Node | undefined;
      if (isScalar(current) && !Array.isArray(value)) {
        if (!scalarEquals(current.value, value)) current.value = value;
        continue;
      }
      if (current !== undefined && current !== null && sameJSON(current.toJSON(), value)) continue;
      const node = this.doc.createNode(value);
      if (isSeq(node) && (!isSeq(current) || current.flow)) node.flow = true;
      if (current) {
        node.commentBefore = current.commentBefore;
        node.comment = current.comment;
      }
      map.set(key, node);
    }
  }
}

function deviceFields(device: Device): Fields {
  return [
    ["model", device.model],
    ["role", device.role],
    ["label", device.label],
  ];
}

function infoFields(info: InterfaceInfo): Fields {
  return [
    ["description", info.description],
    ["ip", info.ip],
    ["mode", info.mode],
    ["vlan", info.vlan],
    ["vlans", info.vlans],
  ];
}

function linkFields(link: Link): Fields {
  return [
    ["a", link.a && endpointToString(link.a)],
    ["b", link.b && endpointToString(link.b)],
    ["media", link.media],
    ["label", link.label],
  ];
}

function groupFields(group: Group): Fields {
  return [
    ["id", group.id === "" ? undefined : group.id],
    ["kind", group.kind],
    ["label", group.label],
    ["members", group.members],
  ];
}

function hasContent(fields: Fields, extra: Extra): boolean {
  return fields.some(([, v]) => v !== undefined) || Object.keys(extra).length > 0;
}

function keyText(key: unknown): string {
  if (isScalar(key)) {
    if (typeof key.value === "string") return key.value;
    return key.source ?? String(key.value);
  }
  return "";
}

/** `01` のような数値に見えるキーが `1` と書き出されないよう、文字列に直す */
function keepKeyText(pair: Pair): void {
  const key = pair.key;
  if (isScalar(key) && typeof key.value !== "string") key.value = keyText(key);
}

/** 文字列の項目は、YAML 側が数値や真偽値でも文字列として同じなら同じとみなす */
function scalarEquals(current: unknown, value: unknown): boolean {
  if (typeof value === "string" && ["number", "boolean"].includes(typeof current)) {
    return String(current) === value;
  }
  return current === value;
}

function sameJSON(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
