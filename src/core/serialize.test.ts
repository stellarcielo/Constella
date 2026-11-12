import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { parseTopology, type YamlBase } from "./parse";
import { rebaseOnText, serializeTopology, STRINGIFY_OPTIONS } from "./serialize";
import { specExample, testCatalog } from "./testFixtures";
import { resetBends, setBends } from "./bends";
import { addDevice, addLink, removeDevices, renameDevice, setDeviceRole } from "./edit";
import { addGroup, removeGroup, updateGroup } from "./groups";
import { resetLabels, setLabelOffset } from "./labelLayout";
import { createEmptyTopology, createLinkId } from "./topology";
import type { SourceRange, Topology } from "./types";
import { locateTarget } from "./validate";

function load(text: string): { topology: Topology; base: YamlBase } {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

/** メモリ上だけの識別子(デバイスの uid とリンクID)を除いて比較できる形にする */
function semantic(t: Topology): unknown {
  return JSON.parse(
    JSON.stringify(
      {
        ...t,
        devices: [...t.devices.values()].map((d) => ({
          ...d,
          uid: undefined,
          interfaces: [...d.interfaces],
        })),
        links: t.links.map((l) => ({ ...l, id: undefined })),
        layout: [...t.layout],
        bends: [...t.bends],
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
      uid: "new-pc1",
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

  it("トランシーバは description の次に書き、書き換えてもコメントは残す", () => {
    const { topology, base } = load(`constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces:
      # コアへのアップリンク
      Te0/25: { transceiver: 10GBASE-SR } # 予備あり
`);
    const ifs = topology.devices.get("sw1")?.interfaces;
    const te25 = ifs?.get("Te0/25");
    if (te25) te25.transceiver = "10GBASE-LR";
    ifs?.set("Te0/26", {
      description: "spare",
      transceiver: "10G-DAC",
      ip: ["192.0.2.1/30"],
      extra: {},
    });
    const { text } = serializeTopology(topology, base);
    expect(text).toContain(
      "      # コアへのアップリンク\n      Te0/25: { transceiver: 10GBASE-LR } # 予備あり\n",
    );
    expect(text).toMatch(
      /Te0\/26:\n {8}description: spare\n {8}transceiver: 10G-DAC\n {8}ip: \[ 192\.0\.2\.1\/30 \]\n/,
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

describe("serializeTopology: デバイスID の変更(Q1)", () => {
  it("位置とコメントを保ったまま、キー名と参照だけを書き換える", () => {
    const { topology, base } = load(specExample);
    renameDevice(topology, "core-sw1", "dist-sw1");
    const { text } = serializeTopology(topology, base);
    const expected = parseDocument(specExample)
      .toString(STRINGIFY_OPTIONS)
      .split("core-sw1")
      .join("dist-sw1");
    expect(text).toBe(expected);
  });

  it("キーの上のコメントも残る", () => {
    const { topology, base } = load(`constella: 1
devices:
  # 上流ルーター
  rt1:
    model: generic-router-4 # 2 台目を追加予定
  sw1: {}
layout:
  # 手で調整した位置
  rt1: { x: 1, y: 2 }
`);
    renameDevice(topology, "rt1", "edge1");
    const { text } = serializeTopology(topology, base);
    expect(text).toContain(
      "  # 上流ルーター\n  edge1:\n    model: generic-router-4 # 2 台目を追加予定\n  sw1:",
    );
    expect(text).toContain("  # 手で調整した位置\n  edge1: { x: 1, y: 2 }");
  });

  it("2 台の ID を入れ替えても、中身は正しいデバイスに付いたまま", () => {
    const { topology, base } = load(`constella: 1
devices:
  a:
    label: first
  b:
    label: second
`);
    renameDevice(topology, "a", "tmp");
    renameDevice(topology, "b", "a");
    renameDevice(topology, "tmp", "b");
    const { text } = serializeTopology(topology, base);
    expect(text).toBe("constella: 1\ndevices:\n  b:\n    label: first\n  a:\n    label: second\n");
  });

  it("削除したデバイスの ID に別のデバイスを改名しても重複しない", () => {
    const { topology, base } = load(`constella: 1
devices:
  a:
    label: keep
  b:
    label: gone
layout:
  a: { x: 1, y: 1 }
  b: { x: 2, y: 2 }
`);
    removeDevices(topology, ["b"]);
    renameDevice(topology, "a", "b");
    const { text } = serializeTopology(topology, base);
    expect(text).toBe(
      "constella: 1\ndevices:\n  b:\n    label: keep\nlayout:\n  b: { x: 1, y: 1 }\n",
    );
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
      uid: "u-rt1",
      model: "generic-router-4",
      interfaces: new Map(),
      extra: {},
    });
    t.devices.set("sw1", {
      id: "sw1",
      uid: "u-sw1",
      model: "generic-l2switch-24",
      label: "Access SW",
      interfaces: new Map([
        ["Gi0/1", { description: "to rt1", mode: "access", vlan: 10, extra: {} }],
      ]),
      extra: {},
    });
    t.devices.set("1", { id: "1", uid: "u-1", role: "cloud", interfaces: new Map(), extra: {} });
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

describe("rebaseOnText: 保存した YAML の読み直し", () => {
  const slice = (text: string, range?: SourceRange) => range && text.slice(range.start, range.end);

  it("保存前に追加したデバイスとリンクも、保存したファイル上の位置が分かる", () => {
    const { topology, base } = load(specExample);
    addDevice(topology, { model: "generic-server-2", position: { x: 0, y: 0 } }, testCatalog);
    const id = addLink(
      topology,
      { device: "core-sw1", iface: "Fa0/2" },
      { device: "srv2", iface: "eth0" },
      testCatalog,
    );
    const { text } = serializeTopology(topology, base);
    const rebased = rebaseOnText(text, topology, testCatalog);
    if (!rebased) throw new Error("rebase failed");
    expect(slice(text, locateTarget(rebased.base, { kind: "device", id: "srv2" }))).toBe("srv2");
    expect(slice(text, locateTarget(rebased.base, { kind: "link", id, end: "b" }))).toBe(
      "srv2:eth0",
    );
    // 既存の要素の位置も、保存したファイルの位置になる
    const rt1 = locateTarget(rebased.base, { kind: "device", id: "rt1" });
    expect(slice(text, rt1)).toBe("rt1");
  });

  it("読み直した base で続けて保存しても、内容とコメントは変わらない", () => {
    const { topology, base } = load(specExample);
    topology.layout.set("srv1", { x: 1, y: 2 });
    const first = serializeTopology(topology, base);
    const rebased = rebaseOnText(first.text, topology, testCatalog);
    if (!rebased) throw new Error("rebase failed");
    expect(serializeTopology(topology, rebased.base).text).toBe(first.text);
    renameDevice(topology, "srv1", "web1");
    const second = serializeTopology(topology, rebased.base).text;
    expect(second).toContain("  web1:\n    model: generic-server-2\n  isp:");
    expect(second).toContain("# 座標が無いデバイスは自動レイアウトで配置する");
  });

  it("GUI で直した値の問題は、保存すると消える", () => {
    const { topology, base } = load("constella: 1\ndevices:\n  rt1:\n    role: toaster\n");
    setDeviceRole(topology, "rt1", "router", testCatalog);
    const { text } = serializeTopology(topology, base);
    expect(rebaseOnText(text, topology, testCatalog)?.fileIssues).toEqual([]);
  });

  it("リンクの問題は、今のトポロジのリンクID に付け替える", () => {
    const { topology, base } = load(
      "constella: 1\nlinks:\n  - a: x:1\n    b: y:2\n    color: red\n",
    );
    const { text } = serializeTopology(topology, base);
    const issues = rebaseOnText(text, topology, testCatalog)?.fileIssues ?? [];
    expect(issues.map((i) => i.target)).toEqual([{ kind: "link", id: topology.links[0].id }]);
  });

  it("リンクの対応が取れなければ undefined", () => {
    const { topology, base } = load(specExample);
    const { text } = serializeTopology(topology, base);
    topology.links.pop();
    expect(rebaseOnText(text, topology, testCatalog)).toBeUndefined();
  });
});

describe("serializeTopology: ゲスト(SPEC 4.6)", () => {
  const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
  web01:
    model: generic-vm
    # IF の設定
    interfaces:
      net0: { vlan: 10 }
`;

  it("GUI で設定した host・guest・vmid は、interfaces より前に書く", () => {
    const { topology, base } = load(text);
    const web01 = topology.devices.get("web01");
    if (!web01) throw new Error();
    web01.host = "pve1";
    web01.guest = "container";
    web01.vmid = 100;
    expect(serializeTopology(topology, base).text).toBe(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
  web01:
    model: generic-vm
    host: pve1
    guest: container
    vmid: 100
    # IF の設定
    interfaces:
      net0: { vlan: 10 }
`);
  });

  it("消すと YAML からも消え、往復しても変わらない", () => {
    const first = load(text);
    const web01 = first.topology.devices.get("web01");
    if (!web01) throw new Error();
    web01.host = "pve1";
    web01.vmid = 100;
    const written = serializeTopology(first.topology, first.base).text;
    const again = load(written);
    expect(semantic(again.topology)).toEqual(semantic(first.topology));
    const device = again.topology.devices.get("web01");
    if (!device) throw new Error();
    delete device.host;
    delete device.vmid;
    expect(serializeTopology(again.topology, again.base).text).toBe(text);
  });

  it("新しいデバイスは model・host の順に書く", () => {
    const { topology, base } = load(text);
    addDevice(
      topology,
      { model: "generic-container", host: "pve1", position: { x: 0, y: 0 } },
      testCatalog,
    );
    expect(serializeTopology(topology, base).text).toContain(
      "  ct1:\n    model: generic-container\n    host: pve1\n",
    );
  });
});

describe("serializeTopology: ブリッジ(SPEC 4.6)", () => {
  const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ] }
layout:
  pve1: { x: 0, y: 0 }
  # ブリッジの位置
  pve1:vmbr0: { x: 0, y: 120 }
`;

  it("論理的な IF の項目を、type を先にして書く(members は 1 行の配列)", () => {
    const { topology, base } = load(text);
    topology.devices.get("pve1")?.interfaces.set("bond0", {
      type: "bond",
      members: ["eno2", "eno3"],
      bondMode: "802.3ad",
      description: "LAG",
      extra: {},
    });
    const vmbr0 = topology.devices.get("pve1")?.interfaces.get("vmbr0");
    if (!vmbr0) throw new Error();
    vmbr0.vlanAware = true;
    const out = serializeTopology(topology, base).text;
    expect(out).toContain(
      "      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true }\n" +
        "      bond0:\n" +
        "        type: bond\n" +
        "        members: [ eno2, eno3 ]\n" +
        "        bond-mode: 802.3ad\n" +
        "        description: LAG\n",
    );
  });

  it("ホストの ID を変えると、ブリッジの位置のキーも、位置とコメントを保って書き換える", () => {
    const { topology, base } = load(text);
    renameDevice(topology, "pve1", "pve-a");
    const out = serializeTopology(topology, base).text;
    expect(out).toContain(
      "layout:\n  pve-a: { x: 0, y: 0 }\n  # ブリッジの位置\n  pve-a:vmbr0: { x: 0, y: 120 }\n",
    );
  });

  it("ホストを削除すると、ブリッジの位置も消える", () => {
    const { topology, base } = load(text);
    removeDevices(topology, ["pve1"]);
    expect(serializeTopology(topology, base).text).not.toContain("vmbr0: { x");
  });

  it("キーの IF 名の書き方が違っても、同じブリッジの位置として書き換える", () => {
    const { topology, base } = load(text.replace("pve1:vmbr0:", "pve1:VMBR0:"));
    topology.layout.set("pve1:vmbr0", { x: 5, y: 125 });
    const out = serializeTopology(topology, base).text;
    expect(out).toContain("  pve1:vmbr0: { x: 5, y: 125 }\n");
    expect(out).not.toContain("VMBR0");
  });
});

describe("serializeTopology: ラベルの位置(layout._labels。SPEC 4.3)", () => {
  const text = `constella: 1
devices:
  r1: { model: generic-router-4 }
  r2: { model: generic-router-4 }
links:
  - { a: r1:Gi0/0, b: r2:Gi0/0 }
layout:
  r1: { x: 0, y: 0 }
  r2: { x: 300, y: 0 }
  _labels:
    # 手で動かした
    r1:Gi0/0: { along: 60, side: -8 }
`;

  it("読み込むと、IF 名を短い形にしたキーで覚える", () => {
    const { topology } = load(text.replace("r1:Gi0/0: {", "r1:GigabitEthernet0/0: {"));
    expect([...topology.labelLayout]).toEqual([["r1:Gi0/0", { along: 60, side: -8 }]]);
  });

  it("動かしたラベルの項目だけを書き換え・足し、コメントは残す", () => {
    const { topology, base } = load(text);
    setLabelOffset(topology, "r1:Gi0/0", { along: 72.4, side: 10 });
    setLabelOffset(topology, "r2:Gi0/0", { along: 50, side: 0 });
    expect(serializeTopology(topology, base).text).toContain(
      "  _labels:\n    # 手で動かした\n    r1:Gi0/0: { along: 72, side: 10 }\n" +
        "    r2:Gi0/0: { along: 50, side: 0 }\n",
    );
  });

  it("layout が無くても書く", () => {
    const { topology, base } = load("constella: 1\nlinks:\n  - { a: r1:e0, b: r2:e0 }\n");
    setLabelOffset(topology, "r1:e0", { along: 40, side: 4 });
    expect(serializeTopology(topology, base).text).toContain(
      "layout:\n  _labels:\n    r1:e0: { along: 40, side: 4 }\n",
    );
  });

  it("すべて戻すと _labels ごと消し、座標は残す", () => {
    const { topology, base } = load(text);
    resetLabels(topology);
    const out = serializeTopology(topology, base).text;
    expect(out).not.toContain("_labels");
    expect(out).toContain("layout:\n  r1: { x: 0, y: 0 }\n  r2: { x: 300, y: 0 }\n");
  });

  it("デバイスの ID を変えるとキーを書き換え、デバイスを消すと項目も消す", () => {
    const renamed = load(text);
    renameDevice(renamed.topology, "r1", "edge1");
    expect(serializeTopology(renamed.topology, renamed.base).text).toContain(
      "    # 手で動かした\n    edge1:Gi0/0: { along: 60, side: -8 }\n",
    );
    const removed = load(text);
    removeDevices(removed.topology, ["r1"]);
    expect(serializeTopology(removed.topology, removed.base).text).not.toContain("_labels");
  });

  it("キーの IF 名の書き方が違っても同じラベルとみなし、今の表記にそろえる", () => {
    const { topology, base } = load(text.replace("r1:Gi0/0: {", "r1:GigabitEthernet0/0: {"));
    setLabelOffset(topology, "r1:Gi0/0", { along: 30, side: 2 });
    const out = serializeTopology(topology, base).text;
    expect(out).toContain("    r1:Gi0/0: { along: 30, side: 2 }\n");
    expect(out).not.toContain("GigabitEthernet");
  });
});

describe("serializeTopology: 曲げた線の点(layout._bends。SPEC 4.3)", () => {
  const text = `constella: 1
devices:
  r1: { model: generic-router-4 }
  r2: { model: generic-router-4 }
links:
  - { a: r1:Gi0/0, b: r2:Gi0/0 }
layout:
  r1: { x: 0, y: 0 }
  r2: { x: 300, y: 0 }
  _bends:
    # 手で曲げた
    r1 r2:
      - { x: 150, y: 80 }
`;

  it("曲げた線の項目だけを書き換え(1 行の配列で書く)、コメントは残す", () => {
    const { topology, base } = load(text);
    setBends(topology, "r1 r2", [
      { x: 150, y: 90.4 },
      { x: 200, y: 90 },
    ]);
    expect(serializeTopology(topology, base).text).toContain(
      "  _bends:\n    # 手で曲げた\n    r1 r2: [ { x: 150, y: 90 }, { x: 200, y: 90 } ]\n",
    );
  });

  it("点を変えていなければ、書き方をそのまま残す", () => {
    const { topology, base } = load(text);
    topology.layout.set("r1", { x: 10, y: 0 });
    expect(serializeTopology(topology, base).text).toContain(
      "    r1 r2:\n      - { x: 150, y: 80 }\n",
    );
  });

  it("キーが名前の順でなければ、名前の順に直して点も並べ直す", () => {
    const { topology, base } = load(
      text.replace(
        "r1 r2:\n      - { x: 150, y: 80 }",
        "r2 r1: [ { x: 1, y: 2 }, { x: 3, y: 4 } ]",
      ),
    );
    topology.layout.set("r1", { x: 10, y: 0 });
    expect(serializeTopology(topology, base).text).toContain(
      "    r1 r2: [ { x: 3, y: 4 }, { x: 1, y: 2 } ]\n",
    );
  });

  it("layout が無くても書き、すべてまっすぐに戻すと _bends ごと消す", () => {
    const empty = load("constella: 1\nlinks:\n  - { a: r1:e0, b: r2:e0 }\n");
    setBends(empty.topology, "r1 r2", [{ x: 40, y: 4 }]);
    expect(serializeTopology(empty.topology, empty.base).text).toContain(
      "layout:\n  _bends:\n    r1 r2: [ { x: 40, y: 4 } ]\n",
    );
    const { topology, base } = load(text);
    resetBends(topology);
    const out = serializeTopology(topology, base).text;
    expect(out).not.toContain("_bends");
    expect(out).toContain("layout:\n  r1: { x: 0, y: 0 }\n  r2: { x: 300, y: 0 }\n");
  });

  it("デバイスの ID を変えるとキーを書き換え、デバイスを消すと項目も消す", () => {
    const renamed = load(text);
    renameDevice(renamed.topology, "r2", "a0");
    expect(serializeTopology(renamed.topology, renamed.base).text).toContain(
      "    # 手で曲げた\n    a0 r1:\n      - { x: 150, y: 80 }\n",
    );
    const removed = load(text);
    removeDevices(removed.topology, ["r1"]);
    expect(serializeTopology(removed.topology, removed.base).text).not.toContain("_bends");
  });
});

describe("serializeTopology: クラスタ(SPEC 4.6)", () => {
  const text = `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  pve2: { model: generic-hypervisor-4 }
groups:
  - id: lab
    kind: cluster
    members: [ pve1, pve2 ]
    networks:
      # クラスタの通信
      corosync: 10.10.0.0/24 # ring0
      migration: 10.30.0.0/24
`;

  it("ホストの ID を変えても、networks はコメントを保ったまま残す", () => {
    const { topology, base } = load(text);
    renameDevice(topology, "pve1", "pve-a");
    const out = serializeTopology(topology, base).text;
    expect(out).toContain("    members: [ pve-a, pve2 ]\n");
    expect(out).toContain(
      "    networks:\n      # クラスタの通信\n      corosync: 10.10.0.0/24 # ring0\n      migration: 10.30.0.0/24\n",
    );
  });

  it("networks の項目ごとに書き換え、ほかの項目のコメントは残す", () => {
    const { topology, base } = load(text);
    const networks = topology.groups[0].networks;
    if (!networks) throw new Error();
    networks.set("corosync", "10.10.1.0/24");
    networks.delete("migration");
    networks.set("ceph-public", "10.20.0.0/24");
    const out = serializeTopology(topology, base).text;
    expect(out).toContain(
      "    networks:\n      # クラスタの通信\n      corosync: 10.10.1.0/24 # ring0\n      ceph-public: 10.20.0.0/24\n",
    );
    expect(out).not.toContain("migration");
  });

  it("新しいグループの networks はブロックのマップで書き、消すと YAML からも消える", () => {
    const { topology, base } = load(text);
    topology.groups.push({
      id: "lab2",
      uid: "lab2-uid",
      kind: "cluster",
      members: ["pve2"],
      networks: new Map([["corosync", "10.11.0.0/24"]]),
      extra: {},
    });
    const out = serializeTopology(topology, base).text;
    expect(out).toContain(
      "  - id: lab2\n    kind: cluster\n    members: [ pve2 ]\n    networks:\n      corosync: 10.11.0.0/24\n",
    );
    const again = load(out);
    expect([...(again.topology.groups[1].networks ?? [])]).toEqual([["corosync", "10.11.0.0/24"]]);
    delete again.topology.groups[0].networks;
    expect(serializeTopology(again.topology, again.base).text).not.toContain("10.10.0.0/24");
  });

  it("解釈できなかった networks は書き換えずに残す", () => {
    const bad = text.replace("corosync: 10.10.0.0/24 # ring0", "corosync: 10 # ring0");
    const { topology, base } = load(bad);
    renameDevice(topology, "pve2", "pve-b");
    expect(serializeTopology(topology, base).text).toContain("      corosync: 10 # ring0\n");
  });
});

describe("serializeTopology: グループの追加・削除(SPEC 7.5)", () => {
  const text = `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-switch-24 }
groups:
  # 1 つ目
  - id: site1
    kind: site
    members: [ rt1, sw1 ] # 拠点
  # 2 つ目
  - id: rack1
    kind: rack
    members: [ rt1 ]
  # 3 つ目
  - id: rack2 # 予備
    kind: rack
    members: [ sw1 ]
`;

  it("途中のグループを消しても、ほかのグループの書き方とコメントは変えない", () => {
    const { topology, base } = load(text);
    removeGroup(topology, topology.groups[1].uid);
    expect(serializeTopology(topology, base).text).toBe(
      text.replace("  # 2 つ目\n  - id: rack1\n    kind: rack\n    members: [ rt1 ]\n", ""),
    );
  });

  it("消したあとに書き換えても、対応はずれない(読み直した base でも)", () => {
    const { topology, base } = load(text);
    removeGroup(topology, topology.groups[0].uid);
    const first = serializeTopology(topology, base);
    const rebased = rebaseOnText(first.text, topology, testCatalog);
    if (!rebased) throw new Error();
    updateGroup(topology, topology.groups[1].uid, { label: "予備のラック" });
    const out = serializeTopology(topology, rebased.base).text;
    expect(out).toContain("  # 2 つ目\n  - id: rack1\n    kind: rack\n    members: [ rt1 ]\n");
    expect(out).toContain(
      "  # 3 つ目\n  - id: rack2 # 予備\n    kind: rack\n    members: [ sw1 ]\n    label: 予備のラック\n",
    );
  });

  it("新しいグループは最後に足す", () => {
    const { topology, base } = load(text);
    addGroup(topology, ["sw1"]);
    expect(serializeTopology(topology, base).text).toBe(
      `${text}  - id: group1\n    members: [ sw1 ]\n`,
    );
  });

  it("すべて消したら groups ごと消す", () => {
    const { topology, base } = load(text);
    for (const group of [...topology.groups]) removeGroup(topology, group.uid);
    expect(serializeTopology(topology, base).text).not.toContain("groups");
  });

  it("グループでない項目(読めない値)は残す", () => {
    const { topology, base } = load(`${text}  - 42\n`);
    removeGroup(topology, topology.groups[2].uid);
    const out = serializeTopology(topology, base).text;
    expect(out).not.toContain("rack2");
    expect(out).toContain("  - 42\n");
  });
});

describe("serializeTopology: SDN(SPEC 4.6)", () => {
  const text = `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  pve2: { model: generic-hypervisor-4 }
sdn:
  zones:
    # VLAN ゾーン
    lan: { type: vlan, bridge: vmbr0, nodes: [ pve1, pve2 ] } # 2 台だけ
    vx:
      type: vxlan
  vnets:
    vnet30: { zone: lan, tag: 30, subnets: [ 10.30.0.0/24 ] }
`;

  it("何も変えなければ、そのまま書き出す", () => {
    const { topology, base } = load(text);
    expect(serializeTopology(topology, base).text).toBe(text);
  });

  it("ホストの ID を変える・消すと、nodes を書き換え、ほかの書き方とコメントは残す", () => {
    const { topology, base } = load(text);
    renameDevice(topology, "pve1", "pve-a");
    const renamed = serializeTopology(topology, base).text;
    expect(renamed).toContain(
      "    # VLAN ゾーン\n    lan: { type: vlan, bridge: vmbr0, nodes: [ pve-a, pve2 ] } # 2 台だけ\n",
    );
    expect(renamed).toContain("    vx:\n      type: vxlan\n");
    removeDevices(topology, ["pve2"]);
    expect(serializeTopology(topology, base).text).toContain("nodes: [ pve-a ] }");
  });

  it("新しく書き出しても、読み直すと同じ", () => {
    const { topology } = load(text);
    const out = serializeTopology(topology).text;
    expect(out).toContain("sdn:\n  zones:\n    lan:\n      type: vlan\n");
    // nodes・subnets は 1 行の配列
    expect(out).toContain("      nodes: [ pve1, pve2 ]\n");
    expect(out).toContain("      subnets: [ 10.30.0.0/24 ]\n");
    const again = load(out).topology;
    expect([...again.sdn.zones]).toEqual([...topology.sdn.zones]);
    expect([...again.sdn.vnets]).toEqual([...topology.sdn.vnets]);
  });
});
