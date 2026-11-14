import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import type { Issue } from "./types";
import { validateTopology } from "./validate";

function check(text: string): { issues: Issue[]; text: string } {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { issues: validateTopology(result.topology, testCatalog, result.base), text };
}

function summary(issues: Issue[]): [string, string][] {
  return issues.map((i) => [i.severity, i.code]);
}

const devices = `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-l2switch-24 }
  srv1: { model: generic-server-2 }
  isp: { role: cloud }
links:
`;

describe("validateTopology", () => {
  it("SPEC 4.2 の例には問題が無い", () => {
    expect(check(specExample).issues).toEqual([]);
  });

  it("存在しないデバイスへの参照", () => {
    const { issues, text } = check(`${devices}  - a: rt1:Gi0/0\n    b: nowhere:eth0\n`);
    expect(summary(issues)).toEqual([["error", "unknown-device"]]);
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("nowhere:eth0");
  });

  it("モデルに無い IF への参照", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/9\n    b: srv1:eth0\n`);
    expect(summary(issues)).toEqual([["error", "unknown-interface"]]);
    expect(issues[0].target).toEqual(expect.objectContaining({ kind: "link", end: "a" }));
  });

  it("interfaces に書いた IF もモデルと照合する", () => {
    const { issues, text } = check(`constella: 1
devices:
  rt1:
    model: generic-router-4
    interfaces:
      Gi0/7: { description: x }
`);
    expect(summary(issues)).toEqual([["error", "unknown-interface"]]);
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("Gi0/7");
  });

  it("フレキシブルデバイスは任意の IF 名を使える", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: isp:anything-1\n`);
    expect(issues).toEqual([]);
  });

  it("未知のモデルはエラー 1 件だけにし、IF の参照ではエラーを出さない(Q3)", () => {
    const { issues } = check(`constella: 1
devices:
  x1:
    model: no-such-model
    interfaces:
      foo0: {}
  rt1: { model: generic-router-4 }
links:
  - a: x1:bar0
    b: rt1:Gi0/0
`);
    expect(summary(issues)).toEqual([["error", "unknown-model"]]);
  });

  it("同じポートの二重使用(長い形・大文字小文字の違いも同じポート)", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0
    b: sw1:Gi0/1
  - a: rt1:GigabitEthernet0/0
    b: sw1:Gi0/2
  - a: isp:WAN
    b: sw1:Gi0/3
  - a: isp:wan
    b: sw1:Gi0/4
`);
    expect(summary(issues)).toEqual([
      ["error", "port-in-use"],
      ["error", "port-in-use"],
    ]);
    expect(issues[0].message).toContain("sw1:Gi0/1");
  });

  it("無線のポートには何本でもつなげる(SPEC 4.3)", () => {
    const { issues } = check(`constella: 1
devices:
  ap1: { model: generic-ap }
  pc1: { role: pc }
  pc2: { role: pc }
links:
  - a: ap1:wlan0
    b: pc1:wlan0
  - a: pc2:wlan0
    b: ap1:wlan0
  - a: ap1:eth0
    b: pc1:eth0
  - a: ap1:eth0
    b: pc2:eth0
`);
    expect(summary(issues)).toEqual([["error", "port-in-use"]]);
    expect(issues[0].message).toContain("ap1:eth0");
  });

  it("自分自身への接続は警告", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: rt1:Gi0/1\n`);
    expect(summary(issues)).toEqual([["warning", "self-loop"]]);
  });

  it("同じポート同士をつなぐと二重使用と自己接続の両方", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: rt1:Gi0/0\n`);
    expect(summary(issues)).toEqual([
      ["error", "port-in-use"],
      ["warning", "self-loop"],
    ]);
  });

  it("ポート種別の不一致は警告(RJ45 と SFP+)", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: sw1:Te0/25\n`);
    expect(summary(issues)).toEqual([["warning", "port-type-mismatch"]]);
  });

  it("フレキシブルデバイスの IF は種別が分からないので警告しない", () => {
    const { issues } = check(`${devices}  - a: sw1:Te0/25\n    b: isp:wan\n`);
    expect(issues).toEqual([]);
  });

  it("layout に存在しないデバイスがあれば警告", () => {
    const { issues } = check("constella: 1\nlayout:\n  ghost: { x: 0, y: 0 }\n");
    expect(summary(issues)).toEqual([["warning", "unknown-layout-device"]]);
  });

  it("layout._labels に、動かせるラベルの無いキーがあれば警告(位置はそのキー)", () => {
    const { issues, text } = check(`constella: 1
devices:
  r1: { model: generic-router-4 }
  r2: { model: generic-router-4 }
links:
  - { a: r1:Gi0/0, b: r2:Gi0/0 }
layout:
  _labels:
    r1:GigabitEthernet0/0: { along: 60, side: 0 }
    r1:Gi0/1: { along: 60, side: 0 }
`);
    // 1 つ目は書き方が違うだけでリンクの端。2 つ目はリンクの無い IF
    expect(summary(issues)).toEqual([["warning", "unknown-label"]]);
    expect(issues[0].message).toBe("layout._labels の「r1:Gi0/1」に対応するラベルがありません");
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("r1:Gi0/1");
  });

  it("曲げた線の点に対応する線が無ければ警告(位置はそのキー)", () => {
    const { issues, text } = check(`${devices}  - { a: rt1:Gi0/0, b: sw1:Gi0/1 }
layout:
  _bends:
    sw1 rt1: [ { x: 0, y: 0 } ]
    rt1 srv1: [ { x: 0, y: 0 } ]
`);
    // 1 つ目は書いた順が逆なだけで、線がある
    expect(summary(issues)).toEqual([["warning", "unknown-bend"]]);
    expect(issues[0].message).toBe("layout._bends の「rt1 srv1」に対応する線がありません");
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("rt1 srv1");
  });

  it("グループのメンバーに存在しないデバイスがあればエラー(位置はそのグループ)", () => {
    const { issues, text } = check(
      `${devices}groups:\n  - { id: rack1, kind: rack, members: [ rt1, ghost, ghost ] }\n`,
    );
    expect(summary(issues)).toEqual([["error", "unknown-device"]]);
    expect(issues[0].target).toEqual({ kind: "group", index: 0 });
    expect(issues[0].message).toContain("ghost");
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe(
      "{ id: rack1, kind: rack, members: [ rt1, ghost, ghost ] }",
    );
  });

  it("グループ id の重複はエラー(2 つ目に出す)", () => {
    const { issues } = check(
      `${devices}groups:\n  - { id: g, members: [ rt1 ] }\n  - { id: g, members: [ sw1 ] }\n`,
    );
    expect(summary(issues)).toEqual([["error", "duplicate-group-id"]]);
    expect(issues[0].target).toEqual({ kind: "group", index: 1 });
  });
});

