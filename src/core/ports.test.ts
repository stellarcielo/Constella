import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import {
  allowsManyLinks,
  bondMemberCandidates,
  bridgeMemberCandidates,
  buildPortUsage,
  canonicalIfName,
  firstFreePort,
  listDevicePorts,
  portTypesCompatible,
  vlanParentCandidates,
} from "./ports";
import { specExample, testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

/** AP の無線に 2 台つないだ図 */
const wireless = `constella: 1
devices:
  ap1: { model: generic-ap }
  sw1: { model: generic-l2switch-24 }
  pc1: { role: pc }
  pc2: { role: pc }
links:
  - a: ap1:eth0
    b: sw1:Gi0/1
  - a: ap1:wlan0
    b: pc1:wlan0
  - a: pc2:wlan0
    b: ap1:wlan0
`;

function device(t: Topology, id: string) {
  const d = t.devices.get(id);
  if (!d) throw new Error(id);
  return d;
}

describe("portTypesCompatible", () => {
  it("差し込み口が同じ種別は合う", () => {
    expect(portTypesCompatible("sfp", "sfp+")).toBe(true);
    expect(portTypesCompatible("qsfp+", "qsfp28")).toBe(true);
    expect(portTypesCompatible("rj45", "sfp+")).toBe(false);
  });
});

describe("buildPortUsage", () => {
  it("両端のポートと接続先を記録する", () => {
    const t = load(specExample);
    const usage = buildPortUsage(t);
    expect(usage.get("rt1")?.get("gi0/1")?.peer).toEqual({ device: "core-sw1", iface: "Gi0/1" });
    expect(usage.get("isp")?.get("wan")?.peer).toEqual({ device: "rt1", iface: "Gi0/0" });
    expect(usage.get("srv1")?.has("eth1")).toBe(false);
  });

  it("同じポートを使うリンクをすべて記録し、接続先は最初のリンクのもの", () => {
    const t = load(wireless);
    const use = buildPortUsage(t).get("ap1")?.get("wlan0");
    expect(use?.links).toEqual(t.links.slice(1).map((l) => l.id));
    expect(use?.peer).toEqual({ device: "pc1", iface: "wlan0" });
  });
});

describe("allowsManyLinks", () => {
  it("無線のポートだけ何本でもつなげる", () => {
    expect(allowsManyLinks("wireless")).toBe(true);
    expect(allowsManyLinks("rj45")).toBe(false);
    expect(allowsManyLinks("virtual")).toBe(false);
    expect(allowsManyLinks(undefined)).toBe(false);
  });
});

describe("listDevicePorts", () => {
  it("モデルのポートを定義順に並べ、使用状況を付ける", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "rt1"), t, testCatalog);
    expect(ports.map((p) => [p.name, p.type, p.use?.peer?.device])).toEqual([
      ["Gi0/0", "rj45", "isp"],
      ["Gi0/1", "rj45", "core-sw1"],
      ["Gi0/2", "rj45", undefined],
      ["Gi0/3", "rj45", undefined],
    ]);
  });

  it("モデルの長い名前は短い形で出す", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "core-sw1"), t, testCatalog);
    expect(ports[0]).toMatchObject({ name: "Fa0/1", type: "rj45", defined: true });
    expect(ports[0].use?.peer).toEqual({ device: "srv1", iface: "eth0" });
    expect(ports).toHaveLength(26);
  });

  it("フレキシブルデバイスは使われている IF を出てきた順に出す", () => {
    const t = load(`constella: 1
devices:
  isp:
    role: cloud
    interfaces:
      mgmt: {}
  rt1: { model: generic-router-4 }
links:
  - a: rt1:Gi0/0
    b: isp:wan
  - a: isp:wan2
    b: rt1:Gi0/1
`);
    const ports = listDevicePorts(device(t, "isp"), t, testCatalog);
    expect(ports.map((p) => [p.name, p.defined, p.use?.peer?.iface])).toEqual([
      ["mgmt", false, undefined],
      ["wan", false, "Gi0/0"],
      ["wan2", false, "Gi0/1"],
    ]);
  });

  it("作りかけの接続で押さえたポートは使用中にする(接続先なし)", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "rt1"), t, testCatalog, undefined, {
      device: "rt1",
      iface: "Gi0/2",
    });
    expect(ports[2].use).toEqual({ links: [] });
  });

  it("無線のポートは、つながっているリンクをすべて持つ", () => {
    const t = load(wireless);
    const ports = listDevicePorts(device(t, "ap1"), t, testCatalog);
    expect(ports.map((p) => [p.name, p.type, p.use?.links.length])).toEqual([
      ["eth0", "rj45", 1],
      ["wlan0", "wireless", 2],
    ]);
  });
});

