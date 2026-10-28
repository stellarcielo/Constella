import { describe, expect, it } from "vitest";
import { parseTopology, type ParseResult } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import type { Issue, Topology } from "./types";

function parseOk(text: string): { topology: Topology; issues: Issue[] } {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(`パースエラー: ${JSON.stringify(result.issues)}`);
  return result;
}

function codes(issues: Issue[]): string[] {
  return issues.map((i) => i.code);
}

function failCodes(result: ParseResult): string[] {
  expect(result.ok).toBe(false);
  return codes(result.issues);
}

describe("parseTopology: SPEC 4.2 の例", () => {
  const { topology, issues } = parseOk(specExample);

  it("問題なく読める", () => {
    expect(issues).toEqual([]);
  });

  it("meta", () => {
    expect(topology.meta.title).toBe("自宅ラボ DC 区画");
    expect(topology.meta.description).toBe("学習用ルーティング網");
  });

  it("devices は書かれた順に読む", () => {
    expect([...topology.devices.keys()]).toEqual(["rt1", "core-sw1", "srv1", "isp"]);
    const rt1 = topology.devices.get("rt1");
    expect(rt1?.model).toBe("generic-router-4");
    expect(rt1?.label).toBe("Edge Router");
    expect(topology.devices.get("isp")?.role).toBe("cloud");
    expect(topology.devices.get("isp")?.model).toBeUndefined();
    expect(topology.devices.get("core-sw1")?.interfaces.get("Gi0/1")?.description).toBe("to rt1");
  });

  it("links", () => {
    expect(topology.links.map((l) => [l.a, l.b, l.label])).toEqual([
      [{ device: "rt1", iface: "Gi0/0" }, { device: "isp", iface: "wan" }, undefined],
      [{ device: "rt1", iface: "Gi0/1" }, { device: "core-sw1", iface: "Gi0/1" }, undefined],
      [{ device: "core-sw1", iface: "Fa0/1" }, { device: "srv1", iface: "eth0" }, "mgmt"],
    ]);
    const ids = new Set(topology.links.map((l) => l.id));
    expect(ids.size).toBe(3);
  });

  it("layout", () => {
    expect([...topology.layout]).toEqual([
      ["rt1", { x: 300, y: 80 }],
      ["core-sw1", { x: 300, y: 240 }],
    ]);
  });
});

describe("parseTopology: パースエラー", () => {
  it("YAML の構文エラーは位置付きで返す", () => {
    const result = parseTopology("constella: 1\ndevices: [\n");
    expect(failCodes(result)).toContain("yaml-syntax");
    if (!result.ok) expect(result.issues[0].range).toBeDefined();
  });

  it("constella が無い", () => {
    expect(failCodes(parseTopology("devices: {}\n"))).toEqual(["missing-version"]);
  });

  it("constella のバージョンが違う", () => {
    expect(failCodes(parseTopology("constella: 2\n"))).toEqual(["unsupported-version"]);
    expect(failCodes(parseTopology('constella: "1"\n'))).toEqual(["unsupported-version"]);
  });

  it("最上位がマップでない", () => {
    expect(failCodes(parseTopology("- a\n- b\n"))).toEqual(["invalid-root"]);
  });

  it("空のファイル", () => {
    expect(failCodes(parseTopology(""))).toEqual(["invalid-root"]);
  });
});