describe("validateTopology: ホストとゲスト(SPEC 4.6)", () => {
  const guests = `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  pve2: { model: generic-hypervisor-4 }
`;

  it("問題の無いゲスト", () => {
    const { issues } = check(
      `${guests}  vm1: { model: generic-vm, host: pve1, vmid: 100 }\n  ct1: { model: generic-container, host: pve2, vmid: 100 }\n`,
    );
    expect(issues).toEqual([]);
  });

  it("存在しないホスト。YAML では host の値を指す", () => {
    const { issues, text } = check(`${guests}  vm1: { model: generic-vm, host: pve9 }\n`);
    expect(summary(issues)).toEqual([["error", "unknown-device"]]);
    expect(issues[0].target).toEqual({ kind: "device", id: "vm1", field: "host" });
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("pve9");
  });

  it("host が自分自身", () => {
    const { issues } = check(`${guests}  vm1: { host: vm1 }\n`);
    expect(summary(issues)).toEqual([["error", "host-cycle"]]);
    expect(issues[0].message).toContain("自分自身");
  });

  it("host をたどると輪になる。輪の中のデバイスごとに、そこから一周する道筋を書く", () => {
    const { issues } = check(`${guests}  a: { host: b }\n  b: { host: a }\n`);
    expect(summary(issues)).toEqual([
      ["error", "host-cycle"],
      ["error", "host-cycle"],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "host をたどると輪になります(a → b → a)",
      "host をたどると輪になります(b → a → b)",
    ]);
  });

  it("同じホストの中で VMID が重なる。YAML では後の vmid の値を指す", () => {
    const { issues, text } = check(
      `${guests}  vm1: { host: pve1, vmid: 100 }\n  vm2: { host: pve1, vmid: 100 }\n  vm3: { host: pve1, vmid: 101 }\n`,
    );
    expect(summary(issues)).toEqual([["error", "duplicate-vmid"]]);
    expect(issues[0].target).toEqual({ kind: "device", id: "vm2", field: "vmid" });
    expect(issues[0].message).toContain("vm1");
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("100");
    expect(r?.start).toBeGreaterThan(text.indexOf("vm2:"));
  });
});

