import { describe, expect, it } from "vitest";
import { buildCatalog, type ModelParseResult, parseModelDefinition } from "./modelLibrary";
import type { DeviceModel } from "./types";

function model(text: string): DeviceModel {
  const result = parseModelDefinition(text);
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.model;
}

function errors(result: ModelParseResult): string[] {
  expect(result.ok).toBe(false);
  return result.issues.filter((i) => i.severity === "error").map((i) => i.message);
}

describe("parseModelDefinition", () => {
  it("guest を読み、不正な値はエラー(SPEC 5.1・4.6)", () => {
    expect(model("id: v\nrole: server\nflexible: true\nguest: container\n").guest).toBe(
      "container",
    );
    expect(model("id: s\nrole: server\nflexible: true\n")).not.toHaveProperty("guest");
    expect(
      errors(parseModelDefinition("id: v\nrole: server\nflexible: true\nguest: lxc\n")),
    ).toEqual(["guest の値が不正です(vm / container)"]);
  });

  it("SPEC 5.1 の例", () => {
    const m = model(`id: cisco-c2960-24tt-l
vendor: Cisco
name: Catalyst 2960-24TT-L
role: l2switch
ports:
  - name: "FastEthernet0/{1-24}"
    type: rj45
    speed: 100M
  - name: "GigabitEthernet0/{1-2}"
    type: rj45
    speed: 1G
`);
    expect(m.id).toBe("cisco-c2960-24tt-l");
    expect(m.vendor).toBe("Cisco");
    expect(m.name).toBe("Catalyst 2960-24TT-L");
    expect(m.role).toBe("l2switch");
    expect(m.flexible).toBe(false);
    expect(m.ports).toHaveLength(26);
    expect(m.ports[0]).toEqual({ name: "Fa0/1", type: "rj45", speed: "100M" });
    expect(m.ports[25]).toEqual({ name: "Gi0/2", type: "rj45", speed: "1G" });
  });

  it("flexible なモデルは ports を省略できる", () => {
    const m = model("id: generic-cloud\nrole: cloud\nflexible: true\n");
    expect(m).toEqual({ id: "generic-cloud", role: "cloud", ports: [], flexible: true });
  });

  it("icon と speed は省略できる", () => {
    const m = model("id: x\nrole: pc\nicon: laptop\nports:\n  - name: eth0\n    type: rj45\n");
    expect(m.icon).toBe("laptop");
    expect(m.ports).toEqual([{ name: "eth0", type: "rj45" }]);
  });

  it("id と role は必須(Q3)", () => {
    expect(errors(parseModelDefinition("ports: []\n"))).toEqual([
      "id がありません",
      "role がありません",
    ]);
  });

  it("flexible でなければ ports は必須(Q3)", () => {
    expect(errors(parseModelDefinition("id: x\nrole: router\n"))).toEqual([
      "ports がありません(flexible: true のときだけ省略できます)",
    ]);
  });

  it("不正な値", () => {
    const result = parseModelDefinition(`id: x
role: toaster
flexible: yes-please
ports:
  - name: eth0
    type: usb
  - type: rj45
  - just-a-name
`);
    expect(errors(result)).toEqual([
      "role の値が不正です(router / l2switch / l3switch / firewall / server / hypervisor / pc / ap / cloud / generic)",
      "flexible は true か false で書いてください",
      expect.stringContaining("ポートの type の値が不正です"),
      "name がありません",
      "ポートは name と type を持つマップで書いてください",
    ]);
  });

  it("連番の書き間違いはエラー", () => {
    expect(
      errors(parseModelDefinition("id: x\nrole: pc\nports:\n  - name: eth{1-}\n    type: rj45\n")),
    ).toEqual([expect.stringContaining("{開始-終了} の形")]);
  });

  it("展開後のポート名の重なりはエラー(長い形・短い形、大文字小文字の違いも同じ名前)", () => {
    const result = parseModelDefinition(`id: x
role: l2switch
ports:
  - name: "Gi0/{1-4}"
    type: rj45
  - name: "GigabitEthernet0/{4-5}"
    type: sfp
`);
    expect(errors(result)).toEqual(["ポート「GigabitEthernet0/4」が「Gi0/4」と重なっています"]);
  });

  it("未知のキーは警告(モデルは使える)", () => {
    const result = parseModelDefinition(
      "id: x\nrole: pc\nprice: 100\nports:\n  - name: eth0\n    type: rj45\n    poe: true\n",
    );
    expect(result.ok).toBe(true);
    expect(result.issues.map((i) => i.severity)).toEqual(["warning", "warning"]);
  });

  it("問題には位置が付く", () => {
    const text = "id: x\nrole: toaster\nports: []\n";
    const result = parseModelDefinition(text);
    const range = result.issues[0].range;
    expect(range && text.slice(range.start, range.end)).toBe("toaster");
  });

  it("YAML の構文エラー", () => {
    expect(errors(parseModelDefinition("id: [\n"))[0]).toContain("YAML の構文エラー");
  });
});

describe("buildCatalog", () => {
  const a: DeviceModel = { id: "a", role: "pc", ports: [], flexible: false };
  const b: DeviceModel = { id: "b", role: "pc", ports: [], flexible: false };

  it("同じ id は後から渡したもの(ユーザーモデル)が優先される", () => {
    const user: DeviceModel = { ...a, name: "user version" };
    const catalog = buildCatalog([a, b], [user]);
    expect(catalog.get("a")).toBe(user);
    expect(catalog.get("b")).toBe(b);
    expect(catalog.size).toBe(2);
  });
});
