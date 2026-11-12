import { describe, expect, it } from "vitest";
import {
  addGroup,
  addGroupMembers,
  checkGroupId,
  checkNetworkName,
  findGroup,
  groupsOfDevice,
  nextGroupId,
  removeGroup,
  removeGroupMembers,
  removeGroupNetwork,
  setGroupNetwork,
  updateGroup,
} from "./groups";
import { createEmptyTopology } from "./topology";
import type { Group, Topology } from "./types";

function withDevices(...ids: string[]): Topology {
  const t = createEmptyTopology();
  for (const id of ids)
    t.devices.set(id, { id, uid: `uid-${id}`, interfaces: new Map(), extra: {} });
  return t;
}

function group(t: Topology, uid: string): Group {
  const found = findGroup(t, uid);
  if (!found) throw new Error(`no group ${uid}`);
  return found;
}

describe("nextGroupId・checkGroupId", () => {
  it("group + 今ある最大の番号 + 1(空き番号は使わない)", () => {
    const t = createEmptyTopology();
    expect(nextGroupId(t)).toBe("group1");
    t.groups.push(
      { id: "group1", uid: "a", members: [], extra: {} },
      { id: "group3", uid: "b", members: [], extra: {} },
      { id: "rack9", uid: "c", members: [], extra: {} },
    );
    expect(nextGroupId(t)).toBe("group4");
  });

  it("空・書き方・重複を確かめる(今の自分の ID はよい)", () => {
    const t = createEmptyTopology();
    t.groups.push({ id: "rack1", uid: "a", members: [], extra: {} });
    expect(checkGroupId(t, "")).toBe("ID を入力してください");
    expect(checkGroupId(t, "-rack")).toBe("英数字で始まり、英数字と . _ - だけを使えます");
    expect(checkGroupId(t, "ラック")).toBe("英数字で始まり、英数字と . _ - だけを使えます");
    expect(checkGroupId(t, "rack1")).toBe("「rack1」は既に使われています");
    expect(checkGroupId(t, "rack1", "rack1")).toBeUndefined();
    expect(checkGroupId(t, "rack-2.a_b")).toBeUndefined();
  });
});

describe("addGroup・removeGroup", () => {
  it("種類なしのグループを最後に足す。メンバーはデバイスだけで、重なりは 1 つにする", () => {
    const t = withDevices("rt1", "sw1");
    t.groups.push({ id: "group1", uid: "old", members: [], extra: {} });
    const uid = addGroup(t, ["sw1", "rt1", "sw1", "pve1:vmbr0", "ghost"]);
    expect(t.groups.map((g) => g.id)).toEqual(["group1", "group2"]);
    expect(group(t, uid)).toEqual({ id: "group2", uid, members: ["sw1", "rt1"], extra: {} });
  });

  it("消してもメンバーの機器は残る", () => {
    const t = withDevices("rt1");
    const a = addGroup(t, ["rt1"]);
    const b = addGroup(t, ["rt1"]);
    removeGroup(t, a);
    expect(t.groups.map((g) => g.uid)).toEqual([b]);
    expect(t.devices.has("rt1")).toBe(true);
  });

  it("groupsOfDevice は、デバイスの入っているグループを順に返す", () => {
    const t = withDevices("rt1", "sw1");
    const a = addGroup(t, ["rt1", "sw1"]);
    addGroup(t, ["sw1"]);
    const c = addGroup(t, ["rt1"]);
    expect(groupsOfDevice(t, "rt1").map((g) => g.uid)).toEqual([a, c]);
  });
});

