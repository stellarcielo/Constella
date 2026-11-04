import { describe, expect, it } from "vitest";
import {
  addBond,
  addVlanInterface,
  bondOf,
  bridgeIpLines,
  checkLogicalIfName,
  findLogicalIf,
  hostIpLines,
  logicalIfsOf,
  memberOwner,
  nextLogicalIfName,
  removeLogicalIf,
  renameLogicalIf,
  uplinkLabelLines,
  vlanInterface,
} from "./logicalIfs";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Device, Topology } from "./types";

const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ], bond-mode: 802.3ad }
      bond1: { type: bond, members: [ eno3 ], ip: [ 10.20.0.11/24 ] }
      vmbr0: { type: bridge, members: [ bond0 ], vlan-aware: true, ip: [ 192.168.1.2/24 ] }
      vmbr0.10: { type: vlan, ip: [ 192.168.10.2/24 ] }
      vlan30: { type: vlan, vlan-raw-device: bond1, ip: [ 10.30.0.11/24 ] }
      eno4: { description: 予備 }
  sw1: { model: generic-l2switch-24 }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: pve1:vmbr0.10, b: sw1:Gi0/2 }
`;

function load(): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

function pve1(t: Topology): Device {
  const device = t.devices.get("pve1");
  if (!device) throw new Error();
  return device;
}

describe("論理的な IF の一覧と関係", () => {
  it("種類ごとの一覧と、長い名前・大文字小文字を問わない検索", () => {
    const device = pve1(load());
    expect(logicalIfsOf(device, "bond")).toEqual(["bond0", "bond1"]);
    expect(logicalIfsOf(device, "vlan")).toEqual(["vmbr0.10", "vlan30"]);
    expect(findLogicalIf(device, "BOND0")?.name).toBe("bond0");
    expect(findLogicalIf(device, "eno4")).toBeUndefined();
  });

  it("members に書いている IF と、束ねている bond", () => {
    const device = pve1(load());
    expect(memberOwner(device, "eno1")).toBe("bond0");
    expect(memberOwner(device, "bond0")).toBe("vmbr0");
    expect(memberOwner(device, "eno1", "bond0")).toBeUndefined();
    expect(bondOf(device, "eno2")).toBe("bond0");
    // ブリッジに入っているだけなら bond ではない
    expect(bondOf(device, "bond0")).toBeUndefined();
    expect(bondOf(device, "eno4")).toBeUndefined();
  });
});

describe("vlanInterface", () => {
  it("vlan-raw-device と vlan が無ければ、名前から親と VLAN ID を決める", () => {
    expect(vlanInterface("vmbr0.10", { extra: {} })).toEqual({ parent: "vmbr0", vid: 10 });
    expect(vlanInterface("bond0.20.30", { extra: {} })).toEqual({ parent: "bond0.20", vid: 30 });
    expect(vlanInterface("vlan30", { vlanRawDevice: "bond1", extra: {} })).toEqual({
      parent: "bond1",
      vid: 30,
    });
    expect(vlanInterface("vmbr0.10", { vlanRawDevice: "bond0", vlan: 20, extra: {} })).toEqual({
      parent: "bond0",
      vid: 20,
    });
    expect(vlanInterface("mgmt", { extra: {} })).toEqual({ parent: undefined, vid: undefined });
  });
});

describe("論理的な IF の追加・名前・削除", () => {
  it("名前の採番と、名前として使えるか", () => {
    const device = pve1(load());
    expect(nextLogicalIfName(device, "bond", testCatalog)).toBe("bond2");
    expect(checkLogicalIfName(device, "eno1", testCatalog)).toContain("既に使われています");
    expect(checkLogicalIfName(device, "BOND0", testCatalog, "bond0")).toBeUndefined();
  });

  it("bond を足す。VLAN インターフェースは「親.VLAN ID」で、使われていない番号にする", () => {
    const t = load();
    expect(addBond(t, "pve1", testCatalog)).toBe("bond2");
    expect(pve1(t).interfaces.get("bond2")).toEqual({ type: "bond", extra: {} });
    expect(addVlanInterface(t, "pve1", "vmbr0", testCatalog)).toBe("vmbr0.11");
    // 名前は略称にそろえない(vlan5 を Vl5 にしない)
    expect(addVlanInterface(t, "pve1", "vlan5", testCatalog)).toBe("vlan5.10");
    expect(addBond(t, "ghost", testCatalog)).toBeUndefined();
  });

  it("名前を変えると、リンク・members・vlan-raw-device も書き換え、IF の順序は保つ", () => {
    const t = load();
    expect(renameLogicalIf(t, "pve1", "bond1", "bond9")).toBe("bond9");
    const device = pve1(t);
    expect([...device.interfaces.keys()].slice(0, 3)).toEqual(["bond0", "bond9", "vmbr0"]);
    expect(device.interfaces.get("vlan30")?.vlanRawDevice).toBe("bond9");
    renameLogicalIf(t, "pve1", "vmbr0.10", "vmbr0.11");
    expect(t.links[1].a).toEqual({ device: "pve1", iface: "vmbr0.11" });
    renameLogicalIf(t, "pve1", "bond0", "lag0");
    expect(device.interfaces.get("vmbr0")?.members).toEqual(["lag0"]);
  });

  it("消すと、つながっていたリンクと、ほかの IF の members からも消える", () => {
    const t = load();
    removeLogicalIf(t, "pve1", "bond0");
    removeLogicalIf(t, "pve1", "vmbr0.10");
    const device = pve1(t);
    expect(device.interfaces.has("bond0")).toBe(false);
    expect(device.interfaces.get("vmbr0")).not.toHaveProperty("members");
    expect(t.links).toHaveLength(1);
  });
});

describe("ラベル(フェーズ4-3 Q1・Q2)", () => {
  it("ブリッジの箱の下には、ブリッジの IP と、ブリッジの上の VLAN インターフェースの IP", () => {
    expect(bridgeIpLines(pve1(load()), "vmbr0")).toEqual([
      "192.168.1.2/24",
      "vmbr0.10 192.168.10.2/24",
    ]);
  });

  it("ホストの名前の下には、bond の IP と、ブリッジ以外の上の VLAN インターフェースの IP", () => {
    expect(hostIpLines(pve1(load()))).toEqual(["bond1 10.20.0.11/24", "vlan30 10.30.0.11/24"]);
  });

  it("IP の書き方を渡すと、どの IP の行にも使う(クラスタのネットワークの名前。フェーズ4-5)", () => {
    const mark = (ip: string) => `${ip} (net)`;
    expect(bridgeIpLines(pve1(load()), "vmbr0", mark)).toEqual([
      "192.168.1.2/24 (net)",
      "vmbr0.10 192.168.10.2/24 (net)",
    ]);
    expect(hostIpLines(pve1(load()), mark)).toEqual([
      "bond1 10.20.0.11/24 (net)",
      "vlan30 10.30.0.11/24 (net)",
    ]);
  });

  it("ブリッジとホストの間の線は、members の下に bond の中身とモード", () => {
    const device = pve1(load());
    expect(uplinkLabelLines(device, "vmbr0")).toEqual(["bond0", "eno1 + eno2(802.3ad)"]);
    expect(uplinkLabelLines(device, "vmbr0", (n) => n.toUpperCase())).toEqual([
      "BOND0",
      "ENO1 + ENO2(802.3ad)",
    ]);
    device.interfaces.set("vmbr1", { type: "bridge", extra: {} });
    expect(uplinkLabelLines(device, "vmbr1")).toEqual([]);
  });
});