describe("validateTopology: ブリッジ(SPEC 4.6)", () => {
  const bridges = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true }
      vmbr1: { type: bridge }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve1 }
  vm3: { model: generic-vm, host: pve2 }
  sw1: { model: generic-l2switch-24 }
links:
`;

  it("モデルに無い名前でも、type を付けた IF はよい。ブリッジには何本でもつなげる", () => {
    const { issues } = check(
      `${bridges}  - { a: vm1:net0, b: pve1:vmbr0 }\n  - { a: vm2:net0, b: pve1:vmbr0 }\n  - { a: vm1:net1, b: pve1:vmbr1 }\n`,
    );
    expect(issues).toEqual([]);
  });

  it("ブリッジにつなげるのは、そのホストの上で動くゲストだけ。ブリッジどうしもつなげない", () => {
    const { issues, text } = check(
      `${bridges}  - { a: vm3:net0, b: pve1:vmbr0 }\n  - { a: sw1:Gi0/1, b: pve1:vmbr0 }\n  - { a: pve1:vmbr1, b: pve2:vmbr0 }\n`,
    );
    expect(summary(issues)).toEqual([
      ["error", "invalid-bridge-link"],
      ["error", "invalid-bridge-link"],
      ["error", "invalid-bridge-link"],
      ["error", "invalid-bridge-link"],
    ]);
    expect(issues[0].message).toContain("vm3 の host: pve2");
    expect(issues[1].message).toContain("sw1 の host: なし");
    expect(issues[2].message).toContain("ブリッジどうし");
    // 問題はブリッジでない側の端を指す
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("vm3:net0");
  });

  it("members の IF が無い、または 2 つのブリッジに入っている", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1, eno9 ] }
      vmbr1: { type: bridge, members: [ eno1 ] }
  flex:
    interfaces:
      br0: { type: bridge, members: [ anything ] }
`);
    expect(summary(issues)).toEqual([
      ["error", "unknown-interface"],
      ["error", "member-in-use"],
    ]);
    expect(issues[0].message).toContain("eno9");
    expect(issues[1].message).toContain("vmbr0 と vmbr1");
    expect(issues[1].target).toEqual({ kind: "interface", device: "pve1", name: "vmbr1" });
  });

  it("layout のブリッジのキー。無いブリッジは警告", () => {
    const { issues } = check(
      `${bridges}layout:\n  pve1:vmbr0: { x: 0, y: 0 }\n  pve1:vmbr9: { x: 0, y: 0 }\n  ghost:vmbr0: { x: 0, y: 0 }\n`,
    );
    expect(summary(issues)).toEqual([
      ["warning", "unknown-layout-device"],
      ["warning", "unknown-layout-device"],
    ]);
    expect(issues[0].message).toBe("layout の「pve1:vmbr9」に対応するブリッジがありません");
  });
});

describe("validateTopology: bond・VLAN インターフェース(SPEC 4.6)", () => {
  it("SPEC 4.6 の書き方には問題が無い", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ], bond-mode: 802.3ad }
      vmbr0: { type: bridge, members: [ bond0 ], vlan-aware: true }
      vmbr0.10: { type: vlan, ip: [ 192.0.2.2/24 ] }
      vlan20: { type: vlan, vlan-raw-device: bond0 }
  sw1: { model: generic-l2switch-24 }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: pve1:eno2, b: sw1:Gi0/2 }
