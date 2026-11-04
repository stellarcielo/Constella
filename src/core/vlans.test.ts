import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import { endpointToString } from "./topology";
import {
  checkVlanList,
  formatVlanIds,
  parseVlanList,
  portVlanMode,
  vlanBlocks,
  vlanRangesHave,
} from "./vlans";

describe("vlans の書き方(SPEC 4.3)", () => {
  it(", ; 空白で区切り、範囲も書ける。小さい順にし、重なりと続きはまとめる", () => {
    expect(parseVlanList("10,20,100-110")).toEqual([
      [10, 10],
      [20, 20],
      [100, 110],
    ]);
    expect(parseVlanList("20;30")).toEqual([
      [20, 20],
      [30, 30],
    ]);
    expect(parseVlanList(" 30 10 - 12, 11;13 ")).toEqual([
      [10, 13],
      [30, 30],
    ]);
  });

  it("all はすべて、none はなし", () => {
    expect(parseVlanList("all")).toEqual([[1, 4094]]);
    expect(parseVlanList("ALL")).toEqual([[1, 4094]]);
    expect(parseVlanList("none")).toEqual([]);
  });

  it("読めない書き方と、1〜4094 の外は undefined", () => {
    for (const text of ["", " ", "10,x", "0", "4095", "1-4095", "20-10", "10-", "all,10"]) {
      expect(parseVlanList(text), text).toBeUndefined();
    }
    expect(checkVlanList("10,x")).toContain("書き方が分かりません");
    expect(checkVlanList("10,20")).toBeUndefined();
  });

  it("範囲に入っているか", () => {
    const ranges = parseVlanList("10,20-30") ?? [];
    expect([9, 10, 19, 20, 30, 31].map((v) => vlanRangesHave(ranges, v))).toEqual([
      false,
      true,
      false,
      true,
      true,
      false,
    ]);
  });

  it("VLAN ID を短く書く。3 つ以上続けば範囲にする", () => {
    expect(formatVlanIds([32, 10, 30, 31, 20, 21, 10])).toBe("10,20,21,30-32");
    expect(formatVlanIds([])).toBe("");
  });

  it("ポートの VLAN の扱い。mode が無くても vlans があれば trunk", () => {
    expect(portVlanMode({ mode: "trunk", extra: {} })).toBe("trunk");
    expect(portVlanMode({ vlans: "10", extra: {} })).toBe("trunk");
    expect(portVlanMode({ mode: "access", vlan: 10, extra: {} })).toBe("access");
    expect(portVlanMode({ mode: "routed", vlans: "10", extra: {} })).toBeUndefined();
    expect(portVlanMode({ vlan: 10, extra: {} })).toBeUndefined();
    expect(portVlanMode(undefined)).toBeUndefined();
  });
});

const head = `constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: "10,20" }
      Gi0/2: { mode: trunk }
      Gi0/3: { mode: access, vlan: 10 }
      Gi0/4: { vlans: "10" }
      Gi0/5: { mode: routed }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ] }
      vmbr0: { type: bridge, members: [ bond0 ], vlan-aware: true, vlans: "2-100" }
      vmbr1: { type: bridge, members: [ eno3 ] }
      vmbr2: { type: bridge, vlan-aware: true }
`;

const uplinks = `links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: pve1:eno2, b: sw1:Gi0/2 }
  - { a: pve1:eno3, b: sw1:Gi0/3 }
`;

