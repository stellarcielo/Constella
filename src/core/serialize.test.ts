import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { parseTopology, type YamlBase } from "./parse";
import { serializeTopology, STRINGIFY_OPTIONS } from "./serialize";
import { specExample, testCatalog } from "./testFixtures";
import { createEmptyTopology, createLinkId } from "./topology";
import type { Topology } from "./types";

function load(text: string): { topology: Topology; base: YamlBase } {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

/** リンクID を除いて比較できる形にする */
function semantic(t: Topology): unknown {
  return JSON.parse(
    JSON.stringify(
      {
        ...t,
        devices: [...t.devices.values()].map((d) => ({ ...d, interfaces: [...d.interfaces] })),
        links: t.links.map((l) => ({ ...l, id: undefined })),
        layout: [...t.layout],
      },
      (_k, v: unknown) => (v === undefined ? null : v),
    ),
  );
}

describe("serializeTopology: 変更なし", () => {
  it("何も変えなければ YAML ライブラリの再出力と同じになる(コメント・順序を保つ)", () => {
    const { topology, base } = load(specExample);
    const { text } = serializeTopology(topology, base);
    expect(text).toBe(parseDocument(specExample).toString(STRINGIFY_OPTIONS));
    expect(text).toContain("# yaml-language-server");
    expect(text).toContain("# model 省略 = フレキシブル");
    expect(text).toContain("# 座標が無いデバイスは自動レイアウトで配置する");
    expect(text).toContain("rt1: { x: 300, y: 80 }");
  });

  it("base を変更しない", () => {
    const { topology, base } = load(specExample);
    const first = serializeTopology(topology, base).text;
    const second = serializeTopology(topology, base).text;
    expect(second).toBe(first);
  });
});

describe("serializeTopology: IF 名", () => {
  it("長い IF 名を短い形にし、コメントは残す", () => {
    const { topology, base } = load(`constella: 1
devices:
  sw1:
    model: cisco-c2960-24tt-l
    interfaces:
      GigabitEthernet0/1:   # uplink
        description: up
  rt1:
    model: generic-router-4
links:
  - a: rt1:GigabitEthernet0/0   # wan side
    b: sw1:FastEthernet0/1
`);
    const { text } = serializeTopology(topology, base);
    expect(text).toContain("Gi0/1:");
    expect(text).not.toContain("GigabitEthernet");
    expect(text).toContain("a: rt1:Gi0/0 # wan side");
    expect(text).toContain("b: sw1:Fa0/1");
    expect(text).toContain("# uplink");
  });
});

describe("serializeTopology: GUI での編集", () => {
  it("デバイスの移動は layout の値だけを書き換える", () => {
    const { topology, base } = load(specExample);
    topology.layout.set("rt1", { x: 320, y: 100 });
    const { text } = serializeTopology(topology, base);
    expect(text).toContain("rt1: { x: 320, y: 100 }");
    expect(text).toContain("# 座標が無いデバイスは自動レイアウトで配置する");
  });

  it("座標の無かったデバイスを動かすと layout の末尾に追加する", () => {
    const { topology, base } = load(specExample);
    topology.layout.set("srv1", { x: 500, y: 400 });
    const { text } = serializeTopology(topology, base);
    expect(text).toContain("core-sw1: { x: 300, y: 240 }\n  srv1: { x: 500, y: 400 }\n");
  });

  it("新しいデバイスとリンクは末尾に追加する", () => {
    const { topology, base } = load(specExample);
    topology.devices.set("pc1", {
      id: "pc1",
      model: "generic-pc",
      interfaces: new Map(),
      extra: {},
    });
    topology.links.push({
      id: createLinkId(),
      a: { device: "core-sw1", iface: "Fa0/2" },
      b: { device: "pc1", iface: "eth0" },
      extra: {},
    });
    const { text } = serializeTopology(topology, base);
    expect(text).toContain("  isp:\n    role: cloud # model 省略");
    expect(text).toMatch(/isp:[\s\S]*pc1:\n {4}model: generic-pc\n/);
    expect(text).toMatch(/label: mgmt\n {2}- a: core-sw1:Fa0\/2\n {4}b: pc1:eth0\n/);
  });

  it("デバイスとリンクを削除する", () => {
    const { topology, base } = load(specExample);
    topology.devices.delete("srv1");
    topology.links = topology.links.filter((l) => l.b?.device !== "srv1");
    const { text } = serializeTopology(topology, base);
    expect(text).not.toContain("srv1");
    expect(text).not.toContain("mgmt");
    expect(text).toContain("# model 省略");
  });

  it("項目の変更と削除", () => {
    const { topology, base } = load(specExample);
    const rt1 = topology.devices.get("rt1");
    if (!rt1) throw new Error();
    rt1.label = "Core Router";
    topology.links[2].label = undefined;
    topology.links[0].media = "fiber";
    topology.meta.title = undefined;
    const { text } = serializeTopology(topology, base);
    expect(text).toContain("label: Core Router");
    expect(text).not.toContain("label: mgmt");
    expect(text).toMatch(/b: isp:wan\n {4}media: fiber\n/);
    expect(text).not.toContain("title:");
    expect(text).toContain("description: 学習用ルーティング網");
  });

  it("IF 情報の追加", () => {
    const { topology, base } = load(specExample);
    topology.devices.get("rt1")?.interfaces.set("Gi0/0", { ip: ["198.51.100.2/30"], extra: {} });
    const { text } = serializeTopology(topology, base);
    expect(text).toMatch(
      /label: Edge Router\n {4}interfaces:\n {6}Gi0\/0:\n {8}ip: \[ 198\.51\.100\.2\/30 \]\n/,
    );
  });

  it("書き出した結果の base を次回に使える", () => {
    const { topology, base } = load(specExample);
    topology.layout.set("rt1", { x: 1, y: 2 });
    const first = serializeTopology(topology, base);
    const next: Topology = { ...topology, layout: new Map(topology.layout) };
    next.layout.set("rt1", { x: 3, y: 4 });
    next.links = topology.links.slice(1);
    const { text } = serializeTopology(next, first.base);
    expect(text).toContain("rt1: { x: 3, y: 4 }");
    expect(text).not.toContain("isp:wan");
    expect(text).toContain("rt1:Gi0/1");
  });
});

describe("serializeTopology: 解釈できなかった値を残す", () => {
  const source = `constella: 1
owner: me
devices:
  rt1:
    role: toaster
    vendor: acme
links:
  - a: rt1
    b: x:y
    color: red
  - just a string
layout:
  rt1: here
`;

  it("編集しても未知のキー・不正な値は残る", () => {
    const { topology, base } = load(source);
    const rt1 = topology.devices.get("rt1");
    if (!rt1) throw new Error();
    rt1.label = "R1";
    topology.links[0].label = "x";
    const { text } = serializeTopology(topology, base);
    for (const s of [
      "owner: me",
      "role: toaster",
      "vendor: acme",
      "a: rt1\n",
      "color: red",
      "just a string",
      "rt1: here",
    ]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("label: R1");
  });

  it("デバイスIDを変えても extra は引き継ぐ", () => {
    const { topology, base } = load(source);
    const rt1 = topology.devices.get("rt1");
    if (!rt1) throw new Error();
    topology.devices.delete("rt1");
    topology.devices.set("rt9", { ...rt1, id: "rt9" });
    const { text } = serializeTopology(topology, base);
    expect(text).toMatch(/rt9:\n {4}role: toaster\n {4}vendor: acme\n/);
  });

  it("数値に見えるデバイスIDを書き換えない", () => {
    const { topology, base } = load("constella: 1\ndevices:\n  01: {}\n");
    const { text } = serializeTopology(topology, base);
    expect(load(text).topology.devices.has("01")).toBe(true);
  });
});

describe("serializeTopology: 新規作成", () => {
  it("空のトポロジ", () => {
    expect(serializeTopology(createEmptyTopology()).text).toBe("constella: 1\n");
  });

  it("GUI で作ったトポロジを書き出して読み直すと同じになる", () => {
    const t = createEmptyTopology();
    t.meta.title = "テスト";
    t.devices.set("rt1", {
      id: "rt1",
      model: "generic-router-4",
      interfaces: new Map(),
      extra: {},
    });
    t.devices.set("sw1", {
      id: "sw1",
      model: "generic-l2switch-24",
      label: "Access SW",
      interfaces: new Map([
        ["Gi0/1", { description: "to rt1", mode: "access", vlan: 10, extra: {} }],
      ]),
      extra: {},
    });
    t.devices.set("1", { id: "1", role: "cloud", interfaces: new Map(), extra: {} });
    t.links.push(
      {
        id: createLinkId(),
        a: { device: "rt1", iface: "Gi0/0" },
        b: { device: "sw1", iface: "Gi0/1" },
        extra: {},
      },
      {
        id: createLinkId(),
        a: { device: "rt1", iface: "Gi0/1" },
        b: { device: "1", iface: "wan" },
        media: "fiber",
        extra: {},
      },
    );
    t.layout.set("rt1", { x: 100, y: 50 });
    t.layout.set("sw1", { x: 100, y: 200 });
    t.viewport = { x: 0, y: 0, zoom: 1 };

    const { text } = serializeTopology(t);
    expect(text).toBe(`constella: 1

meta:
  title: テスト

devices:
  rt1:
    model: generic-router-4
  sw1:
    model: generic-l2switch-24
    label: Access SW
    interfaces:
      Gi0/1:
        description: to rt1
        mode: access
        vlan: 10
  "1":
    role: cloud

links:
  - a: rt1:Gi0/0
    b: sw1:Gi0/1
  - a: rt1:Gi0/1
    b: 1:wan
    media: fiber

layout:
  rt1: { x: 100, y: 50 }
  sw1: { x: 100, y: 200 }
  _viewport: { x: 0, y: 0, zoom: 1 }
`);
    expect(semantic(load(text).topology)).toEqual(semantic(t));
  });

  it("SPEC 4.2 の例を往復しても意味が変わらない", () => {
    const { topology } = load(specExample);
    const { text } = serializeTopology(topology);
    expect(semantic(load(text).topology)).toEqual(semantic(topology));
  });
});
