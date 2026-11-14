// 右クリックのメニューの項目(SPEC 7.6)。右クリックした物と、今の選択から組み立てる。
// 項目は action の名前だけを持ち、実行は ContextMenu.tsx が受け持つ(ここは画面に頼らず、テストできるように)。

import { endpointNodeId, labelKey, linkBendKey, type Topology } from "../../core";
import type { MenuTarget, Selection } from "../../store";

export type MenuAction =
  | "connect"
  | "copy"
  | "cut"
  | "group"
  | "delete"
  | "straighten"
  | "resetLabels"
  | "ungroup"
  | "paste"
  | "selectAll"
  | "autoArrange"
  | "resetAllLabels";

export interface MenuItem {
  action: MenuAction;
  label: string;
  /** 同じ操作のショートカット(表示だけ) */
  shortcut?: string;
  /** false なら薄く出して選べなくする */
  enabled: boolean;
  /** 消す操作(赤で出す) */
  danger?: boolean;
}

export type MenuEntry = MenuItem | { separator: true };

const SEPARATOR: MenuEntry = { separator: true };

export function isSeparator(entry: MenuEntry): entry is { separator: true } {
  return "separator" in entry;
}

/** 選んでいる線のうち、曲げてある線の点のキー(同じ 2 台の間の線は同じキー) */
export function selectedBendKeys(t: Topology, links: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const link of t.links) {
    if (!links.includes(link.id)) continue;
    const key = linkBendKey(t, link);
    if (key !== undefined && t.bends.has(key)) keys.add(key);
  }
  return [...keys];
}

/** 選んでいる線の両端のうち、手で動かしたラベルのキー(ブリッジの端にはラベルが無い) */
export function selectedLabelKeys(t: Topology, links: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const link of t.links) {
    if (!links.includes(link.id)) continue;
    for (const ep of [link.a, link.b]) {
      if (!ep || endpointNodeId(t, ep) !== ep.device) continue;
      const key = labelKey(ep.device, ep.iface);
      if (t.labelLayout.has(key)) keys.add(key);
    }
  }
  return [...keys];
}

export function contextMenuItems(
  target: MenuTarget,
  t: Topology,
  selection: Selection,
): MenuEntry[] {
  const del: MenuItem = {
    action: "delete",
    label: "削除",
    shortcut: "⌫",
    enabled: true,
    danger: true,
  };
  switch (target.kind) {
    case "nodes": {
      // デバイスでない ID はブリッジの箱。箱だけなら、消すことしかできない
      const devices = selection.devices.filter((id) => t.devices.has(id));
      if (devices.length === 0) return [del];
      return [
        { action: "connect", label: "接続を始める", enabled: devices.length === 1 },
        SEPARATOR,
        { action: "copy", label: "コピー", shortcut: "⌘C", enabled: true },
        { action: "cut", label: "カット", shortcut: "⌘X", enabled: true },
        SEPARATOR,
        { action: "group", label: "グループにする", shortcut: "⌘G", enabled: true },
        SEPARATOR,
        del,
      ];
    }
    case "links":
      return [
        {
          action: "straighten",
          label: "まっすぐに戻す",
          enabled: selectedBendKeys(t, selection.links).length > 0,
        },
        {
          action: "resetLabels",
          label: "ラベルを戻す",
          enabled: selectedLabelKeys(t, selection.links).length > 0,
        },
        SEPARATOR,
        del,
      ];
    case "group":
      return [
        {
          action: "copy",
          label: "メンバーをコピー",
          shortcut: "⌘C",
          enabled: selection.devices.some((id) => t.devices.has(id)),
        },
        { action: "ungroup", label: "グループを解除", shortcut: "⇧⌘G", enabled: true },
      ];
    case "pane":
      return [
        { action: "paste", label: "ここにペースト", enabled: true },
        { action: "selectAll", label: "すべてを選択", shortcut: "⌘A", enabled: true },
        SEPARATOR,
        { action: "autoArrange", label: "自動整列", enabled: t.devices.size > 0 },
        {
          action: "resetAllLabels",
          label: "ラベルを戻す(すべて)",
          enabled: t.labelLayout.size > 0,
        },
      ];
  }
}
