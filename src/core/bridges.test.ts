import { describe, expect, it } from "vitest";
import {
  addBridge,
  allBridges,
  bridgeKey,
  bridgeLinks,
  bridgesOf,
  changeHost,
  checkBridgeName,
  endpointNodeId,
  findBridge,
  hostChangeImpact,
  nextBridgeName,
  parseBridgeKey,
  removeBridges,
  renameBridge,
  resolveBridgeKey,
} from "./bridges";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true }
      vmbr1: { type: bridge }
      vmbr0.10: { type: vlan, vlan-raw-device: vmbr0 }
      eno2: { description: mgmt }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve1 }
links:
  - { a: vm1:net0, b: pve1:vmbr0 }
  - { a: pve1:vmbr1, b: vm1:net1 }
  - { a: vm2:net0, b: pve1:vmbr0 }
  - { a: pve1:eno1, b: pve2:eno1 }
layout:
  pve1:vmbr0: { x: 10, y: 20 }
`;

function load(): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("ブリッジの箱の ID", () => {
  it("「ホストのデバイスID:ブリッジ名」で作り、最初の : で分ける", () => {
    expect(bridgeKey("pve1", "vmbr0")).toBe("pve1:vmbr0");
    expect(parseBridgeKey("pve1:vmbr0")).toEqual({ host: "pve1", bridge: "vmbr0" });
    expect(parseBridgeKey("pve1")).toBeUndefined();
    expect(parseBridgeKey(":vmbr0")).toBeUndefined();
    expect(parseBridgeKey("pve1:")).toBeUndefined();
  });

  it("あるブリッジだけを、表記をそろえて返す", () => {
    const t = load();
    expect(resolveBridgeKey(t, "pve1:VMBR0")).toBe("pve1:vmbr0");
    expect(resolveBridgeKey(t, "pve1:eno2")).toBeUndefined();
    expect(resolveBridgeKey(t, "pve9:vmbr0")).toBeUndefined();
  });
});

describe("ブリッジの一覧", () => {
  it("type: bridge の IF を YAML の順に返す", () => {
    const t = load();
    expect(bridgesOf(t.devices.get("pve1"))).toEqual(["vmbr0", "vmbr1"]);
    expect(findBridge(t.devices.get("pve1"), "VMBR1")).toBe("vmbr1");
    expect(findBridge(t.devices.get("pve1"), "vmbr0.10")).toBeUndefined();
    expect(allBridges(t).map((b) => b.key)).toEqual(["pve1:vmbr0", "pve1:vmbr1", "pve2:vmbr0"]);
  });

  it("エンドポイントを描く箱。ブリッジならその箱、それ以外はデバイス", () => {
    const t = load();
    expect(endpointNodeId(t, { device: "pve1", iface: "vmbr0" })).toBe("pve1:vmbr0");
    expect(endpointNodeId(t, { device: "pve1", iface: "eno1" })).toBe("pve1");
    expect(endpointNodeId(t, { device: "vm1", iface: "net0" })).toBe("vm1");
  });

  it("ブリッジにつながるリンク", () => {
    const t = load();
    expect(bridgeLinks(t, "pve1", "vmbr0").map((l) => l.a?.device)).toEqual(["vm1", "vm2"]);
    expect(bridgeLinks(t, "pve2", "vmbr0")).toEqual([]);
  });
});

describe("ブリッジの追加・名前・削除", () => {
  it("名前は vmbr0 から、使われていない番号を付ける", () => {
    const t = load();
    expect(nextBridgeName(t.devices.get("pve1") ?? fail(), testCatalog)).toBe("vmbr2");
    expect(nextBridgeName(t.devices.get("vm1") ?? fail(), testCatalog)).toBe("vmbr0");
  });

  it("名前として使えるか", () => {
    const pve1 = load().devices.get("pve1") ?? fail();
    expect(checkBridgeName(pve1, "", testCatalog)).toBe("名前を入力してください");
    expect(checkBridgeName(pve1, "br 0", testCatalog)).toContain("空白");
    expect(checkBridgeName(pve1, "vmbr1", testCatalog)).toContain("既に使われています");
    expect(checkBridgeName(pve1, "eno3", testCatalog)).toContain("既に使われています");
    expect(checkBridgeName(pve1, "VMBR0", testCatalog, "vmbr0")).toBeUndefined();
    expect(checkBridgeName(pve1, "vmbr9", testCatalog)).toBeUndefined();
  });

  it("追加すると、type: bridge の IF と、渡した位置ができる", () => {
    const t = load();
    expect(addBridge(t, "pve2", testCatalog, { x: 1.4, y: 2.6 })).toBe("vmbr1");
    expect(t.devices.get("pve2")?.interfaces.get("vmbr1")).toEqual({ type: "bridge", extra: {} });
    expect(t.layout.get("pve2:vmbr1")).toEqual({ x: 1, y: 3 });
    expect(addBridge(t, "ghost", testCatalog)).toBeUndefined();
  });

  it("消すと、つながっていたリンク・位置・ほかの IF の members からも消える", () => {
    const t = load();
    const pve1 = t.devices.get("pve1") ?? fail();
    pve1.interfaces.set("bond0", { type: "bond", members: ["vmbr0"], extra: {} });
    removeBridges(t, ["pve1:vmbr0", "pve9:vmbr0", "nonsense"]);
    expect(bridgesOf(pve1)).toEqual(["vmbr1"]);
    expect(t.links.map((l) => [l.a?.device, l.b?.device])).toEqual([
      ["pve1", "vm1"],
      ["pve1", "pve2"],
    ]);
    expect(t.layout.has("pve1:vmbr0")).toBe(false);
    expect(pve1.interfaces.get("bond0")).not.toHaveProperty("members");
  });

  it("名前を変えると、IF の順序を保ち、リンク・位置・vlan-raw-device も書き換える", () => {
    const t = load();
    renameBridge(t, "pve1", "vmbr0", "vmbr5");
    const pve1 = t.devices.get("pve1") ?? fail();
    expect([...pve1.interfaces.keys()]).toEqual(["vmbr5", "vmbr1", "vmbr0.10", "eno2"]);
    expect(pve1.interfaces.get("vmbr0.10")?.vlanRawDevice).toBe("vmbr5");
    expect(bridgeLinks(t, "pve1", "vmbr5")).toHaveLength(2);
    expect(t.layout.get("pve1:vmbr5")).toEqual({ x: 10, y: 20 });
    expect(t.layout.has("pve1:vmbr0")).toBe(false);
  });
});

describe("ゲストのホストを変える(フェーズ4-2 Q2)", () => {
  it("同じ名前のブリッジがあれば付け替え、無ければ消えるリンクとして知らせる", () => {
    const t = load();
    const impact = hostChangeImpact(t, "vm1", "pve2");
    expect(impact.moved.map((l) => l.b?.iface ?? l.a?.iface)).toEqual(["vmbr0"]);
    expect(impact.lost.map((l) => l.a?.iface)).toEqual(["vmbr1"]);
    expect(hostChangeImpact(t, "vm1", undefined).lost).toHaveLength(2);
    expect(hostChangeImpact(t, "vm2", "pve2").lost).toEqual([]);
  });

  it("消さない場合は、付け替えられないリンクを残す(検証でエラーになる)", () => {
    const t = load();
    changeHost(t, "vm1", "pve2", { removeLost: false });
    expect(t.devices.get("vm1")?.host).toBe("pve2");
    expect(t.links[0].b).toEqual({ device: "pve2", iface: "vmbr0" });
    expect(t.links[1].a).toEqual({ device: "pve1", iface: "vmbr1" });
  });

  it("消す場合は、付け替えられないリンクを消す。ホストなしにもできる", () => {
    const t = load();
    changeHost(t, "vm1", "pve2", { removeLost: true });
    expect(t.links).toHaveLength(3);
    changeHost(t, "vm2", undefined, { removeLost: true });
    expect(t.devices.get("vm2")).not.toHaveProperty("host");
    expect(t.links.some((l) => l.a?.device === "vm2")).toBe(false);
  });
});

function fail(): never {
  throw new Error("見つかりません");
}
