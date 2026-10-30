// 問題の対象の表示名と、クリックしたときに選ぶもの。

import {
  bridgeKey,
  endpointNodeId,
  endpointToString,
  findBridge,
  type IssueTarget,
  type Link,
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
    case "group":
      return `groups の ${target.index + 1} 番目`;
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
    case "interface": {
      const bridge = findBridge(t.devices.get(target.device), target.name);
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
    case "document":
      return undefined;
  }
}
