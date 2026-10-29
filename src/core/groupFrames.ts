// グループの枠(SPEC 4.3・フェーズ3-1)。メンバーの機器を囲む四角を、機器の位置から計算する。
// キャンバスと SVG の書き出しで共有する。枠の位置は YAML に書かない(機器を動かせば枠も動く)。

import type { Group, GroupKind, Position, Topology } from "./types";

export interface GroupFrame {
  /** groups の中の位置(問題パネルの対象と同じ番号) */
  index: number;
  group: Group;
  /** 左上の座標と大きさ(機器の座標と同じ座標系) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 内側に入れ子になったグループの段数(0 = 入れ子が無い)。大きいほど外側 */
  inner: number;
  /** 枠で囲んだメンバー(座標のある機器だけ) */
  members: string[];
}

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
const NEST_GAP = 14;

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

/**
 * 枠を出す種類で絞り込む条件(表示レイヤー。フェーズ3-3)。種類なし・custom はいつも出す
 */
export function groupKindFilter(kinds: readonly GroupKind[]): (group: Group) => boolean {
  return (group) =>
    group.kind === undefined || group.kind === "custom" || kinds.includes(group.kind);
}

/**
 * グループの枠を、描く順(外側の枠が先)に返す。visible で絞り込んだグループだけを描き、
 * 隠したグループは入れ子の余白にも数えない。
 * ほかのグループのメンバーをすべて含むグループは、その外側に余白を足して入れ子に見せる(フェーズ3-1 Q3)。
 * メンバーが同じなら、YAML で先に書いたほうを外側にする。座標のあるメンバーが無いグループは描かない
 */
export function groupFrames(
  t: Topology,
  positionOf: (deviceId: string) => Position | undefined,
  visible: (group: Group) => boolean = () => true,
): GroupFrame[] {
  const drawable = t.groups.flatMap((group, index) => {
    if (!visible(group)) return [];
    const members = [...new Set(group.members)].filter(
      (id) => t.devices.has(id) && positionOf(id) !== undefined,
    );
    return members.length > 0 ? [{ group, index, members: new Set(members) }] : [];
  });

  /** b が a の内側にあるか */
  const inside = (b: (typeof drawable)[number], a: (typeof drawable)[number]) =>
    a !== b &&
    [...b.members].every((id) => a.members.has(id)) &&
    (b.members.size < a.members.size || a.index < b.index);
  const innerOf = new Map<number, number>();
  const inner = (a: (typeof drawable)[number]): number => {
    const known = innerOf.get(a.index);
    if (known !== undefined) return known;
    const depth = Math.max(-1, ...drawable.filter((b) => inside(b, a)).map(inner)) + 1;
    innerOf.set(a.index, depth);
    return depth;
  };

  const frames = drawable.map((entry): GroupFrame => {
    const { group, index, members } = entry;
    const positions = [...members].map((id) => positionOf(id) as Position);
    const left = Math.min(...positions.map((p) => p.x));
    const top = Math.min(...positions.map((p) => p.y));
    const right = Math.max(...positions.map((p) => p.x + DEVICE_BOX.width));
    const bottom = Math.max(...positions.map((p) => p.y + DEVICE_BOX.height));
    const depth = inner(entry);
    const pad = GROUP_PADDING + NEST_GAP * depth;
    // 上は、内側の枠のラベルの帯よりさらに上に、自分のラベルの帯を取る
    const labelSpace = GROUP_LABEL_BAND * (depth + 1);
    return {
      index,
      group,
      x: left - pad,
      y: top - pad - labelSpace,
      width: right - left + pad * 2,
      height: bottom - top + pad * 2 + labelSpace,
      inner: depth,
      members: [...members],
    };
  });
  return frames.sort((a, b) => b.inner - a.inner || a.index - b.index);
}
