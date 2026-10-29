import { describe, expect, it } from "vitest";
import { parseTopology, validateTopology } from "../core";
import { specExample } from "../core/testFixtures";
import { builtinCatalog, builtinModelText, loadBuiltinModels } from "./index";

describe("組み込みモデル", () => {
  const { models, problems } = loadBuiltinModels();

  it("すべて問題なく読める", () => {
    expect(problems).toEqual([]);
  });

  it("SPEC 5.3 の 12 機種がそろっていて、ポート数が正しい", () => {
    const counts = Object.fromEntries(models.map((m) => [m.id, m.ports.length]));
    expect(counts).toEqual({
      "cisco-c2960-24tt-l": 26,
      "generic-ap": 2,
      "generic-cloud": 0,
      "generic-container": 4,
      "generic-firewall-8": 8,
      "generic-hypervisor-4": 4,
      "generic-l2switch-24": 28,
      "generic-l3switch-48": 52,
      "generic-pc": 1,
      "generic-router-4": 4,
      "generic-server-2": 2,
      "generic-vm": 4,
    });
  });

  it("仮想化のモデル(SPEC 5.3・4.6)", () => {
    const catalog = builtinCatalog();
    expect(catalog.get("generic-hypervisor-4")?.role).toBe("hypervisor");
    expect(catalog.get("generic-hypervisor-4")?.ports.map((p) => p.name)).toEqual([
      "eno1",
      "eno2",
      "eno3",
      "eno4",
    ]);
    for (const [id, guest] of [
      ["generic-vm", "vm"],
      ["generic-container", "container"],
    ] as const) {
      expect(catalog.get(id)).toMatchObject({ role: "server", flexible: true, guest });
      expect(catalog.get(id)?.ports.map((p) => [p.name, p.type])).toEqual([
        ["net0", "virtual"],
        ["net1", "virtual"],
        ["net2", "virtual"],
        ["net3", "virtual"],
      ]);
    }
  });

  it("ファイル名と id が一致する(Q4)", () => {
    const files = Object.keys(import.meta.glob("./models/*.yaml")).map((p) =>
      p.replace("./models/", "").replace(/\.yaml$/, ""),
    );
    expect(files.sort()).toEqual(models.map((m) => m.id).sort());
  });

  it("ポート名と種別", () => {
    const catalog = builtinCatalog();
    const names = (id: string) => catalog.get(id)?.ports.map((p) => p.name);
    expect(names("generic-router-4")).toEqual(["Gi0/0", "Gi0/1", "Gi0/2", "Gi0/3"]);
    expect(names("generic-l2switch-24")?.slice(22)).toEqual([
      "Gi0/23",
      "Gi0/24",
      "Te0/25",
      "Te0/26",
      "Te0/27",
      "Te0/28",
    ]);
    expect(names("generic-l3switch-48")?.slice(47)).toEqual([
      "Gi1/0/48",
      "Te1/1/1",
      "Te1/1/2",
      "Te1/1/3",
      "Te1/1/4",
    ]);
    expect(names("generic-firewall-8")?.[7]).toBe("port8");
    expect(names("generic-server-2")).toEqual(["eth0", "eth1"]);
    expect(catalog.get("generic-ap")?.ports).toEqual([
      { name: "eth0", type: "rj45", speed: "1G" },
      { name: "wlan0", type: "wireless" },
    ]);
    expect(catalog.get("generic-l2switch-24")?.ports[24]).toEqual({
      name: "Te0/25",
      type: "sfp+",
      speed: "10G",
    });
    expect(catalog.get("generic-cloud")?.flexible).toBe(true);
  });

  it("SPEC 4.2 の例を組み込みモデルで検証すると問題が無い", () => {
    const catalog = builtinCatalog();
    const result = parseTopology(specExample, { catalog });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.issues).toEqual([]);
    expect(validateTopology(result.topology, catalog, result.base)).toEqual([]);
  });
});

describe("builtinModelText(フェーズ3-4)", () => {
  it("組み込みモデルの定義の YAML を、連番のパターンのまま返す(複製して作るとき用)", () => {
    expect(builtinModelText("cisco-c2960-24tt-l")).toContain('name: "FastEthernet0/{1-24}"');
    expect(builtinModelText("no-such-model")).toBeUndefined();
  });
});
