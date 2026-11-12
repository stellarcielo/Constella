// グループの編集(SPEC 7.5)。作る・消す、ID・種類・ラベルを変える、メンバーを足す・外す、
// クラスタのネットワーク(SPEC 4.6)を変える。
// 引数のトポロジを直接書き換える(edit.ts と同じく、ストアでは Immer の produce の中で呼ぶ)。
// グループは内部の識別子(uid)で指す。ID は空や重複のこともあるため。

import { createUid, DEVICE_ID_PATTERN } from "./topology";
import type { Group, GroupKind, Topology } from "./types";

/** 新しいグループの ID のプレフィックス */
export const GROUP_ID_PREFIX = "group";

/** 種類の表示名(インスペクタの選択肢。枠のラベルの「ラック: 名前」とは別に、そのまま読める名前にする) */
export const GROUP_KIND_LABELS: Record<GroupKind, string> = {
  site: "拠点",
  rack: "ラック",
  vlan: "VLAN",
  subnet: "サブネット",
  as: "AS",
  cluster: "クラスタ",
  custom: "カスタム",
};

/** プレフィックス + 今ある最大の番号 + 1(デバイスID と同じく、削除した ID を使い回さない) */
export function nextGroupId(t: Topology): string {
  const pattern = new RegExp(`^${GROUP_ID_PREFIX}(\\d+)$`);
  let max = 0;
  for (const group of t.groups) {
    const m = pattern.exec(group.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${GROUP_ID_PREFIX}${max + 1}`;
}

/** グループの ID として使えるか。使えなければ理由を返す(currentId は今の自分の ID) */
export function checkGroupId(t: Topology, id: string, currentId?: string): string | undefined {
  if (id === "") return "ID を入力してください";
  if (!DEVICE_ID_PATTERN.test(id)) return "英数字で始まり、英数字と . _ - だけを使えます";
  if (id !== currentId && t.groups.some((g) => g.id === id)) return `「${id}」は既に使われています`;
  return undefined;
}

export function findGroup(t: Topology, uid: string): Group | undefined {
  return t.groups.find((g) => g.uid === uid);
}

/** デバイスの入っているグループ(groups の順) */
export function groupsOfDevice(t: Topology, deviceId: string): Group[] {
  return t.groups.filter((g) => g.members.includes(deviceId));
}

/**
 * 種類なしのグループを groups の最後に足し、その uid を返す。メンバーはデバイスだけ
 * (ブリッジの箱などデバイスでない ID と、重なった ID は入れない)
 */
export function addGroup(t: Topology, members: Iterable<string>): string {
  const group: Group = {
    id: nextGroupId(t),
    uid: createUid(),
    members: [...new Set(members)].filter((id) => t.devices.has(id)),
    extra: {},
  };
  t.groups.push(group);
  return group.uid;
}

/** グループを消す。メンバーの機器は残す */
export function removeGroup(t: Topology, uid: string): void {
  t.groups = t.groups.filter((g) => g.uid !== uid);
}

export type GroupChanges = Partial<Pick<Group, "id" | "kind" | "label">>;

/**
 * ID・種類・ラベルを書き換える。undefined・空文字は「消す」(ID は消さない)。
 * GUI で設定した項目は、YAML で解釈できなかった値(extra)より優先して extra から外す
 */
export function updateGroup(t: Topology, uid: string, changes: GroupChanges): void {
  const group = findGroup(t, uid);
  if (!group) return;
  for (const [key, value] of Object.entries(changes)) {
    Reflect.deleteProperty(group.extra, key);
    if (key === "id") group.id = typeof value === "string" ? value : group.id;
    else if (value === undefined || value === "") Reflect.deleteProperty(group, key);
    else Reflect.set(group, key, value);
  }
}

/** メンバーを最後に足す(入っているものと、デバイスでない ID は飛ばす) */
export function addGroupMembers(t: Topology, uid: string, ids: Iterable<string>): void {
  const group = findGroup(t, uid);
  if (!group) return;
  for (const id of ids) {
    if (t.devices.has(id) && !group.members.includes(id)) group.members.push(id);
  }
}

/** メンバーから外す(図に無いデバイスの ID も外せる) */
export function removeGroupMembers(t: Topology, uid: string, ids: Iterable<string>): void {
  const group = findGroup(t, uid);
  if (!group) return;
  const removed = new Set(ids);
  if (group.members.some((m) => removed.has(m))) {
    group.members = group.members.filter((m) => !removed.has(m));
  }
}

/** ネットワークの名前として使えるか(グループの中で重ならない、空でない)。使えなければ理由を返す */
export function checkNetworkName(
  group: Group,
  name: string,
  currentName?: string,
): string | undefined {
  if (name.trim() === "") return "名前を入力してください";
  if (name !== currentName && group.networks?.has(name)) return `「${name}」は既にあります`;
  return undefined;
}

/**
 * クラスタのネットワークを書く。oldName を渡すと、その行の名前を変える(並び順はそのまま)。
 * 無い名前なら最後に足す。サブネットの書き方はここでは確かめない(検証で警告になる)
 */
export function setGroupNetwork(
  t: Topology,
  uid: string,
  name: string,
  subnet: string,
  oldName?: string,
): void {
  const group = findGroup(t, uid);
  if (!group) return;
  Reflect.deleteProperty(group.extra, "networks");
  const from = oldName ?? name;
  const entries = [...(group.networks ?? [])];
  const i = entries.findIndex(([n]) => n === from);
  if (i >= 0) entries[i] = [name, subnet];
  else entries.push([name, subnet]);
  group.networks = new Map(entries);
}

/** クラスタのネットワークを消す。無くなったら networks ごと消す */
export function removeGroupNetwork(t: Topology, uid: string, name: string): void {
  const group = findGroup(t, uid);
  if (!group?.networks?.has(name)) return;
  const networks = new Map(group.networks);
  networks.delete(name);
  if (networks.size > 0) group.networks = networks;
  else delete group.networks;
}