`);
    expect(issues).toEqual([]);
  });

  it("bond・VLAN インターフェースにはリンクをつなげない", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1 ] }
      bond0.10: { type: vlan }
  sw1: { model: generic-l2switch-24 }
links:
  - { a: pve1:bond0, b: sw1:Gi0/1 }
  - { a: sw1:Gi0/2, b: pve1:bond0.10 }
`);
    expect(summary(issues)).toEqual([
      ["error", "invalid-logical-link"],
      ["error", "invalid-logical-link"],
    ]);
    expect(issues[0].message).toContain("束ねている物理的な IF");
    expect(issues[1].target).toEqual({ kind: "link", id: expect.any(String), end: "b" });
  });

  it("bond に入れるのは物理的な IF だけ。ブリッジにブリッジは入れられない", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1 ] }
      bond1: { type: bond, members: [ bond0 ] }
      vmbr0: { type: bridge }
      vmbr1: { type: bridge, members: [ vmbr0 ] }
`);
    expect(summary(issues)).toEqual([
      ["error", "invalid-member"],
      ["error", "invalid-member"],
    ]);
    expect(issues[0].message).toContain("物理的でない IF(bond0)");
    expect(issues[1].message).toContain("ブリッジ(vmbr0)");
  });

  it("VLAN インターフェースの親が無い・分からない、VLAN ID が分からない・範囲外", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr9.10: { type: vlan }
      mgmt: { type: vlan }
      eno1.5000: { type: vlan }
`);
    expect(summary(issues)).toEqual([
      ["error", "unknown-interface"],
      ["error", "invalid-vlan-interface"],
      ["error", "invalid-vlan-interface"],
      ["error", "invalid-vlan-interface"],
    ]);
    expect(issues[0].message).toContain("親の IF「vmbr9」");
    expect(issues[1].message).toContain("親の IF が分かりません");
    expect(issues[2].message).toContain("VLAN ID が分かりません");
    expect(issues[3].message).toContain("5000");
  });
});

describe("validateTopology: VLAN の通り道(SPEC 4.6・フェーズ4-4)", () => {
  it("止まる場所ごとに 1 件の警告。止まる場所の IF を指し、使っている IF を書く", () => {
    const { issues, text } = check(`constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: "10,20" }
      Gi0/2: { mode: trunk, vlans: "10,20" }
      Gi0/3: { mode: access, vlan: 10 }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ] }
      vmbr0: { type: bridge, members: [ bond0 ], vlan-aware: true, vlans: "2-100" }
      vmbr1: { type: bridge, members: [ eno3 ] }
  web01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 30 } } }
  db01: { model: generic-vm, host: pve1, interfaces: { net0: { mode: trunk, vlans: "30,40" } } }
  mon01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 200 } } }
  dns01: { model: generic-vm, host: pve1, interfaces: { net0: { vlan: 10 } } }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: pve1:eno2, b: sw1:Gi0/2 }
  - { a: pve1:eno3, b: sw1:Gi0/3 }
  - { a: web01:net0, b: pve1:vmbr0 }
  - { a: db01:net0, b: pve1:vmbr0 }
  - { a: mon01:net0, b: pve1:vmbr0 }
  - { a: dns01:net0, b: pve1:vmbr1 }
`);
    expect(summary(issues)).toEqual([
      ["warning", "vlan-not-allowed"],
      ["warning", "vlan-not-allowed"],
      ["warning", "vlan-not-allowed"],
      ["warning", "vlan-not-allowed"],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "sw1:Gi0/1(trunk 10,20)を VLAN 30,40 が通りません(使っている IF: web01:net0(VLAN 30)・db01:net0(VLAN 30,40))",
      "sw1:Gi0/2(trunk 10,20)を VLAN 30,40 が通りません(使っている IF: web01:net0(VLAN 30)・db01:net0(VLAN 30,40))",
      "ブリッジ pve1:vmbr0 の通す VLAN(2-100)に VLAN 200 が入っていません(使っている IF: mon01:net0)",
      "sw1:Gi0/3 は access なので、タグの付いた VLAN 10 は通りません(使っている IF: dns01:net0)",
    ]);
    // YAML では、直す場所(止まる場所の IF)を指す
    const at = (i: number) => {
      const r = issues[i].range;
      return r && text.slice(r.start, r.end);
    };
    expect([at(0), at(2), at(3)]).toEqual(["Gi0/1", "vmbr0", "Gi0/3"]);
    expect(issues[2].target).toEqual({ kind: "interface", device: "pve1", name: "vmbr0" });
  });

  it("読めない vlans は警告にし、その場所は確かめない", () => {
    const { issues } = check(`constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces:
      Gi0/1: { mode: trunk, vlans: "10,x" }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true, vlans: "5000" }
      vmbr0.30: { type: vlan }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
`);
    expect(summary(issues)).toEqual([
      ["warning", "invalid-vlan-list"],
      ["warning", "invalid-vlan-list"],
    ]);
    expect(issues[0].message).toBe(
      "sw1 の Gi0/1 の vlans「10,x」の書き方が分かりません(例: 10,20,100-110)",
    );
    expect(issues[1].target).toEqual({ kind: "interface", device: "pve1", name: "vmbr0" });
  });
});

