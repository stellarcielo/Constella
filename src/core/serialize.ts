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
import { parseBendKey } from "./bendKeys";
import { bendKeyNorm } from "./bends";
import { bridgeKey, parseBridgeKey } from "./bridges";
import { ifNameKey } from "./ifname";
import { labelKeyNorm } from "./labelLayout";
import { parseTopology, type YamlBase } from "./parse";
import { endpointToString, parseEndpoint } from "./topology";
import type {
  Device,
  Extra,
  Group,
  InterfaceInfo,
  Issue,
  Link,
  Meta,
  ModelCatalog,
  SdnVnet,
  SdnZone,
  Topology,
} from "./types";

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
  w.sdn(root);

  return {
    text: doc.toString(STRINGIFY_OPTIONS),
    base: { doc, topology: structuredClone(topology), linkNodes: newLinkNodes },
  };
}

/**
 * 書き出した YAML を読み直して、次回の base と YAML 由来の問題を作る(GUI で編集した後・保存した後)。
 * 書き出しに使った YAML の各部分は、読み込んだときの位置(range)を持ったままなので、
 * 読み直して今の文字列の位置にそろえる(エディタの下線や問題パネルの行番号のため)。
 * リンクには YAML 上の識別子が無いが、保存処理は並び順を変えない(削除と末尾への追加だけ)ので、
 * 順番で対応付ける。対応が取れなければ undefined(呼び出し側は今までの base を使う)。
 */
export function rebaseOnText(
  text: string,
  topology: Topology,
  catalog: ModelCatalog,
): { base: YamlBase; fileIssues: Issue[] } | undefined {
  const parsed = parseTopology(text, { catalog });
  if (!parsed.ok || parsed.topology.links.length !== topology.links.length) return undefined;
  const ids = new Map<string, string>();
  for (const [i, link] of parsed.topology.links.entries()) {
    const own = topology.links[i];
    if (linkKey(link) !== linkKey(own)) return undefined;
    ids.set(link.id, own.id);
  }
  const linkNodes = new Map<string, YAMLMap>();
  for (const [id, node] of parsed.base.linkNodes) {
    const own = ids.get(id);
    if (own !== undefined) linkNodes.set(own, node);
  }
  const fileIssues = parsed.issues.map((issue) =>
    issue.target.kind === "link"
      ? { ...issue, target: { ...issue.target, id: ids.get(issue.target.id) ?? issue.target.id } }
      : issue,
  );
  return {
    base: { doc: parsed.base.doc, topology: structuredClone(topology), linkNodes },
    fileIssues,
  };
}

