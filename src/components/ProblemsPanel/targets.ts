// 問題の対象の表示名と、クリックしたときに選ぶもの。

import {
  allBridges,
  bridgeKey,
  endpointNodeId,
  endpointToString,
  findHostBridge,
  type IssueTarget,
  type Link,
  parseBendKey,
  parseEndpoint,
  resolveBridgeKey,
  type Topology,
} from "../../core";
import type { Selection } from "../../store";

/** 問題の対象を短い文字で表す。IF 名は show で表示用にする(長い名前の設定に合わせる) */
export function describeTarget(
  target: IssueTarget,
  t: Topology,
  show: (iface: string) => string,
): string {
  switch (target.kind) {
    case "document":
      return "ファイル全体";
    case "device":
      return target.id;
    case "interface":
      return `${target.device} の ${show(target.name)}`;
    case "link": {
      const link = t.links.find((l) => l.id === target.id);
      return link ? describeLink(link, show) : "リンク";
    }
    case "layout":
      return `layout の ${target.id}`;
    case "label":
      return `layout._labels の ${target.key}`;
    case "bend":
      return `layout._bends の ${target.key}`;
    case "group":
      return `groups の ${target.index + 1} 番目`;
    case "sdn":
      return `sdn の ${target.section}.${target.id}`;
  }
}

function describeLink(link: Link, show: (iface: string) => string): string {
  const end = (ep: Link["a"]) =>
    ep ? endpointToString({ device: ep.device, iface: show(ep.iface) }) : "?";
  return `${end(link.a)} ↔ ${end(link.b)}`;
}

/**
 * 問題をクリックしたときに選ぶものと、表示を合わせるデバイス。
 * 図に描けないリンク(端が不正など)も選ぶ(インスペクタで内容を見たり削除したりできる)。
 * グループの問題では、そのグループのメンバー(存在するもの)を選ぶ(枠のラベルのクリックと同じ)。
 * ブリッジの IF と、layout のブリッジのキーの問題では、ブリッジの箱を選ぶ(SPEC 4.6)。
 * VNet の問題では、その VNet の箱(描いているもの)を選ぶ(フェーズ4-6)。
 * ファイル全体の問題では何も選ばない。
 */
export function issueFocus(
  target: IssueTarget,
  t: Topology,
): { selection: Selection; devices: string[] } | undefined {
  const device = (id: string) =>
    t.devices.has(id) || resolveBridgeKey(t, id) === id
      ? { selection: { devices: [id], links: [] }, devices: [id] }
      : undefined;
  switch (target.kind) {
    case "device":
    case "layout":
      return device(target.id);
    case "label": {
      // ラベルの位置の問題では、その端のデバイスを選ぶ
      const ep = parseEndpoint(target.key);
      return ep ? device(ep.device) : undefined;
    }
    case "bend": {
      // 曲げた線の点の問題では、線の両端のうち図にあるもの(デバイスかブリッジの箱)を選ぶ
      const nodes = (parseBendKey(target.key) ?? []).filter((id) => device(id) !== undefined);
      return nodes.length > 0
        ? { selection: { devices: nodes, links: [] }, devices: nodes }
        : undefined;
    }
    case "interface": {
      const bridge = findHostBridge(t, target.device, target.name);
      return device(bridge === undefined ? target.device : bridgeKey(target.device, bridge));
    }
    case "link": {
      const link = t.links.find((l) => l.id === target.id);
      if (!link) return undefined;
      // 表示を合わせる先は箱(ブリッジへのリンクなら、ブリッジの箱)
      const nodes = [link.a, link.b].flatMap((ep) =>
        ep && t.devices.has(ep.device) ? [endpointNodeId(t, ep)] : [],
      );
      return { selection: { devices: [], links: [link.id] }, devices: [...new Set(nodes)] };
    }
    case "group": {
      const members = [...new Set(t.groups[target.index]?.members ?? [])].filter((id) =>
        t.devices.has(id),
      );
      return members.length > 0
        ? { selection: { devices: members, links: [] }, devices: members }
        : undefined;
    }
    case "sdn": {
      if (target.section !== "vnets") return undefined;
      const boxes = allBridges(t)
        .filter((box) => box.vnet && box.bridge === target.id)
        .map((box) => box.key);
      return boxes.length > 0
        ? { selection: { devices: boxes, links: [] }, devices: boxes }
        : undefined;
    }
    case "document":
      return undefined;
  }
}