describe("parseTopology: 最小構成と既定値", () => {
  it("constella だけでも読める", () => {
    const { topology, issues } = parseOk("constella: 1\n");
    expect(issues).toEqual([]);
    expect(topology.devices.size).toBe(0);
    expect(topology.links).toEqual([]);
  });

  it("中身が空のデバイスを許す", () => {
    const { topology, issues } = parseOk("constella: 1\ndevices:\n  pc1:\n");
    expect(issues).toEqual([]);
    expect(topology.devices.get("pc1")).toEqual({
      id: "pc1",
      uid: expect.any(String),
      interfaces: new Map(),
      extra: {},
    });
  });

  it("_viewport", () => {
    const { topology } = parseOk("constella: 1\nlayout:\n  _viewport: { x: 1, y: 2, zoom: 1.5 }\n");
    expect(topology.viewport).toEqual({ x: 1, y: 2, zoom: 1.5 });
    expect(topology.layout.size).toBe(0);
  });

  it("groups", () => {
    const { topology, issues } = parseOk(
      "constella: 1\ngroups:\n  - id: rack1\n    kind: rack\n    label: Rack 1\n    members: [rt1, sw1]\n",
    );
    expect(issues).toEqual([]);
    expect(topology.groups).toEqual([
      { id: "rack1", kind: "rack", label: "Rack 1", members: ["rt1", "sw1"], extra: {} },
    ]);
  });

  it("interfaces の各項目", () => {
    const { topology, issues } = parseOk(`constella: 1
devices:
  sw1:
    interfaces:
      Gi0/1: { mode: access, vlan: 10 }
      Gi0/2: { mode: trunk, vlans: "10,20,100-110" }
      Gi0/3: { mode: routed, ip: ["192.0.2.1/30", "2001:db8::1/64"] }
`);
    expect(issues).toEqual([]);
    const ifs = topology.devices.get("sw1")?.interfaces;
    expect(ifs?.get("Gi0/1")).toEqual({ mode: "access", vlan: 10, extra: {} });
    expect(ifs?.get("Gi0/2")).toEqual({ mode: "trunk", vlans: "10,20,100-110", extra: {} });
    expect(ifs?.get("Gi0/3")?.ip).toEqual(["192.0.2.1/30", "2001:db8::1/64"]);
  });

  it("数字だけのラベルも文字列として読む", () => {
    const { topology, issues } = parseOk("constella: 1\ndevices:\n  sw1:\n    label: 2960\n");
    expect(issues).toEqual([]);
    expect(topology.devices.get("sw1")?.label).toBe("2960");
  });
});

describe("parseTopology: エンドポイントと IF 名", () => {
  it("最初の : で分割する", () => {
    const { topology } = parseOk("constella: 1\nlinks:\n  - a: r1:Eth1/1:1\n    b: r2:x\n");
    expect(topology.links[0].a).toEqual({ device: "r1", iface: "Eth1/1:1" });
  });

  it("長い IF 名は短い形にする", () => {
    const { topology } = parseOk(`constella: 1
devices:
  rt1: { model: generic-router-4 }
  rt2: { model: generic-router-4 }
links:
  - a: rt1:GigabitEthernet0/0
    b: rt2:gigabitethernet 0/0
`);
    expect(topology.links[0].a?.iface).toBe("Gi0/0");
    expect(topology.links[0].b?.iface).toBe("Gi0/0");
  });

  it("モデルのあるデバイスはモデル側の表記にそろえる", () => {
    const { topology } = parseOk(`constella: 1
devices:
  srv1:
    model: generic-server-2
    interfaces:
      ETH1: { description: x }
links:
  - a: srv1:ETH0
    b: x:y
`);
    expect([...(topology.devices.get("srv1")?.interfaces.keys() ?? [])]).toEqual(["eth1"]);
    expect(topology.links[0].a?.iface).toBe("eth0");
  });

  it("フレキシブルデバイスは最初に書かれた表記にそろえる", () => {
    const { topology } = parseOk(`constella: 1
devices:
  isp: { role: cloud }
links:
  - a: isp:WAN
    b: x:a
  - a: isp:wan
    b: x:b
`);
    expect(topology.links.map((l) => l.a?.iface)).toEqual(["WAN", "WAN"]);
  });

  it("不正なエンドポイント", () => {
    const { topology, issues } = parseOk("constella: 1\nlinks:\n  - a: rt1\n    b: ':x'\n");
    expect(codes(issues)).toEqual(["invalid-endpoint", "invalid-endpoint"]);
    expect(topology.links[0].a).toBeUndefined();
    expect(topology.links[0].extra).toEqual({ a: "rt1", b: ":x" });
  });

  it("a / b が無いリンク", () => {
    const { issues } = parseOk("constella: 1\nlinks:\n  - a: r1:x\n");
    expect(codes(issues)).toEqual(["missing-field"]);
  });
});