describe("firstFreePort", () => {
  it("無線のポートも、1 本もつながっていないときだけ選ぶ", () => {
    const t = load(wireless);
    expect(firstFreePort(listDevicePorts(device(t, "ap1"), t, testCatalog))).toBeUndefined();
  });

  it("先頭の空いている定義済みポート", () => {
    const t = load(specExample);
    expect(firstFreePort(listDevicePorts(device(t, "rt1"), t, testCatalog))?.name).toBe("Gi0/2");
    expect(firstFreePort(listDevicePorts(device(t, "srv1"), t, testCatalog))?.name).toBe("eth1");
  });

  it("定義済みのポートが無ければ undefined(Q5)", () => {
    const t = load(specExample);
    expect(firstFreePort(listDevicePorts(device(t, "isp"), t, testCatalog))).toBeUndefined();
  });
});

describe("canonicalIfName", () => {
  it("モデルや既存の IF と同じなら、その表記に合わせる", () => {
    const t = load(specExample);
    expect(canonicalIfName(t, "core-sw1", "fastethernet0/3", testCatalog)).toBe("Fa0/3");
    expect(canonicalIfName(t, "isp", "WAN", testCatalog)).toBe("wan");
  });

  it("どれとも一致しなければ短い形にする", () => {
    const t = load(specExample);
    expect(canonicalIfName(t, "isp", "GigabitEthernet9/9", testCatalog)).toBe("Gi9/9");
    expect(canonicalIfName(t, "isp", " uplink ", testCatalog)).toBe("uplink");
  });
});

describe("ブリッジ(SPEC 4.6)", () => {
  const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ] }
      vmbr0: { type: bridge, members: [ bond0 ] }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve1 }
links:
  - { a: vm1:net0, b: pve1:vmbr0 }
  - { a: vm2:net0, b: pve1:vmbr0 }
`;

  it("ブリッジは使用中にせず、つながっているリンクの本数を添える", () => {
    const t = load(text);
    const entries = listDevicePorts(device(t, "pve1"), t, testCatalog);
    const vmbr0 = entries.find((e) => e.name === "vmbr0");
    expect(vmbr0).toEqual({ name: "vmbr0", defined: false, bridge: { links: 2 } });
    // 「次の空きポート」には選ばない
    expect(firstFreePort(entries)?.name).toBe("eno1");
  });

  it("members の候補は、物理的な IF と bond(ブリッジは除く)", () => {
    const t = load(text);
    expect(bridgeMemberCandidates(device(t, "pve1"), t, testCatalog)).toEqual([
      "eno1",
      "eno2",
      "eno3",
      "eno4",
      "bond0",
    ]);
  });
});

describe("bond・VLAN インターフェース(フェーズ4-3)", () => {
  const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ] }
      vmbr0: { type: bridge, members: [ bond0 ] }
      vmbr0.10: { type: vlan }
`;

  it("bond・VLAN インターフェースに印を付ける(ポート選択に出さない)", () => {
    const t = load(text);
    const entries = listDevicePorts(device(t, "pve1"), t, testCatalog);
    expect(entries.filter((e) => e.logical).map((e) => [e.name, e.logical])).toEqual([
      ["bond0", "bond"],
      ["vmbr0.10", "vlan"],
    ]);
  });

  it("bond の members の候補は物理的な IF だけ、VLAN の親の候補は VLAN インターフェース以外", () => {
    const t = load(text);
    const pve1 = device(t, "pve1");
    expect(bondMemberCandidates(pve1, t, testCatalog)).toEqual(["eno1", "eno2", "eno3", "eno4"]);
    expect(vlanParentCandidates(pve1, t, testCatalog)).toEqual([
      "eno1",
      "eno2",
      "eno3",
      "eno4",
      "bond0",
      "vmbr0",
    ]);
  });
});

describe("SDN の VNet(フェーズ4-6)", () => {
  const t = load(`constella: 1
devices:
  pve1: { model: generic-hypervisor-4, interfaces: { vmbr0: { type: bridge } } }
  srv1: { model: generic-server-2 }
  vm1: { model: generic-vm, host: pve1 }
links:
  - { a: vm1:net0, b: pve1:vnet30 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0 }
  vnets:
    vnet30: { zone: lan, tag: 30 }
    vnet40: { zone: lan, tag: 40 }
`);

  it("ゾーンのホストには、使える VNet をブリッジとして出し、VNet の印と本数を添える", () => {
    const bridges = listDevicePorts(device(t, "pve1"), t, testCatalog).filter((e) => e.bridge);
    expect(bridges).toEqual([
      { name: "vmbr0", defined: false, bridge: { links: 0 } },
      { name: "vnet30", defined: false, bridge: { links: 1, vnet: true } },
      { name: "vnet40", defined: false, bridge: { links: 0, vnet: true } },
    ]);
    expect(listDevicePorts(device(t, "srv1"), t, testCatalog).some((e) => e.bridge)).toBe(false);
  });
});