describe("validateTopology: クラスタ(SPEC 4.6・フェーズ4-5)", () => {
  const hosts = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      eno3: { ip: [ 10.10.0.1/24 ] }
      vmbr0: { type: bridge, members: [ eno1 ], ip: [ 10.30.0.1/24 ] }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      eno3: { ip: [ 10.10.0.2/24 ] }
  pve3: { model: generic-hypervisor-4 }
`;

  it("問題の無いクラスタ", () => {
    const { issues } = check(`${hosts}groups:
  - id: lab
    kind: cluster
    members: [ pve1 ]
    networks: { corosync: 10.10.0.0/24, migration: 10.30.0.0/24 }
`);
    expect(issues).toEqual([]);
  });

  it("VMID は、ホストが違っても同じクラスタの中なら重ならないこと", () => {
    const { issues } = check(`${hosts}  vm1: { model: generic-vm, host: pve1, vmid: 100 }
  vm2: { model: generic-vm, host: pve2, vmid: 100 }
  vm3: { model: generic-vm, host: pve3, vmid: 100 }
  vm4: { model: generic-vm, host: pve1, vmid: 100 }
groups:
  - { id: lab, kind: cluster, members: [ pve1, pve2 ] }
`);
    expect(summary(issues)).toEqual([
      ["error", "duplicate-vmid"],
      ["error", "duplicate-vmid"],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "vm2 の VMID 100 は vm1 と重なっています(pve1 と pve2 は同じクラスタ「lab」に入っています)",
      "vm4 の VMID 100 は vm1 と重なっています(どちらも pve1 の上で動いています)",
    ]);
  });

  it("networks のサブネットに入る IP の無いホストを、ホストごとに 1 件の警告にする", () => {
    const { issues, text } =
      check(`${hosts}  vm1: { model: generic-vm, host: pve2, interfaces: { net0: { ip: [ 10.30.0.11/24 ] } } }
groups:
  - id: lab
    kind: cluster
    members: [ pve1, pve2, pve3 ]
    networks: { corosync: 10.10.0.0/24, migration: 10.30.0.0/24 }
`);
    expect(summary(issues)).toEqual([
      ["warning", "missing-cluster-network"],
      ["warning", "missing-cluster-network"],
    ]);
    // ゲスト(vm1)の IP は、ホストの IP として数えない
    expect(issues.map((i) => i.message)).toEqual([
      "pve2 に、クラスタ「lab」のネットワーク migration(10.30.0.0/24)に入る IP がありません",
      "pve3 に、クラスタ「lab」のネットワーク corosync(10.10.0.0/24)・migration(10.30.0.0/24)に入る IP がありません",
    ]);
    expect(issues[0].target).toEqual({ kind: "device", id: "pve2" });
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("pve2");
  });

  it("読めないサブネットは警告にし、そのネットワークは使わない。YAML ではその名前を指す", () => {
    const { issues, text } = check(`${hosts}groups:
  - id: lab
    kind: cluster
    members: [ pve1 ]
    networks:
      corosync: 10.10.0.0/24
      ceph: 10.20.0.0
`);
    expect(summary(issues)).toEqual([["warning", "invalid-subnet"]]);
    expect(issues[0].message).toBe(
      "クラスタ「lab」のネットワーク ceph のサブネット「10.20.0.0」の書き方が分かりません(例: 10.10.0.0/24)",
    );
    expect(issues[0].target).toEqual({ kind: "group", index: 0, network: "ceph" });
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("ceph");
  });

  it("kind: cluster でないグループの networks は使わずに警告する。YAML では networks の値を指す", () => {
    const { issues, text } = check(`${hosts}groups:
  - { id: rack1, kind: rack, members: [ pve3 ], networks: { corosync: 10.10.0.0/24 } }
`);
    expect(summary(issues)).toEqual([["warning", "networks-not-cluster"]]);
    expect(issues[0].message).toBe(
      "グループ「rack1」は kind: cluster ではないので、networks を使いません",
    );
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("{ corosync: 10.10.0.0/24 }");
  });

  it("2 つ以上のクラスタに入るホストはエラー。2 つ目以降のクラスタでは数えない", () => {
    const { issues } = check(`${hosts}  vm1: { model: generic-vm, host: pve2, vmid: 100 }
  vm2: { model: generic-vm, host: pve3, vmid: 100 }
groups:
  - { id: lab1, kind: cluster, members: [ pve1, pve2 ] }
  - { id: lab2, kind: cluster, members: [ pve2, pve3 ], networks: { corosync: 10.10.0.0/24 } }
`);
    // pve2 は lab1 で数えるので、lab2 のネットワークの警告と、pve3 のゲストとの VMID の重なりは出さない
    expect(summary(issues)).toEqual([
      ["error", "multiple-clusters"],
      ["warning", "missing-cluster-network"],
    ]);
    expect(issues[0].message).toBe(
      "pve2 は、クラスタ「lab1」と「lab2」の両方に入っています(入れるクラスタは 1 つだけです)",
    );
    expect(issues[0].target).toEqual({ kind: "group", index: 1 });
    expect(issues[1].message).toContain("pve3 に、クラスタ「lab2」");
  });
});

describe("validateTopology: SDN(SPEC 4.6・フェーズ4-6)", () => {
  const hosts = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  srv1: { model: generic-server-2 }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve2 }
`;
  const at = (issues: Issue[], text: string, i: number) => {
    const r = issues[i].range;
    return r && text.slice(r.start, r.end);
  };

  it("問題の無い SDN。VNet へのリンクは、モデルに無い IF でもエラーにしない", () => {
    const { issues } = check(`${hosts}links:
  - { a: vm1:net0, b: pve1:vnet30 }
  - { a: vm2:net0, b: pve2:vnet30 }
  - { a: vm1:net1, b: pve1:vx1 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0 }
    vx: { type: vxlan, nodes: [ pve1 ] }
    iso: { type: simple }
  vnets:
    vnet30: { zone: lan, tag: 30, subnets: [ 10.30.0.0/24 ] }
    vx1: { zone: vx, tag: 100000 }
    iso1: { zone: iso }
`);
    expect(issues).toEqual([]);
  });

  it("ゾーン: nodes のデバイス、vlan・qinq の bridge(各ホストにあるか)、qinq の tag", () => {
    const text = `${hosts}sdn:
  zones:
    lan: { type: vlan, nodes: [ pve1, ghost ] }
    q1: { type: qinq, bridge: vmbr1 }
`;
    const { issues } = check(text);
    expect(summary(issues)).toEqual([
      ["error", "unknown-device"],
      ["error", "missing-field"],
      ["error", "missing-zone-bridge"],
      ["error", "missing-zone-bridge"],
      ["error", "missing-field"],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "ゾーン「lan」の nodes の「ghost」に対応するデバイスがありません",
      "ゾーン「lan」(vlan)に bridge がありません",
      "pve1 に、ゾーン「q1」のブリッジ vmbr1 がありません",
      "pve2 に、ゾーン「q1」のブリッジ vmbr1 がありません",
      "ゾーン「q1」(qinq)に tag(外側の VLAN ID)がありません",
    ]);
    expect(at(issues, text, 0)).toBe("[ pve1, ghost ]");
    expect(issues[2].target).toEqual({ kind: "device", id: "pve1" });
    expect(at(issues, text, 4)).toBe("q1");
  });

  it("VNet: ID の長さ・subnets・ゾーン・tag・ホストの IF 名との重なり", () => {
    const text = `${hosts}sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0 }
  vnets:
    longvnet01: { zone: lan, tag: 30 }
    v1: { zone: lan }
    v2: { zone: lan, tag: 5000, subnets: [ 10.0.0.0, 10.2.0.0/24 ] }
    v3: { zone: nowhere, tag: 3 }
    vmbr0: { zone: lan, tag: 4 }
`;
    const { issues } = check(text);
    expect(summary(issues)).toEqual([
      ["warning", "long-vnet-id"],
      ["error", "missing-field"],
      ["warning", "invalid-subnet"],
      ["error", "invalid-vnet-tag"],
      ["error", "unknown-sdn-zone"],
      ["error", "vnet-name-conflict"],
      ["error", "vnet-name-conflict"],
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      "VNet ID「longvnet01」が 8 文字より長くなっています(Proxmox VE では 8 文字まで)",
      "VNet「v1」に tag がありません(ゾーン「lan」は vlan)",
      "VNet「v2」の subnets の「10.0.0.0」の書き方が分かりません(例: 10.40.0.0/24)",
      "VNet「v2」の tag(5000)は 1〜4094 の範囲にしてください(ゾーン「lan」は vlan)",
      "VNet「v3」のゾーン「nowhere」がありません",
      "VNet「vmbr0」は、pve1 の IF と同じ名前です(VNet ID か IF 名を変えてください)",
      "VNet「vmbr0」は、pve2 の IF と同じ名前です(VNet ID か IF 名を変えてください)",
    ]);
    expect([0, 2, 3, 4].map((i) => at(issues, text, i))).toEqual([
      "longvnet01",
      "[ 10.0.0.0, 10.2.0.0/24 ]",
      "5000",
      "nowhere",
    ]);
    expect(issues[0].target).toEqual({ kind: "sdn", section: "vnets", id: "longvnet01" });
  });

  it("ゾーンに入っていないホストで VNet を使うとエラー。置いた箱は警告。つなげるのはそのホストのゲストだけ", () => {
    const text = `${hosts}links:
  - { a: vm1:net0, b: pve1:vnet30 }
  - { a: vm2:net0, b: pve2:vnet30 }
  - { a: srv1:eth0, b: pve1:vnet30 }
layout:
  pve2:vnet30: { x: 0, y: 0 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0, nodes: [ pve1 ] }
  vnets:
    vnet30: { zone: lan, tag: 30 }
`;
    const { issues } = check(text);
    expect(summary(issues)).toEqual([
      ["error", "vnet-outside-zone"],
      ["error", "invalid-bridge-link"],
      ["warning", "vnet-outside-zone"],
    ]);
    expect(issues[0].message).toBe(
      "pve2 はゾーン「lan」に入っていないので、VNet vnet30 は使えません",
    );
    expect(at(issues, text, 0)).toBe("pve2:vnet30");
    expect(issues[2].message).toBe(
      "pve2 はゾーン「lan」に入っていないので、VNet vnet30 の箱は置けません(layout の「pve2:vnet30」)",
    );
  });
});