describe("parseTopology: 意味のエラー・警告", () => {
  it("デバイスIDの重複は 2 つ目を無視してエラー(Q5)", () => {
    const { topology, issues } = parseOk(
      "constella: 1\ndevices:\n  rt1:\n    label: first\n  rt1:\n    label: second\n",
    );
    expect(codes(issues)).toEqual(["duplicate-device-id"]);
    expect(topology.devices.get("rt1")?.label).toBe("first");
    expect(issues[0].range).toBeDefined();
  });

  it("デバイスIDの規則違反", () => {
    const { topology, issues } = parseOk('constella: 1\ndevices:\n  "-bad": {}\n  "a b": {}\n');
    expect(codes(issues)).toEqual(["invalid-device-id", "invalid-device-id"]);
    expect(topology.devices.size).toBe(2);
  });

  it("数字で始まるデバイスIDは書かれたとおりに扱う", () => {
    const { topology, issues } = parseOk("constella: 1\ndevices:\n  01: {}\n  2: {}\n");
    expect(issues).toEqual([]);
    expect([...topology.devices.keys()]).toEqual(["01", "2"]);
  });

  it("同じ IF の重複はエラー(Q6)", () => {
    const { topology, issues } = parseOk(`constella: 1
devices:
  sw1:
    interfaces:
      Gi0/1: { description: a }
      GigabitEthernet0/1: { description: b }
`);
    expect(codes(issues)).toEqual(["duplicate-interface"]);
    expect(topology.devices.get("sw1")?.interfaces.get("Gi0/1")?.description).toBe("a");
  });

  it("未知のキーは警告にして値を残す(Q4)", () => {
    const { topology, issues } = parseOk(`constella: 1
owner: me
devices:
  rt1:
    vendor: acme
links:
  - a: r:a
    b: s:b
    color: red
`);
    expect(codes(issues)).toEqual(["unknown-key", "unknown-key", "unknown-key"]);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(topology.extra).toEqual({ owner: "me" });
    expect(topology.devices.get("rt1")?.extra).toEqual({ vendor: "acme" });
    expect(topology.links[0].extra).toEqual({ color: "red" });
  });

  it("不正な値はエラーにして値を残す", () => {
    const { topology, issues } = parseOk(`constella: 1
devices:
  rt1:
    role: toaster
    interfaces:
      Gi0/1: { vlan: 5000, mode: hybrid }
links:
  - a: r:a
    b: s:b
    media: laser
`);
    expect(codes(issues)).toEqual([
      "invalid-value",
      "invalid-value",
      "invalid-value",
      "invalid-value",
    ]);
    expect(topology.devices.get("rt1")?.role).toBeUndefined();
    expect(topology.devices.get("rt1")?.extra).toEqual({ role: "toaster" });
    expect(topology.devices.get("rt1")?.interfaces.get("Gi0/1")?.extra).toEqual({
      vlan: 5000,
      mode: "hybrid",
    });
    expect(topology.links[0].extra).toEqual({ media: "laser" });
  });

  it("セクションの型が違う", () => {
    const { issues } = parseOk("constella: 1\ndevices: [a]\nlinks: {}\nlayout:\n  rt1: here\n");
    expect(codes(issues)).toEqual(["invalid-type", "invalid-type", "invalid-value"]);
  });

  it("重複したキー", () => {
    const { topology, issues } = parseOk(
      "constella: 1\ndevices:\n  rt1:\n    label: a\n    label: b\n",
    );
    expect(codes(issues)).toEqual(["duplicate-key"]);
    expect(topology.devices.get("rt1")?.label).toBe("a");
  });

  it("問題には YAML 上の位置が付く", () => {
    const text = "constella: 1\ndevices:\n  rt1:\n    role: toaster\n";
    const { issues } = parseOk(text);
    const range = issues[0].range;
    expect(range && text.slice(range.start, range.end)).toBe("toaster");
  });
});
