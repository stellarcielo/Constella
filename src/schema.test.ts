// JSON Schema(schema/constella.schema.json)と examples のテスト(SPEC 11章・14章)。
// Schema は手書きなので、型定義やパーサーとズレていないことをここで確かめる。

import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import schema from "../schema/constella.schema.json";
import {
  DEVICE_ID_PATTERN,
  FORMAT_VERSION,
  GROUP_KINDS,
  INTERFACE_MODES,
  MEDIA,
  parseTopology,
  ROLES,
  SCHEMA_COMMENT,
  SCHEMA_URL,
  serializeTopology,
  type Topology,
  validateTopology,
} from "./core";
import { specExample } from "./core/testFixtures";
import { builtinCatalog } from "./library";

const examples = import.meta.glob<string>("../examples/*.constella.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ajv = new Ajv({ strict: true, allowUnionTypes: true, allErrors: true });
const validateSchema = ajv.compile(schema);
const catalog = builtinCatalog();

function schemaAccepts(text: string): boolean {
  return validateSchema(parseYaml(text));
}

/** パーサーが問題なく読めるか(モデルや参照先の有無は見ない。それは Schema では書けない) */
function parserAccepts(text: string): boolean {
  const result = parseTopology(text);
  return result.ok && result.issues.length === 0;
}

/** 意味の比較用。メモリ上だけの識別子(uid・リンクID)を除く */
function semantic(t: Topology) {
  return {
    meta: t.meta,
    devices: [...t.devices.values()].map((d) => ({
      id: d.id,
      model: d.model,
      role: d.role,
      label: d.label,
      interfaces: [...d.interfaces],
      extra: d.extra,
    })),
    links: t.links.map((l) => ({ a: l.a, b: l.b, media: l.media, label: l.label, extra: l.extra })),
    layout: [...t.layout],
    viewport: t.viewport,
    groups: t.groups,
    extra: t.extra,
  };
}

describe("JSON Schema", () => {
  it("draft-07 の Schema として正しい", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
  });

  it("型定義と一致している", () => {
    expect(schema.$id).toBe(SCHEMA_URL);
    expect(schema.properties.constella.const).toBe(FORMAT_VERSION);
    expect(schema.definitions.role.enum).toEqual([...ROLES]);
    expect(schema.definitions.media.enum).toEqual([...MEDIA]);
    expect(schema.definitions.interfaceMode.enum).toEqual([...INTERFACE_MODES]);
    expect(schema.definitions.groupKind.enum).toEqual([...GROUP_KINDS]);
    expect(schema.definitions.deviceId.pattern).toBe(DEVICE_ID_PATTERN.source);
    expect(Object.keys(schema.properties.layout.patternProperties)).toEqual([
      DEVICE_ID_PATTERN.source,
    ]);
    expect(schema.definitions.endpoint.pattern).toBe(
      `${DEVICE_ID_PATTERN.source.replace(/\$$/, "")}:\\s*\\S`,
    );
  });

  it("model の説明に、組み込みモデルがすべて載っている", () => {
    for (const id of catalog.keys()) {
      expect(schema.definitions.device.properties.model.description).toContain(id);
    }
  });

  it("SPEC 4.2 の例が通る", () => {
    expect(specExample.split("\n")[0]).toBe(SCHEMA_COMMENT);
    expect(schemaAccepts(specExample)).toBe(true);
  });

  // パーサーが問題なく読めるものは Schema も通し、パーサーが問題にするものは Schema も通さない
  const accepted: [string, string][] = [
    ["最小", "constella: 1\n"],
    ["空のセクション", "constella: 1\nmeta:\ndevices:\nlinks:\nlayout:\ngroups:\n"],
    [
      "すべての項目",
      `constella: 1
meta: { title: t, description: d }
devices:
  r1:
    model: generic-router-4
    role: router
    label: 2960
    interfaces:
      GigabitEthernet0/1: { description: up, ip: [ 192.0.2.1/30 ], mode: trunk, vlans: 10 }
      Gi0/2: { mode: access, vlan: 4094 }
      Gi0/3:
  r2:
links:
  - { a: "r1:Gi0/1", b: "r2:eth 0", media: fiber, label: 1 }
layout:
  _viewport: { x: 0, y: 0, zoom: 1.5 }
  r1: { x: -10.5, y: 20 }
groups:
  - { id: g1, kind: rack, label: Rack, members: [ r1, r2 ] }
`,
    ],
  ];
  const rejected: [string, string][] = [
    ["バージョンが無い", "devices: {}\n"],
    ["バージョン違い", "constella: 2\n"],
    ["最上位の未知のキー", "constella: 1\nowner: me\n"],
    ["機器の未知のキー", "constella: 1\ndevices:\n  r1: { vendor: acme }\n"],
    ["使えないデバイスID", 'constella: 1\ndevices:\n  "bad id": {}\n'],
    ["不正な role", "constella: 1\ndevices:\n  r1: { role: switch }\n"],
    ["空の model", 'constella: 1\ndevices:\n  r1: { model: "" }\n'],
    ["値の無い label", "constella: 1\ndevices:\n  r1: { label: }\n"],
    ["範囲外の VLAN", "constella: 1\ndevices:\n  r1:\n    interfaces:\n      e0: { vlan: 5000 }\n"],
    ["不正な mode", "constella: 1\ndevices:\n  r1:\n    interfaces:\n      e0: { mode: hybrid }\n"],
    [
      "配列でない ip",
      "constella: 1\ndevices:\n  r1:\n    interfaces:\n      e0: { ip: 192.0.2.1 }\n",
    ],
    ["配列でない links", "constella: 1\nlinks: {}\n"],
    ["b の無いリンク", "constella: 1\nlinks:\n  - { a: r1:e0 }\n"],
    [": の無いエンドポイント", "constella: 1\nlinks:\n  - { a: r1, b: r2:e0 }\n"],
    ["IF 名の無いエンドポイント", 'constella: 1\nlinks:\n  - { a: "r1:", b: r2:e0 }\n'],
    ["不正な media", "constella: 1\nlinks:\n  - { a: r1:e0, b: r2:e0, media: laser }\n"],
    ["リンクの未知のキー", "constella: 1\nlinks:\n  - { a: r1:e0, b: r2:e0, speed: 1G }\n"],
    ["数値でない座標", "constella: 1\nlayout:\n  r1: { x: 1, y: up }\n"],
    ["座標の未知のキー", "constella: 1\nlayout:\n  r1: { x: 1, y: 2, z: 3 }\n"],
    ["zoom の無い _viewport", "constella: 1\nlayout:\n  _viewport: { x: 0, y: 0 }\n"],
    ["id の無いグループ", "constella: 1\ngroups:\n  - { kind: rack }\n"],
    ["不正な kind", "constella: 1\ngroups:\n  - { id: g1, kind: floor }\n"],
  ];

  it.each(accepted)("パーサーと同じく受け付ける: %s", (_name, text) => {
    expect(parserAccepts(text)).toBe(true);
    expect(schemaAccepts(text)).toBe(true);
  });

  it.each(rejected)("パーサーと同じく問題にする: %s", (_name, text) => {
    expect(parserAccepts(text)).toBe(false);
    expect(schemaAccepts(text)).toBe(false);
  });
});

