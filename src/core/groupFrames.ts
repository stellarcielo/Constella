// グループの枠(SPEC 4.3・フェーズ3-1)と、ホストの枠(SPEC 4.6・フェーズ4-1)。
// メンバーの機器を囲む四角を、機器の位置から計算する。
// キャンバスと SVG の書き出しで共有する。枠の位置は YAML に書かない(機器を動かせば枠も動く)。

import { guestsBelow, hostTree, resolveGuest } from "./hosts";
import type { Group, GroupKind, ModelCatalog, Position, Topology } from "./types";

interface FrameBox {
  /** 左上の座標と大きさ(機器の座標と同じ座標系) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 内側に入れ子になった枠の段数(0 = 入れ子が無い)。大きいほど外側 */
  inner: number;
  /** 枠で囲んだ機器(座標のある機器だけ) */
  members: string[];
}

export interface GroupFrame extends FrameBox {
  type: "group";
  /** groups の中の位置(問題パネルの対象と同じ番号) */
  index: number;
  group: Group;
}

/** ホストの枠。ホストと、その上で動くゲスト(入れ子のゲストも)を囲む */
export interface HostFrame extends FrameBox {
  type: "host";
  /** ホストのデバイスID */
  host: string;
  /** 直接のゲスト(座標のあるものだけ) */
  guests: string[];
}

export type Frame = GroupFrame | HostFrame;

/** 機器 1 台の大きさ(アイコンと、その下の名前。Canvas.css の .device-node と合わせる) */
export const DEVICE_BOX = { width: 96, height: 74 };
/** 機器と枠の間 */
export const GROUP_PADDING = 20;
/**
 * 枠の上端の、ラベルを書く帯の高さ。
 * 上から機器に入る線の IF 名(アイコンのすぐ上)とラベルがぶつからない高さにする
 */
export const GROUP_LABEL_BAND = 24;
/** 入れ子 1 段ごとに、外側の枠へ足す余白 */
export const GROUP_NEST_GAP = 14;

const KIND_NAMES: Record<GroupKind, string> = {
  site: "拠点",
  rack: "ラック",
  vlan: "VLAN",
  subnet: "サブネット",
  as: "AS",
  custom: "",
};

/** 枠のラベル。「種類: 名前」(名前が無ければ id。custom や種類なしは名前だけ) */
export function groupTitle(group: Group): string {
  const name = group.label ?? group.id;
  const kind = group.kind ? KIND_NAMES[group.kind] : "";
  return kind ? `${kind}: ${name}` : name;
}

/** ホストの枠のラベル。直接のゲストの数を種類ごとに書く(「VM 2・CT 1」) */
export function hostFrameTitle(t: Topology, catalog: ModelCatalog, frame: HostFrame): string {
  let vm = 0;
  let container = 0;
  for (const id of frame.guests) {
    const device = t.devices.get(id);
    if (device && resolveGuest(device, catalog) === "container") container++;
    else vm++;
  }
  return [vm > 0 ? `VM ${vm}` : "", container > 0 ? `CT ${container}` : ""]
    .filter(Boolean)
    .join("・");
}

/**
 * 枠を出す種類で絞り込む条件(表示レイヤー。フェーズ3-3)。種類なし・custom はいつも出す
 */
export function groupKindFilter(kinds: readonly GroupKind[]): (group: Group) => boolean {
  return (group) =>
    group.kind === undefined || group.kind === "custom" || kinds.includes(group.kind);
}

/**
 * グループとホストの枠を、描く順(外側の枠が先)に返す。visible で絞り込んだグループだけを描き、
 * 隠したグループは入れ子の余白にも数えない。
 * ほかの枠のメンバーをすべて含む枠は、その外側に余白を足して入れ子に見せる(フェーズ3-1 Q3)。
 * メンバーが同じなら、YAML で先に書いたグループを外側に、ホストの枠をいちばん内側にする。
 * 座標のあるメンバーが無いグループは描かない。
 * ホストの枠は、座標のあるゲストがいるホストにだけ描く(ゲストを隠しているときは描かない)。
 * グループのメンバーにホストがあれば、グループの枠はそのホストの枠を丸ごと囲む(SPEC 7.3)
 */
export function groupFrames(
  t: Topology,
  positionOf: (deviceId: string) => Position | undefined,
  visible: (group: Group) => boolean = () => true,
): Frame[] {
  const tree = hostTree(t);
  const placed = (id: string) => t.devices.has(id) && positionOf(id) !== undefined;
  /** 機器と、その上で動くゲスト(座標のあるものだけ) */
  const withGuests = (id: string) => [id, ...guestsBelow(tree, id).filter(placed)];

  type Entry = { frame: GroupFrame | HostFrame; order: number; members: Set<string> };
  const box = { x: 0, y: 0, width: 0, height: 0, inner: 0, members: [] };
  const drawable: Entry[] = [];
  t.groups.forEach((group, index) => {
    if (!visible(group)) return;
    const members = new Set([...new Set(group.members)].filter(placed).flatMap(withGuests));
    if (members.size > 0) {
      drawable.push({ frame: { ...box, type: "group", index, group }, order: index, members });
    }
  });
  for (const [host, guests] of tree.guestsOf) {
    const shown = guests.filter(placed);
    if (!placed(host) || shown.length === 0) continue;
    drawable.push({
      frame: { ...box, type: "host", host, guests: shown },
      order: t.groups.length + drawable.length,
      members: new Set(withGuests(host)),
    });
  }

  /** b が a の内側にあるか */
  const inside = (b: Entry, a: Entry) =>
    a !== b &&
    [...b.members].every((id) => a.members.has(id)) &&
    (b.members.size < a.members.size || a.order < b.order);
  const innerOf = new Map<Entry, number>();
  const inner = (a: Entry): number => {
    const known = innerOf.get(a);
    if (known !== undefined) return known;
    const depth = Math.max(-1, ...drawable.filter((b) => inside(b, a)).map(inner)) + 1;
    innerOf.set(a, depth);
    return depth;
  };

  const frames = drawable.map((entry) => {
    const { frame, members } = entry;
    const positions = [...members].map((id) => positionOf(id) as Position);
    const left = Math.min(...positions.map((p) => p.x));
    const top = Math.min(...positions.map((p) => p.y));
    const right = Math.max(...positions.map((p) => p.x + DEVICE_BOX.width));
    const bottom = Math.max(...positions.map((p) => p.y + DEVICE_BOX.height));
    const depth = inner(entry);
    const pad = GROUP_PADDING + GROUP_NEST_GAP * depth;
    // 上は、内側の枠のラベルの帯よりさらに上に、自分のラベルの帯を取る
    const labelSpace = GROUP_LABEL_BAND * (depth + 1);
    return {
      order: entry.order,
      frame: {
        ...frame,
        x: left - pad,
        y: top - pad - labelSpace,
        width: right - left + pad * 2,
        height: bottom - top + pad * 2 + labelSpace,
        inner: depth,
        members: [...members],
      },
    };
  });
  return frames
    .sort((a, b) => b.frame.inner - a.frame.inner || a.order - b.order)
    .map((f) => f.frame);
}
