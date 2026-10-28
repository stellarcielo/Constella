// 問題の対象の表示名と、クリックしたときに選ぶもの。

import { endpointToString, type IssueTarget, type Link, type Topology } from "../../core";
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
 * ファイル全体やグループ(表示はフェーズ3)の問題では何も選ばない。
 */
export function issueFocus(
  target: IssueTarget,
  t: Topology,
): { selection: Selection; devices: string[] } | undefined {
  const device = (id: string) =>
    t.devices.has(id) ? { selection: { devices: [id], links: [] }, devices: [id] } : undefined;
  switch (target.kind) {
    case "device":
    case "layout":
      return device(target.id);
    case "interface":
      return device(target.device);
    case "link": {
      const link = t.links.find((l) => l.id === target.id);
      if (!link) return undefined;
      const ends = [link.a?.device, link.b?.device].filter(
        (id): id is string => id !== undefined && t.devices.has(id),
      );
      return { selection: { devices: [], links: [link.id] }, devices: [...new Set(ends)] };
    }
    case "document":
    case "group":
      return undefined;
  }
}