describe("examples(SPEC 11章)", () => {
  const entries = Object.entries(examples);

  it("小規模ラボ・2層スイッチ網・冗長構成 + LAG の 3 つがある", () => {
    expect(entries.map(([path]) => path.split("/").pop()).sort()).toEqual([
      "redundant-lag.constella.yaml",
      "small-lab.constella.yaml",
      "two-tier.constella.yaml",
    ]);
  });

  describe.each(entries)("%s", (_path, text) => {
    const result = parseTopology(text, { catalog });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    it("先頭に Schema のコメントがあり、Schema に通る", () => {
      expect(text.split("\n")[0]).toBe(SCHEMA_COMMENT);
      expect(schemaAccepts(text)).toBe(true);
    });

    it("組み込みモデルで読むと、エラーも警告も無い", () => {
      const issues = [...result.issues, ...validateTopology(result.topology, catalog, result.base)];
      expect(issues).toEqual([]);
    });

    it("座標を書かず、接続だけで書いている(開くと自動で配置される)", () => {
      expect(result.topology.layout.size).toBe(0);
      expect(result.topology.devices.size).toBeGreaterThan(0);
    });

    it("往復: 何も変えずに書き出すと、同じ文字列になる(コメントも残る)", () => {
      expect(serializeTopology(result.topology, result.base).text).toBe(text);
    });

    it("往復: 新しく書き出した YAML を読み直すと、意味が同じ", () => {
      const again = parseTopology(serializeTopology(result.topology).text, { catalog });
      if (!again.ok) throw new Error(JSON.stringify(again.issues));
      expect(semantic(again.topology)).toEqual(semantic(result.topology));
    });
  });
});
