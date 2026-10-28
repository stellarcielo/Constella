import { describe, expect, it } from "vitest";
import { extractFragment, fragmentToText, parseFragment, pasteFragment } from "./fragment";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text = specExample): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("extractFragment", () => {
  it("選んだデバイスと、その間で完結するリンクと座標を取り出す", () => {
    const t = load();
    const fragment = extractFragment(t, ["rt1", "core-sw1"]);
    expect([...fragment.devices.keys()]).toEqual(["rt1", "core-sw1"]);
    expect(fragment.links.map((l) => [l.a?.device, l.b?.device])).toEqual([["rt1", "core-sw1"]]);
    expect([...fragment.layout.keys()]).toEqual(["rt1", "core-sw1"]);
    expect(fragment.devices.get("core-sw1")?.interfaces.get("Gi0/1")?.description).toBe("to rt1");
  });

  it("元の図とは別のオブジェクト", () => {
    const t = load();
    const fragment = extractFragment(t, ["rt1"]);
    expect(fragment.devices.get("rt1")).not.toBe(t.devices.get("rt1"));
  });
});

describe("fragmentToText / parseFragment", () => {
  it("YAML の文字列にして読み戻せる", () => {
    const t = load();
    const text = fragmentToText(extractFragment(t, ["rt1", "core-sw1"]));
    expect(text.startsWith("constella: 1\n")).toBe(true);
    const back = parseFragment(text, testCatalog);
    expect([...(back?.devices.keys() ?? [])]).toEqual(["rt1", "core-sw1"]);
    expect(back?.links).toHaveLength(1);
  });

  it("外で書いた断片は constella の行が無くても受け付ける", () => {
    const back = parseFragment("devices:\n  r1: { model: generic-router-4 }\n", testCatalog);
    expect([...(back?.devices.keys() ?? [])]).toEqual(["r1"]);
  });

  it("デバイスが無い、または YAML でなければ undefined", () => {
    expect(parseFragment("hello", testCatalog)).toBeUndefined();
    expect(parseFragment("foo: bar\n", testCatalog)).toBeUndefined();
    expect(parseFragment("constella: 1\ndevices: [\n", testCatalog)).toBeUndefined();
  });
});

describe("pasteFragment", () => {
  it("ID を role ごとに振り直し、リンクの両端も付け替え、座標をずらす", () => {
    const t = load();
    const fragment = extractFragment(t, ["rt1", "core-sw1"]);
    const pasted = pasteFragment(t, fragment, testCatalog, { x: 40, y: 40 });
    expect(pasted.devices).toEqual(["rt2", "sw1"]);
    expect(t.devices.get("rt2")?.label).toBe("Edge Router");
    expect(t.devices.get("rt2")?.uid).not.toBe(t.devices.get("rt1")?.uid);
    expect(t.layout.get("rt2")).toEqual({ x: 340, y: 120 });
    const link = t.links.find((l) => l.id === pasted.links[0]);
    expect([link?.a, link?.b]).toEqual([
      { device: "rt2", iface: "Gi0/1" },
      { device: "sw1", iface: "Gi0/1" },
    ]);
  });

  it("断片の中で両端がそろわないリンクは追加しない", () => {
    const t = load();
    const fragment = load(
      "constella: 1\ndevices:\n  a: { model: generic-router-4 }\nlinks:\n  - a: a:Gi0/0\n    b: rt1:Gi0/3\n",
    );
    const pasted = pasteFragment(t, fragment, testCatalog, { x: 0, y: 0 });
    expect(pasted).toEqual({ devices: ["rt2"], links: [] });
  });

  it("座標の無いデバイスは座標を付けない(自動で並べる)", () => {
    const t = load();
    const fragment = load("constella: 1\ndevices:\n  x: { role: cloud }\n");
    pasteFragment(t, fragment, testCatalog, { x: 40, y: 40 });
    expect(t.devices.has("cloud1")).toBe(true);
    expect(t.layout.has("cloud1")).toBe(false);
  });
});