describe("updateGroup", () => {
  it("ID・種類・ラベルを変え、空のラベルと種類は消す", () => {
    const t = withDevices("rt1");
    const uid = addGroup(t, ["rt1"]);
    updateGroup(t, uid, { id: "rack1", kind: "rack", label: "Rack 1" });
    expect(group(t, uid)).toMatchObject({ id: "rack1", kind: "rack", label: "Rack 1" });
    updateGroup(t, uid, { kind: undefined, label: "" });
    expect(group(t, uid)).toEqual({ id: "rack1", uid, members: ["rt1"], extra: {} });
  });

  it("ID は空にしない", () => {
    const t = withDevices("rt1");
    const uid = addGroup(t, ["rt1"]);
    updateGroup(t, uid, { id: undefined });
    expect(group(t, uid).id).toBe("group1");
  });

  it("YAML で解釈できなかった値(extra)より、GUI で設定した値を優先する", () => {
    const t = withDevices("rt1");
    t.groups.push({ id: "g", uid: "g", members: [], extra: { kind: "floor", label: 3 } });
    updateGroup(t, "g", { kind: "site" });
    expect(group(t, "g")).toEqual({
      id: "g",
      uid: "g",
      kind: "site",
      members: [],
      extra: { label: 3 },
    });
  });
});

describe("メンバーを足す・外す", () => {
  it("入っているものとデバイスでない ID は飛ばして、最後に足す", () => {
    const t = withDevices("rt1", "sw1", "srv1");
    const uid = addGroup(t, ["sw1"]);
    addGroupMembers(t, uid, ["rt1", "sw1", "ghost", "srv1"]);
    expect(group(t, uid).members).toEqual(["sw1", "rt1", "srv1"]);
  });

  it("図に無いデバイスの ID も外せる", () => {
    const t = withDevices("rt1");
    t.groups.push({ id: "g", uid: "g", members: ["rt1", "ghost"], extra: {} });
    removeGroupMembers(t, "g", ["ghost"]);
    expect(group(t, "g").members).toEqual(["rt1"]);
  });
});

describe("クラスタのネットワーク", () => {
  it("足すと最後に、名前を変えると同じ位置に書く", () => {
    const t = withDevices("pve1");
    const uid = addGroup(t, ["pve1"]);
    setGroupNetwork(t, uid, "corosync", "10.10.0.0/24");
    setGroupNetwork(t, uid, "migration", "10.30.0.0/24");
    setGroupNetwork(t, uid, "ring0", "10.10.1.0/24", "corosync");
    expect([...(group(t, uid).networks ?? [])]).toEqual([
      ["ring0", "10.10.1.0/24"],
      ["migration", "10.30.0.0/24"],
    ]);
  });

  it("サブネットだけを変える。解釈できなかった networks(extra)は外す", () => {
    const t = withDevices("pve1");
    t.groups.push({ id: "lab", uid: "lab", members: [], extra: { networks: "bad" } });
    setGroupNetwork(t, "lab", "corosync", "10.10.0.0/24");
    setGroupNetwork(t, "lab", "corosync", "10.10.9.0/24");
    expect(group(t, "lab").extra).toEqual({});
    expect([...(group(t, "lab").networks ?? [])]).toEqual([["corosync", "10.10.9.0/24"]]);
  });

  it("消して無くなったら networks ごと消す", () => {
    const t = withDevices("pve1");
    const uid = addGroup(t, ["pve1"]);
    setGroupNetwork(t, uid, "corosync", "10.10.0.0/24");
    setGroupNetwork(t, uid, "migration", "10.30.0.0/24");
    removeGroupNetwork(t, uid, "corosync");
    expect([...(group(t, uid).networks ?? [])]).toEqual([["migration", "10.30.0.0/24"]]);
    removeGroupNetwork(t, uid, "migration");
    expect("networks" in group(t, uid)).toBe(false);
  });

  it("名前は空でなく、グループの中で重ならない", () => {
    const g: Group = {
      id: "lab",
      uid: "lab",
      members: [],
      networks: new Map([["corosync", "10.10.0.0/24"]]),
      extra: {},
    };
    expect(checkNetworkName(g, " ")).toBe("名前を入力してください");
    expect(checkNetworkName(g, "corosync")).toBe("「corosync」は既にあります");
    expect(checkNetworkName(g, "corosync", "corosync")).toBeUndefined();
    expect(checkNetworkName(g, "migration")).toBeUndefined();
  });
});
