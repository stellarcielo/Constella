import { describe, expect, it } from "vitest";
import {
  allBridges,
  changeHost,
  endpointNodeId,
  findHostBridge,
  hostBridges,
  hostChangeImpact,
  parseVnetKey,
  removeBridges,
  resolveBridgeKey,
  vnetsShownOn,
  vnetUplinkTarget,
} from "./bridges";
import { removeDevices, renameDevice } from "./edit";
import { parseTopology } from "./parse";
import { findVnet, hostVnets, vnetTagText, zoneHosts } from "./sdn";
import { testCatalog } from "./testFixtures";
import type { Device, SdnZone, Topology } from "./types";

const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  pve3: { model: generic-hypervisor-4 }
  srv1: { model: generic-server-2 }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve2 }
links:
  - { a: vm1:net0, b: pve1:vnet10 }
  - { a: pve2:VNET20, b: vm2:net0 }
layout:
  pve2:vnet10: { x: 0, y: 100 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0, nodes: [ pve1, pve2 ] }
    qz: { type: qinq, bridge: vmbr0, tag: 100 }
    vx: { type: vxlan }
    iso: { type: simple }
  vnets:
    vnet10: { zone: lan, tag: 10, subnets: [ 10.10.0.0/24 ] }
    vnet20: { zone: qz, tag: 20 }
    vxnet: { zone: vx, tag: 5000 }
    isonet: { zone: iso }
