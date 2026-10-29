// リンクの端の IF 名ラベルに出す内容(SPEC 7.3・フェーズ3-2)。
// IF 名の下に、その IF の IP(1 つずつ)と VLAN を足す。キャンバスと SVG の書き出しで共有する。

import { expandIfName, ifNameKey } from "./ifname";
import type { Device, InterfaceInfo } from "./types";

export interface IfLabelOptions {
  /** IF 名を出すか(ツールバーの「IF 名」) */
  showIfName: boolean;
  /** IF 名を長い形で出すか(ツールバーの「長い名前」) */
  longIfNames: boolean;
  /** IP を出すか(ツールバーの「IP」) */
  showIp: boolean;
  /** VLAN を出すか(ツールバーの「VLAN」) */
  showVlan: boolean;
}

export interface IfLabel {
  /** 1 行目の IF 名(出さないときは undefined) */
  name?: string;
  /** IF 名の下に小さく出す行(IP、VLAN の順) */
  details: string[];
}

/** ラベルの全部の行(大きさの見積もり用) */
export function ifLabelLines(label: IfLabel): string[] {
  return label.name === undefined ? label.details : [label.name, ...label.details];
}

/**
 * VLAN の書き方(フェーズ3-2 Q4)。access は「VLAN 10」、trunk は「trunk 10,20,30」
 * (通す VLAN が書かれていなければ「trunk」)。routed や、書くことが無ければ undefined
 */
export function vlanText(info: InterfaceInfo): string | undefined {
  if (info.mode === "routed") return undefined;
  // vlans は trunk の項目なので、モードが無くても trunk として書く
  if (info.mode === "trunk" || (info.mode === undefined && info.vlans !== undefined)) {
    return info.vlans ? `trunk ${info.vlans}` : "trunk";
  }
  return info.vlan === undefined ? undefined : `VLAN ${info.vlan}`;
}

/** デバイスの IF の追加情報。長い名前・短い名前、大文字小文字の違いは同じ IF として探す */
export function interfaceInfo(
  device: Device | undefined,
  iface: string,
): InterfaceInfo | undefined {
  if (!device) return undefined;
  const direct = device.interfaces.get(iface);
  if (direct) return direct;
  const key = ifNameKey(iface);
  for (const [name, info] of device.interfaces) if (ifNameKey(name) === key) return info;
  return undefined;
}

/** リンクの端のラベル。出す行が無ければ undefined(ラベルを描かない) */
export function ifLabel(
  iface: string,
  info: InterfaceInfo | undefined,
  options: IfLabelOptions,
): IfLabel | undefined {
  const details: string[] = [];
  if (options.showIp) details.push(...(info?.ip ?? []));
  const vlan = options.showVlan && info ? vlanText(info) : undefined;
  if (vlan) details.push(vlan);
  const name = options.showIfName ? (options.longIfNames ? expandIfName(iface) : iface) : undefined;
  return name === undefined && details.length === 0 ? undefined : { name, details };
}