/** 止まる場所を「場所 種類(vlans) 止まる VLAN ← 使っている IF=VLAN」の形で返す */
function blocks(devices: string, links: string): string[] {
  const result = parseTopology(`${head}${devices}${uplinks}${links}`, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return vlanBlocks(result.topology, testCatalog).map((b) => {
    const kind = b.allowed === undefined ? b.kind : `${b.kind}(${b.allowed})`;
    const uses = b.uses.map((u) => `${endpointToString(u.source)}=${formatVlanIds(u.vlans)}`);
    return `${endpointToString(b.at)} ${kind} ${formatVlanIds(b.vlans)} ← ${uses.join(" ")}`;
  });
}

describe("VLAN の通り道(SPEC 4.6・フェーズ4-4)", () => {
  it("問題が無ければ空", () => {
    expect(
      blocks(
        "  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 10 } } }\n",
        "  - { a: web01:net0, b: pve1:vmbr0 }\n",
      ),
    ).toEqual([]);
  });

  it("VLAN aware なブリッジの vlans(省略時は 2-4094)で止まった VLAN は、その先で確かめない", () => {
    expect(
      blocks(
        `  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 30 } } }
  db01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 200 } } }
  mon01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 1 } } }
`,
        `  - { a: web01:net0, b: pve1:vmbr0 }
  - { a: pve1:vmbr0, b: db01:net0 }
  - { a: mon01:net0, b: pve1:vmbr2 }
`,
      ),
    ).toEqual([
      // bond の 2 本のうち、Gi0/2 は trunk ですべて通す
      "sw1:Gi0/1 trunk(10,20) 30 ← web01:net0=30",
      "pve1:vmbr0 bridge(2-100) 200 ← db01:net0=200",
      "pve1:vmbr2 bridge(2-4094) 1 ← mon01:net0=1",
    ]);
  });

  it("VLAN aware でないブリッジは確かめずに進む。access のポートは、タグの付いた VLAN を通さない", () => {
    expect(
      blocks(
        `  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 10 } } }
  db01: { model: generic-vm, host: pve1 }
`,
        `  - { a: web01:net0, b: pve1:vmbr1 }
  - { a: db01:net0, b: pve1:vmbr1 }
`,
      ),
    ).toEqual(["sw1:Gi0/3 access 10 ← web01:net0=10"]);
  });

  it("ゲストの trunk の vlans も確かめる。すべて通す trunk は確かめない", () => {
    expect(
      blocks(
        `  fw01: { model: generic-vm, host: pve1, interfaces: { net0: { mode: trunk, vlans: "10,20,30-32" } } }
  fw02: { model: generic-vm, host: pve1, interfaces: { net0: { mode: trunk } } }
  fw03: { model: generic-vm, host: pve1, interfaces: { net0: { mode: trunk, vlans: all } } }
`,
        `  - { a: fw01:net0, b: pve1:vmbr0 }
  - { a: fw02:net0, b: pve1:vmbr0 }
  - { a: fw03:net0, b: pve1:vmbr0 }
`,
      ),
    ).toEqual(["sw1:Gi0/1 trunk(10,20) 30-32 ← fw01:net0=30-32"]);
  });

  it("相手のポートは、mode が無くても vlans があれば trunk。routed・何も無い・リンクが無ければ確かめない", () => {
    expect(
      blocks(
        `  pve2:
    model: generic-hypervisor-4
    interfaces:
      eno1.30: { type: vlan }
      eno2.30: { type: vlan }
      eno3.30: { type: vlan }
      eno4.30: { type: vlan }
`,
        `  - { a: pve2:eno1, b: sw1:Gi0/4 }
  - { a: pve2:eno2, b: sw1:Gi0/5 }
  - { a: pve2:eno3, b: sw1:Gi0/6 }
`,
      ),
    ).toEqual(["sw1:Gi0/4 trunk(10) 30 ← pve2:eno1.30=30"]);
  });

  it("VLAN インターフェースは親から。members の VLAN インターフェースの先と、二重のタグは確かめない", () => {
    expect(
      blocks(
        `  pve2:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1 ] }
      vmbr0: { type: bridge, members: [ bond0 ], vlan-aware: true, vlans: "2-100" }
      vmbr0.30: { type: vlan }
      vmbr0.200: { type: vlan }
      vmbr1: { type: bridge, members: [ bond0.50 ] }
      bond0.50: { type: vlan }
      bond0.50.70: { type: vlan }
      mgmt: { type: vlan, vlan-raw-device: eno3, vlan: 40 }
  sw2:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: "10,20" }
      Gi0/3: { mode: access, vlan: 40 }
  web01: { model: generic-vm, host: pve2, interfaces: { net0: { vlan: 60 } } }
`,
        `  - { a: pve2:eno1, b: sw2:Gi0/1 }
  - { a: pve2:eno3, b: sw2:Gi0/3 }
  - { a: web01:net0, b: pve2:vmbr1 }
`,
      ),
    ).toEqual([
      "sw2:Gi0/1 trunk(10,20) 30,50 ← pve2:vmbr0.30=30 pve2:bond0.50=50",
      "pve2:vmbr0 bridge(2-100) 200 ← pve2:vmbr0.200=200",
      "sw2:Gi0/3 access 40 ← pve2:mgmt=40",
    ]);
  });

  it("止まる場所ごとにまとめる。none の trunk は何も通さない。読めない vlans の場所は確かめない", () => {
    expect(
      blocks(
        `  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 30 } } }
  db01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 30 } } }
  mon01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 40 } } }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      eno1.10: { type: vlan }
      vmbr0: { type: bridge, members: [ eno2 ], vlan-aware: true, vlans: "abc" }
      vmbr0.10: { type: vlan }
  sw2:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: none }
      Gi0/2: { mode: trunk, vlans: "10,x" }
`,
        `  - { a: web01:net0, b: pve1:vmbr0 }
  - { a: db01:net0, b: pve1:vmbr0 }
  - { a: mon01:net0, b: pve1:vmbr0 }
  - { a: pve2:eno1, b: sw2:Gi0/1 }
  - { a: pve2:eno2, b: sw2:Gi0/2 }
`,
      ),
    ).toEqual([
      "sw1:Gi0/1 trunk(10,20) 30,40 ← web01:net0=30 db01:net0=30 mon01:net0=40",
      "sw2:Gi0/1 trunk(none) 10 ← pve2:eno1.10=10",
    ]);
  });

  it("SDN: vlan ゾーンは VNet の tag、qinq ゾーンはゾーンの tag を、ゾーンのホストのブリッジから確かめる(フェーズ4-6)", () => {
    const sdn = (nodes: string) => `  - { a: web01:net0, b: pve1:v30 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0${nodes} }
    qz: { type: qinq, bridge: vmbr1, tag: 40 }
    vx: { type: vxlan }
  vnets:
    v30: { zone: lan, tag: 30 }
    v200: { zone: lan, tag: 200 }
    q1: { zone: qz, tag: 7 }
    x1: { zone: vx, tag: 30 }
`;
    // VNet につながったゲストの IF のタグ(99)は確かめない。ゲストがつながっていなくても確かめる
    const guest =
      "  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 99 } } }\n";
    expect(blocks(guest, sdn(""))).toEqual([
      "sw1:Gi0/1 trunk(10,20) 30 ← pve1:v30=30",
      "pve1:vmbr0 bridge(2-100) 200 ← pve1:v200=200",
      "sw1:Gi0/3 access 40 ← pve1:q1=40",
    ]);
    // ゾーンのホストでなければ確かめない
    expect(blocks(guest, sdn(", nodes: []"))).toEqual(["sw1:Gi0/3 access 40 ← pve1:q1=40"]);
  });
});
