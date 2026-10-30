import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { placeNearHost } from "./placement";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

/** pve1 と pve2 を、枠が近くなるように並べた図 */
const text = `constella: 1
devices:
  pve1:
    interfaces:
      vmbr0: { type: bridge }
      vmbr1: { type: bridge }
  pve2:
    interfaces:
      vmbr0: { type: bridge }
  vm1: { host: pve1 }
  vm2: { host: pve2 }
layout:
  pve1: { x: 200, y: 0 }
  pve1:vmbr0: { x: 100, y: 196 }
  pve1:vmbr1: { x: 296, y: 196 }
  vm1: { x: 200, y: 336 }
  pve2: { x: 560, y: 0 }
  pve2:vmbr0: { x: 560, y: 196 }
  vm2: { x: 560, y: 336 }
`;

function load(): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("placeNearHost(フェーズ4-2)", () => {
  const t = load();
  const at = (id: string) => t.layout.get(id);

  it("右がほかのホストの枠とぶつかるなら、同じ段の左に置く", () => {
    // 右(492)は pve2 の枠(540〜)の近くなので、左(-96)
    expect(placeNearHost(t, at, "pve1", "bridge")).toEqual({ x: -96, y: 196 });
  });

  it("空いていれば、同じ段の右に置く", () => {
    expect(placeNearHost(t, at, "pve2", "bridge")).toEqual({ x: 756, y: 196 });
    expect(placeNearHost(t, at, "pve2", "guest")).toEqual({ x: 756, y: 336 });
  });

  it("左右ともぶつかるなら、下の段(ホストの真下)に置く", () => {
    const crowded = load();
    crowded.devices.set("wall", { id: "wall", uid: "wall", interfaces: new Map(), extra: {} });
    crowded.layout.set("wall", { x: 0, y: 196 });
    expect(placeNearHost(crowded, (id) => crowded.layout.get(id), "pve1", "bridge")).toEqual({
      x: 200,
      y: 256,
    });
  });

  it("ホストに座標が無ければ undefined", () => {
    expect(placeNearHost(t, () => undefined, "pve1", "bridge")).toBeUndefined();
  });
});
