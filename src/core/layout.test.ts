import { describe, expect, it } from "vitest";
import { computeLayout, placeMissing } from "./layout";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

/** 座標の無い、上下が入れ替わった順で書いた図 */
const handWritten = `constella: 1
devices:
  srv1: { model: generic-server-2 }
  sw1: { model: generic-l2switch-24 }
  rt1: { model: generic-router-4 }
  isp: { role: cloud }
  lab: { role: generic }
  pc1: { role: pc }
links:
  - { a: srv1:eth0, b: sw1:Gi0/1 }
  - { a: sw1:Gi0/24, b: rt1:Gi0/1 }
  - { a: rt1:Gi0/0, b: isp:wan }
  - { a: rt1:Gi0/2, b: rt1:Gi0/3 }
`;

describe("computeLayout", () => {
  it("role の段の順に、上から下へ並べる", async () => {
    const pos = await computeLayout(load(handWritten), testCatalog);
    const y = (id: string) => pos.get(id)?.y ?? NaN;
    expect(pos.size).toBe(6);
    expect(y("isp")).toBeLessThan(y("rt1"));
    expect(y("rt1")).toBeLessThan(y("sw1"));
    expect(y("sw1")).toBeLessThan(y("srv1"));
    // generic は l2switch と同じ段、つながっていない pc も server と同じ段
    expect(y("lab")).toBe(y("sw1"));
    expect(y("pc1")).toBe(y("srv1"));
  });

  it("同じ入力なら同じ結果になる", async () => {
    const t = load(handWritten);
    const a = await computeLayout(t, testCatalog);
    const b = await computeLayout(t, testCatalog);
    expect([...a]).toEqual([...b]);
  });

  it("指定したデバイスだけを並べる", async () => {
    const pos = await computeLayout(load(handWritten), testCatalog, { devices: ["rt1", "isp"] });
    expect([...pos.keys()].sort()).toEqual(["isp", "rt1"]);
  });
});

describe("placeMissing", () => {
  it("座標の無いデバイスを、既にある座標の下に置く", async () => {
    const t = load(handWritten);
    const pos = await placeMissing(
      t,
      testCatalog,
      ["srv1", "sw1"],
      [
        { x: 100, y: 0 },
        { x: 300, y: 200 },
      ],
    );
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(100);
    expect(Math.min(...[...pos.values()].map((p) => p.y))).toBeGreaterThan(200);
    expect((pos.get("sw1")?.y ?? 0) < (pos.get("srv1")?.y ?? 0)).toBe(true);
  });
});