`;

function load(): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

function device(t: Topology, id: string): Device {
  const d = t.devices.get(id);
  if (!d) throw new Error(id);
  return d;
}

function zone(t: Topology, id: string): SdnZone {
  const z = t.sdn.zones.get(id);
  if (!z) throw new Error(id);
  return z;
}

describe("SDN のゾーンと VNet(SPEC 4.6)", () => {
  it("IF 名が VNet なら、sdn に書いた表記の VNet ID。同じ名前の IF があれば、そちらを優先する", () => {
    const t = load();
    expect(findVnet(t, device(t, "pve1"), "vnet10")).toBe("vnet10");
    expect(findVnet(t, device(t, "pve1"), "VNET10")).toBe("vnet10");
    expect(findVnet(t, device(t, "pve1"), "vmbr0")).toBeUndefined();
    expect(findVnet(t, undefined, "vnet10")).toBeUndefined();
    device(t, "pve3").interfaces.set("isonet", { extra: {} });
    expect(findVnet(t, device(t, "pve3"), "isonet")).toBeUndefined();
  });

  it("ゾーンのホストは nodes(図にあるもの)、省略時はロールが hypervisor の機器すべて", () => {
    const t = load();
    expect(zoneHosts(t, zone(t, "lan"), testCatalog)).toEqual(["pve1", "pve2"]);
    expect(zoneHosts(t, zone(t, "qz"), testCatalog)).toEqual(["pve1", "pve2", "pve3"]);
    zone(t, "lan").nodes = ["pve1", "ghost", "pve1"];
    expect(zoneHosts(t, zone(t, "lan"), testCatalog)).toEqual(["pve1"]);
  });

  it("ホストで使える VNet は、ホストが入っているゾーンの VNet(sdn に書いた順)", () => {
    const t = load();
    expect(hostVnets(t, "pve1", testCatalog)).toEqual(["vnet10", "vnet20", "vxnet", "isonet"]);
    expect(hostVnets(t, "pve3", testCatalog)).toEqual(["vnet20", "vxnet", "isonet"]);
    expect(hostVnets(t, "srv1", testCatalog)).toEqual([]);
  });

  it("箱の下に出す tag の行は、ゾーンの種類で書き方を変える", () => {
    const t = load();
    t.sdn.zones.set("ev", { type: "evpn", extra: {} });
    t.sdn.vnets.set("evnet", { zone: "ev", tag: 7, extra: {} });
    expect(["vnet10", "vnet20", "vxnet", "evnet", "isonet"].map((v) => vnetTagText(t, v))).toEqual([
      "VLAN 10",
      "VLAN 20(外側 100)",
      "VXLAN 5000",
      "EVPN 7",
      undefined,
    ]);
    delete zone(t, "qz").tag;
    expect(vnetTagText(t, "vnet20")).toBe("VLAN 20");
  });
});

describe("VNet の箱(フェーズ4-6 Q1)", () => {
  it("ゲストがつながっているホストと、位置を覚えているホストにだけ描く", () => {
    const t = load();
    expect(vnetsShownOn(t, "pve1")).toEqual(["vnet10"]);
    expect(vnetsShownOn(t, "pve2")).toEqual(["vnet10", "vnet20"]);
    expect(vnetsShownOn(t, "pve3")).toEqual([]);
    expect(hostBridges(t, "pve2")).toEqual(["vmbr0", "vnet10", "vnet20"]);
    expect(allBridges(t).filter((b) => b.vnet)).toEqual([
      { key: "pve1:vnet10", host: "pve1", bridge: "vnet10", vnet: true },
      { key: "pve2:vnet10", host: "pve2", bridge: "vnet10", vnet: true },
      { key: "pve2:vnet20", host: "pve2", bridge: "vnet20", vnet: true },
    ]);
  });

  it("リンクの IF 名は VNet ID の表記にそろえ、リンクは VNet の箱につなぐ", () => {
    const t = load();
    expect(t.links[1].a).toEqual({ device: "pve2", iface: "vnet20" });
    expect(endpointNodeId(t, { device: "pve1", iface: "vnet10" })).toBe("pve1:vnet10");
    expect(endpointNodeId(t, { device: "vm1", iface: "net0" })).toBe("vm1");
  });

  it("箱の ID。描いていない VNet の箱は無いものとする", () => {
    const t = load();
    expect(findHostBridge(t, "pve3", "vnet10")).toBe("vnet10");
    expect(resolveBridgeKey(t, "pve3:vnet10")).toBeUndefined();
    expect(resolveBridgeKey(t, "pve1:VNET10")).toBe("pve1:vnet10");
    expect(parseVnetKey(t, "pve1:vnet10")).toEqual({ host: "pve1", vnet: "vnet10" });
    expect(parseVnetKey(t, "pve1:vmbr0")).toBeUndefined();
    expect(parseVnetKey(t, "pve3:vnet10")).toBeUndefined();
  });

  it("点線の先は、vlan・qinq ならゾーンのブリッジの箱、vxlan・evpn ならホスト、simple は無し", () => {
    const t = load();
    expect(vnetUplinkTarget(t, "pve1", "vnet10")).toBe("pve1:vmbr0");
    expect(vnetUplinkTarget(t, "pve2", "vnet20")).toBe("pve2:vmbr0");
    // ホストにゾーンのブリッジが無ければ引かない(エラーで知らせる)
    expect(vnetUplinkTarget(t, "pve3", "vnet20")).toBeUndefined();
    expect(vnetUplinkTarget(t, "pve1", "vxnet")).toBe("pve1");
    expect(vnetUplinkTarget(t, "pve1", "isonet")).toBeUndefined();
  });

  it("箱を消すと、そのホストのリンクと位置だけを消し、VNet の定義は残す(Q4)", () => {
    const t = load();
    removeBridges(t, ["pve1:vnet10", "pve2:vnet10"]);
    expect(t.links.map((l) => `${l.a?.device}:${l.a?.iface}`)).toEqual(["pve2:vnet20"]);
    expect(t.layout.has("pve2:vnet10")).toBe(false);
    expect(t.sdn.vnets.has("vnet10")).toBe(true);
    expect(
      allBridges(t)
        .filter((b) => b.vnet)
        .map((b) => b.key),
    ).toEqual(["pve2:vnet20"]);
  });

  it("ゲストのホストを変えると、VNet へのリンクは新しいホストの同じ VNet へ付け替える", () => {
    const t = load();
    expect(hostChangeImpact(t, "vm1", "pve3")).toEqual({ moved: [t.links[0]], lost: [] });
    changeHost(t, "vm1", "pve3", { removeLost: true });
    expect(t.links[0].b).toEqual({ device: "pve3", iface: "vnet10" });
  });
});

describe("デバイスID の変更・削除で、ゾーンの nodes も書き換える(SPEC 7.1・7.4)", () => {
  it("ID を変えると nodes も変え、消すと nodes から外す", () => {
    const t = load();
    renameDevice(t, "pve1", "pve-a");
    expect(zone(t, "lan").nodes).toEqual(["pve-a", "pve2"]);
    expect(t.layout.has("pve2:vnet10")).toBe(true);
    removeDevices(t, ["pve2"]);
    expect(zone(t, "lan").nodes).toEqual(["pve-a"]);
    expect(t.layout.has("pve2:vnet10")).toBe(false);
  });
});