function linkKey(link: Link): string {
  return [link.a, link.b].map((ep) => (ep ? endpointToString(ep) : "?")).join(" ");
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
  /** 書き出し前のデバイスID → 今の ID(削除されたなら undefined)。内部の識別子(uid)で対応を取る */
  private readonly idAfter = new Map<string, string | undefined>();

  constructor(doc: Document, before: Topology, after: Topology) {
    this.doc = doc;
    this.before = before;
    this.after = after;
    const afterByUid = new Map([...after.devices.values()].map((d) => [d.uid, d.id]));
    for (const device of before.devices.values()) {
      this.idAfter.set(device.id, afterByUid.get(device.uid));
    }
  }

  /**
   * デバイスID の変更に合わせて、マップのキー名だけをその場で書き換える(位置とコメントを保つ)。
   * 同じキーが重複している場合(エラー)は最初のものだけを書き換える。
   */
  private renameKeys(map: YAMLMap): void {
    const done = new Set<string>();
    for (const pair of map.items) {
      const key = keyText(pair.key);
      const next = this.idAfter.get(key);
      if (next === undefined || next === key || done.has(key)) continue;
      done.add(key);
      if (isScalar(pair.key)) pair.key.value = next;
      else pair.key = this.doc.createNode(next);
    }
  }

  /** ラベルの位置のキー(デバイスID:IF名)の、書き出し後のキー(デバイスが削除されていれば undefined) */
  private labelKeyAfter(key: string): string | undefined {
    const ep = parseEndpoint(key);
    if (!ep || !this.idAfter.has(ep.device)) return key;
    const device = this.idAfter.get(ep.device);
    return device === undefined ? undefined : endpointToString({ ...ep, device });
  }

  /** 曲げた線の点のキーの、書き出し後のキー(どちらかの端のデバイスが削除されていれば undefined) */
  private bendKeyAfter(key: string): string | undefined {
    const nodes = parseBendKey(key);
    if (!nodes) return key;
    const renamed: string[] = [];
    for (const node of nodes) {
      const bridge = parseBridgeKey(node);
      const device = bridge ? bridge.host : node;
      if (!this.idAfter.has(device)) {
        renamed.push(node);
        continue;
      }
      const after = this.idAfter.get(device);
      if (after === undefined) return undefined;
      renamed.push(bridge ? bridgeKey(after, bridge.bridge) : after);
    }
    return renamed.join(" ");
  }

  /** layout のキーの、書き出し後のキー(デバイスが削除されていれば undefined) */
  private layoutKeyAfter(key: string): string | undefined {
    const bridge = parseBridgeKey(key);
    if (!bridge) return this.idAfter.has(key) ? this.idAfter.get(key) : key;
    if (!this.idAfter.has(bridge.host)) return key;
    const host = this.idAfter.get(bridge.host);
    return host === undefined ? undefined : bridgeKey(host, bridge.bridge);
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

    // 削除されたデバイス(パースできなかった要素は前のトポロジに無いので触らない)
    map.items = map.items.filter((pair) => {
      const id = keyText(pair.key);
      return !this.idAfter.has(id) || this.idAfter.get(id) !== undefined;
    });
    this.renameKeys(map);

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
    const before = new Set(map.items.map((pair) => keyText(pair.key)));
    this.syncFields(map, deviceFields(device), device.extra);
    // 新しく書いた項目(GUI で設定した host など)は、interfaces より前に置く
    const at = map.items.findIndex((pair) => keyText(pair.key) === "interfaces");
    const added = map.items.filter((pair, i) => i > at && !before.has(keyText(pair.key)));
    if (at >= 0 && added.length > 0) {
      map.items = map.items.filter((pair) => !added.includes(pair));
      map.items.splice(at, 0, ...added);
    }
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
    const { layout, viewport, labelLayout, bends } = this.after;
    const found = root.get("layout", true) as Node | undefined;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else if (layout.size === 0 && !viewport && labelLayout.size === 0 && bends.size === 0) return;
    else map = this.setSection(root, "layout", new YAMLMap());

    // 削除の判定は書き換える前のキーで行う(削除したデバイスの ID に別のデバイスを改名した場合のため)。
    // ブリッジのキー(pve1:vmbr0)は、IF 名の書き方の違いを同じとみなす
    const after = new Set([...layout.keys()].map(layoutKeyNorm));
    const before = new Set([...this.before.layout.keys()].map(layoutKeyNorm));
    map.items = map.items.filter((pair) => {
      const key = keyText(pair.key);
      if (key === "_viewport") return viewport !== undefined || this.before.viewport === undefined;
      const id = this.layoutKeyAfter(key);
      return (id !== undefined && after.has(layoutKeyNorm(id))) || !before.has(layoutKeyNorm(key));
    });
    // デバイスID の変更に合わせてキーを書き換え、ブリッジのキーは IF 名の表記もそろえる
    const byNorm = new Map([...layout.keys()].map((id) => [layoutKeyNorm(id), id]));
    const done = new Set<string>();
    for (const pair of map.items) {
      const key = keyText(pair.key);
      if (key === "_viewport") continue;
      const moved = this.layoutKeyAfter(key) ?? key;
      const next = byNorm.get(layoutKeyNorm(moved)) ?? moved;
      if (next === key || done.has(next)) continue;
      done.add(next);
      if (isScalar(pair.key)) pair.key.value = next;
      else pair.key = this.doc.createNode(next);
    }

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
    for (const [key, fields] of entries) this.setFlowEntry(map, key, fields);
    this.labelLayout(map);
    this.bendLayout(map);
  }

  /** layout._labels(手で動かしたラベルの位置。SPEC 4.3)。項目が無くなれば _labels ごと消す */
  private labelLayout(layout: YAMLMap): void {
    const { labelLayout } = this.after;
    const pair = layout.items.find((p) => keyText(p.key) === "_labels");
    const found = pair?.value as Node | null | undefined;
    // 読めない値は、ラベルを動かすまでそのまま残す
    if (labelLayout.size === 0 && !isMap(found)) return;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else {
      map = new YAMLMap();
      if (pair) pair.value = map;
      else layout.items.push(new Pair(this.doc.createNode("_labels"), map));
    }

    // 削除の判定と、デバイスID の変更に合わせたキーの書き換えは、layout のデバイスと同じ。
    // IF 名の書き方の違いは同じとみなし、今の表記にそろえる
    const after = new Set([...labelLayout.keys()].map(labelKeyNorm));
    const before = new Set([...this.before.labelLayout.keys()].map(labelKeyNorm));
    map.items = map.items.filter((p) => {
      const key = keyText(p.key);
      const moved = this.labelKeyAfter(key);
      return (
        (moved !== undefined && after.has(labelKeyNorm(moved))) || !before.has(labelKeyNorm(key))
      );
    });
    const byNorm = new Map([...labelLayout.keys()].map((key) => [labelKeyNorm(key), key]));
    const done = new Set<string>();
    for (const p of map.items) {
      const key = keyText(p.key);
      const moved = this.labelKeyAfter(key) ?? key;
      const next = byNorm.get(labelKeyNorm(moved)) ?? moved;
      if (next === key || done.has(next)) continue;
      done.add(next);
      if (isScalar(p.key)) p.key.value = next;
      else p.key = this.doc.createNode(next);
    }
    for (const [key, offset] of labelLayout) {
      this.setFlowEntry(map, key, [
        ["along", offset.along],
        ["side", offset.side],
      ]);
    }
    if (map.items.length === 0) layout.items = layout.items.filter((p) => p !== pair);
  }

  /** layout._bends(曲げた線の点。SPEC 4.3)。項目が無くなれば _bends ごと消す */
  private bendLayout(layout: YAMLMap): void {
    const { bends } = this.after;
    const pair = layout.items.find((p) => keyText(p.key) === "_bends");
    const found = pair?.value as Node | null | undefined;
    // 読めない値は、線を曲げるまでそのまま残す
    if (bends.size === 0 && !isMap(found)) return;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else {
      map = new YAMLMap();
      if (pair) pair.value = map;
      else layout.items.push(new Pair(this.doc.createNode("_bends"), map));
    }

    // 削除の判定と、デバイスID の変更に合わせたキーの書き換えは、ラベルの位置と同じ。
    // ノードの順とブリッジの IF 名の書き方の違いは同じとみなし、今の表記(名前の順)にそろえる
    const after = new Set([...bends.keys()].map(bendKeyNorm));
    const before = new Set([...this.before.bends.keys()].map(bendKeyNorm));
    map.items = map.items.filter((p) => {
      const key = keyText(p.key);
      const moved = this.bendKeyAfter(key);
      return (
        (moved !== undefined && after.has(bendKeyNorm(moved))) || !before.has(bendKeyNorm(key))
      );
    });
    const byNorm = new Map([...bends.keys()].map((key) => [bendKeyNorm(key), key]));
    const done = new Set<string>();
    for (const p of map.items) {
      const key = keyText(p.key);
      const moved = this.bendKeyAfter(key) ?? key;
      const next = byNorm.get(bendKeyNorm(moved)) ?? moved;
      if (next === key || done.has(next)) continue;
      done.add(next);
      if (isScalar(p.key)) p.key.value = next;
      else p.key = this.doc.createNode(next);
    }
    for (const [key, points] of bends) {
      const p = map.items.find((item) => keyText(item.key) === key);
      const value = p?.value as Node | null | undefined;
      // 点が変わっていなければ(キーの順を直しただけでも)、書き方をそのまま残す
      if (value && JSON.stringify(value.toJSON()) === JSON.stringify(points)) continue;
      const seq = new YAMLSeq();
      seq.flow = true;
      for (const point of points) {
        const item = this.newMap(
          [
            ["x", point.x],
            ["y", point.y],
          ],
          {},
        );
        item.flow = true;
        seq.items.push(item);
      }
      if (p) p.value = seq;
      else map.items.push(new Pair(this.doc.createNode(key), seq));
    }
    if (map.items.length === 0) layout.items = layout.items.filter((p) => p !== pair);
  }

  /** マップの項目を、1 行のマップ({ x: 1, y: 2 })で書く。前からマップなら中の項目ごとに書き込む */
  private setFlowEntry(map: YAMLMap, key: string, fields: Fields): void {
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

  groups(root: YAMLMap, groups: Group[]): void {
    const found = root.get("groups", true) as Node | undefined;
    let seq: YAMLSeq;
    if (isSeq(found)) seq = found;
    else if (groups.length === 0) return;
    else seq = this.setSection(root, "groups", new YAMLSeq());
    // 書き出し前の図の i 番目のグループが、i 番目のマップの項目(マップの項目ごとにグループを読むため)。
    // 内部の識別子(uid)で今のグループと対応させ、消したグループの項目だけを取り除く
    // (途中のグループを消しても、ほかのグループの書き方やコメントがずれないように)
    const maps = seq.items.filter((i) => isMap(i));
    const nodeOf = new Map(
      this.before.groups.flatMap((g, i) => (maps[i] ? [[g.uid, maps[i]] as const] : [])),
    );
    const kept = new Set<unknown>();
    const added: YAMLMap[] = [];
    for (const group of groups) {
      const node = nodeOf.get(group.uid);
      if (node && !kept.has(node)) {
        kept.add(node);
        this.syncFields(node, groupFields(group), group.extra);
      } else {
        added.push(this.groupNode(group));
      }
    }
    seq.items = [...seq.items.filter((i) => !isMap(i) || kept.has(i)), ...added];
    // GUI でグループをすべて消したら、groups ごと消す
    if (seq.items.length === 0 && this.before.groups.length > 0) root.delete("groups");
  }

  /**
   * SDN(SPEC 4.6)。GUI で変わるのはゾーンの nodes(デバイスID の変更・削除)くらいなので、
   * ゾーン・VNet ごとに項目を書き込み、ほかの書き方やコメントはそのまま残す
   */
  sdn(root: YAMLMap): void {
    const { sdn } = this.after;
    const found = root.get("sdn", true) as Node | undefined;
    let map: YAMLMap;
    if (isMap(found)) map = found;
    else if (sdn.zones.size === 0 && sdn.vnets.size === 0) return;
    else map = this.setSection(root, "sdn", new YAMLMap());
    this.sdnSection(map, "zones", sdn.zones, zoneFields);
    this.sdnSection(map, "vnets", sdn.vnets, vnetFields);
  }

  private sdnSection<T extends { extra: Extra }>(
    map: YAMLMap,
    key: "zones" | "vnets",
    entries: Map<string, T>,
    fields: (entry: T) => Fields,
  ): void {
    const found = map.get(key, true) as Node | undefined;
    let section: YAMLMap;
    if (isMap(found)) section = found;
    else if (entries.size === 0) return;
    else {
      section = new YAMLMap();
      map.set(key, section);
    }
    // 消したもの(パースできなかった要素は前のトポロジに無いので触らない)
    const before = this.before.sdn[key];
    section.items = section.items.filter((pair) => {
      const id = keyText(pair.key);
      return entries.has(id) || !before.has(id);
    });
    for (const [id, entry] of entries) {
      const pair = section.items.find((p) => keyText(p.key) === id);
      if (!pair) {
        section.items.push(new Pair(this.doc.createNode(id), this.sdnNode(fields(entry), entry)));
        continue;
      }
      const value = pair.value as Node | null;
      if (isMap(value)) this.syncFields(value, fields(entry), entry.extra);
      else if (hasContent(fields(entry), entry.extra)) {
        pair.value = this.sdnNode(fields(entry), entry);
      }
    }
  }

  /** ゾーン・VNet のマップ(nodes・subnets は 1 行の配列) */
  private sdnNode(fields: Fields, entry: { extra: Extra }): YAMLMap {
    const map = this.newMap(fields, entry.extra);
    for (const key of ["nodes", "subnets"]) {
      const seq = map.get(key, true);
      if (isSeq(seq)) seq.flow = true;
    }
    return map;
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
    for (const key of ["ip", "members"]) {
      const seq = map.get(key, true);
      if (isSeq(seq)) seq.flow = true;
    }
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
      // マップの項目(クラスタの networks)は、中の項目ごとに書き込む(中のコメントや書式が残る)
      if (value instanceof Map && isMap(current)) {
        const entries: Fields = [...value].map(([k, v]) => [String(k), v]);
        const keys = new Set(entries.map(([k]) => k));
        current.items = current.items.filter((pair) => keys.has(keyText(pair.key)));
        this.syncFields(current, entries, {});
        continue;
      }
      if (isScalar(current) && !Array.isArray(value) && !(value instanceof Map)) {
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
    ["host", device.host],
    ["guest", device.guest],
    ["vmid", device.vmid],
  ];
}

function infoFields(info: InterfaceInfo): Fields {
  return [
    ["type", info.type],
    ["members", info.members],
    ["bond-mode", info.bondMode],
    ["vlan-aware", info.vlanAware],
    ["vlan-raw-device", info.vlanRawDevice],
    ["description", info.description],
    ["transceiver", info.transceiver],
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
    ["networks", group.networks],
  ];
}

function zoneFields(zone: SdnZone): Fields {
  return [
    ["type", zone.type],
    ["bridge", zone.bridge],
    ["tag", zone.tag],
    ["nodes", zone.nodes],
  ];
}

function vnetFields(vnet: SdnVnet): Fields {
  return [
    ["zone", vnet.zone],
    ["tag", vnet.tag],
    ["subnets", vnet.subnets],
  ];
}

/** layout のキーを比べるための形。ブリッジのキーは IF 名の書き方の違いをならす */
function layoutKeyNorm(key: string): string {
  const bridge = parseBridgeKey(key);
  return bridge ? `${bridge.host}\u0000${ifNameKey(bridge.bridge)}` : key;
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
