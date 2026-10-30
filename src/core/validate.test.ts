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
