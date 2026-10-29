import { describe, expect, it } from "vitest";
import { guestsBelow, hostTree, resolveGuest } from "./hosts";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(devices: string): Topology {
  const result = parseTopology(`constella: 1\ndevices:\n${devices}`, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("resolveGuest", () => {
  it("デバイスの guest、モデルの guest、host があれば vm の順に決める", () => {
    const t = load(
      [
        "  pve1: { model: generic-hypervisor-4 }",
        "  a: { model: generic-container, guest: vm }",
        "  b: { model: generic-container }",
        "  c: { model: generic-server-2, host: pve1 }",
        "  d: { guest: container }",
        "  e: { model: generic-server-2 }",
        "",
      ].join("\n"),
    );
    const kind = (id: string) => {
      const device = t.devices.get(id);
      return device && resolveGuest(device, testCatalog);
    };
    expect(["a", "b", "c", "d", "e", "pve1"].map(kind)).toEqual([
      "vm",
      "container",
      "vm",
      "container",
      undefined,
      undefined,
    ]);
  });
});

describe("hostTree", () => {
  it("ゲストとホストの対応を、YAML に書いた順に作る", () => {
    const tree = hostTree(
      load(
        [
          "  pve1: {}",
          "  pve2: {}",
          "  vm1: { host: pve1 }",
          "  vm2: { host: pve2 }",
          "  vm3: { host: pve1 }",
          "",
        ].join("\n"),
      ),
    );
    expect([...tree.hostOf]).toEqual([
      ["vm1", "pve1"],
      ["vm2", "pve2"],
      ["vm3", "pve1"],
    ]);
    expect([...tree.guestsOf]).toEqual([
      ["pve1", ["vm1", "vm3"]],
      ["pve2", ["vm2"]],
    ]);
    expect(tree.cycles).toEqual([]);
  });

  it("図に無いホストは対応に入れない", () => {
    const tree = hostTree(load("  vm1: { host: ghost }\n"));
    expect(tree.hostOf.size).toBe(0);
    expect(tree.guestsOf.size).toBe(0);
  });

  it("輪になる host を見つけ、輪の中のデバイスは対応に入れない", () => {
    const tree = hostTree(
      load(
        [
          "  self: { host: self }",
          "  a: { host: b }",
          "  b: { host: a }",
          "  c: { host: a }",
          "",
        ].join("\n"),
      ),
    );
    expect(tree.cycles).toEqual([["self"], ["a", "b"]]);
    // 輪につながるだけのデバイスは、輪の中のホストのゲストとして扱う
    expect([...tree.hostOf]).toEqual([["c", "a"]]);
  });
});

describe("guestsBelow", () => {
  it("入れ子のゲストも、ホストに近い順に返す", () => {
    const t = load(
      [
        "  pve1: {}",
        "  nested: { host: pve1 }",
        "  vm1: { host: pve1 }",
        "  inner: { host: nested }",
        "  other: {}",
        "",
      ].join("\n"),
    );
    const tree = hostTree(t);
    expect(guestsBelow(tree, "pve1")).toEqual(["nested", "vm1", "inner"]);
    expect(guestsBelow(tree, "nested")).toEqual(["inner"]);
    expect(guestsBelow(tree, "other")).toEqual([]);
  });
});