describe("validateTopology: トランシーバ(SPEC 5.4)", () => {
  const switches = (sw1: string, sw2 = "{}") => `constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces: ${sw1}
  sw2:
    model: generic-l2switch-24
    interfaces: ${sw2}
links:
`;

  it("RJ45 のポートには、一覧に無い名前でも挿せないと警告する", () => {
    const { issues, text } = check(
      switches("{ Gi0/1: { transceiver: 1000BASE-T }, Gi0/2: { transceiver: GLC-T } }"),
    );
    expect(summary(issues)).toEqual([
      ["warning", "transceiver-port"],
      ["warning", "transceiver-port"],
    ]);
    expect(issues[0].message).toBe("sw1 の Gi0/1(RJ45)には、トランシーバを挿せません");
    expect(issues[0].target).toEqual({ kind: "interface", device: "sw1", name: "Gi0/1" });
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toContain("Gi0/1");
  });

  it("ポートに合わない形は警告し、下の速度と一覧に無い名前は警告しない", () => {
    const { issues } = check(
      switches(
        "{ Te0/25: { transceiver: 100GBASE-SR4 }, Te0/26: { transceiver: 1000BASE-SX }, Te0/27: { transceiver: SFP-10G-SR } }",
      ),
    );
    expect(summary(issues)).toEqual([["warning", "transceiver-port"]]);
    expect(issues[0].message).toBe("sw1 の Te0/25(SFP+)には、100GBASE-SR4(QSFP28)を挿せません");
  });

  it("論理的な IF と仮想のポートには挿せない", () => {
    const { issues } = check(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [eno1, eno2], transceiver: 10GBASE-SR }
  vm1:
    model: generic-vm
    host: pve1
    interfaces:
      net0: { transceiver: 10GBASE-SR }
`);
    expect(issues.map((i) => i.message)).toEqual([
      "pve1 の bond0(bond)には、トランシーバを挿せません",
      "vm1 の net0(仮想)には、トランシーバを挿せません",
    ]);
  });

  it("両端が合わなければ警告する。別名・大文字小文字の違いは同じとみなす", () => {
    const { issues } = check(
      `${switches(
        "{ Te0/25: { transceiver: 10GBASE-SR }, Te0/26: { transceiver: 10G-DAC } }",
        "{ Te0/25: { transceiver: 10GBASE-LR }, Te0/26: { transceiver: 10gbase-cr } }",
      )}  - { a: sw1:Te0/25, b: sw2:Te0/25 }
  - { a: sw1:Te0/26, b: sw2:Te0/26 }
`,
    );
    expect(summary(issues)).toEqual([["warning", "transceiver-mismatch"]]);
    expect(issues[0].message).toBe(
      "両端のトランシーバが合いません: sw1:Te0/25(10GBASE-SR)と sw2:Te0/25(10GBASE-LR)",
    );
    expect(issues[0].target).toMatchObject({ kind: "link" });
  });

  it("BiDi は U と D の組み合わせでなければ警告する。片方の端だけなら確かめない", () => {
    const { issues } = check(
      `${switches(
        "{ Te0/25: { transceiver: 10GBASE-BX-U }, Te0/26: { transceiver: 10GBASE-BX-U }, Te0/27: { transceiver: 10GBASE-LR } }",
        "{ Te0/25: { transceiver: 10GBASE-BX-D }, Te0/26: { transceiver: 10GBASE-BX10-U } }",
      )}  - { a: sw1:Te0/25, b: sw2:Te0/25 }
  - { a: sw1:Te0/26, b: sw2:Te0/26 }
  - { a: sw1:Te0/27, b: sw2:Te0/27 }
`,
    );
    expect(issues.map((i) => i.message)).toEqual([
      "BiDi のトランシーバは、U と D を組み合わせてください: sw1:Te0/26(10GBASE-BX-U)と sw2:Te0/26(10GBASE-BX10-U)",
    ]);
  });

  it("銅線のトランシーバを挿した SFP のポートは、RJ45 とつないでも種別の不一致にしない", () => {
    const { issues } = check(
      `${switches("{}", "{ Te0/25: { transceiver: 1000BASE-T }, Te0/26: { transceiver: 10GBASE-T } }")}  - { a: sw1:Gi0/1, b: sw2:Te0/25 }
  - { a: sw1:Te0/26, b: sw2:Te0/26 }
`,
    );
    // 反対側がトランシーバを書いていない SFP のポートなら、RJ45 と SFP の不一致になる
    expect(summary(issues)).toEqual([["warning", "port-type-mismatch"]]);
    expect(issues[0].message).toBe(
      "ポート種別が合いません: sw1:Te0/26(sfp+)と sw2:Te0/26(sfp+・10GBASE-T)",
    );
  });
});
