import { describe, expect, it } from "vitest";
import { guestDropTarget, hostCandidates } from "./guestDrop";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

const text = `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  vm1: { model: generic-vm, host: pve1 }
  pve2: { model: generic-hypervisor-4 }
  sw1: { model: generic-l2switch-24 }
  nested: { model: generic-vm, host: vm1 }
layout:
  pve1: { x: 0, y: 0 }
  vm1: { x: 0, y: 200 }
  nested: { x: 0, y: 400 }
  pve2: { x: 600, y: 0 }
  sw1: { x: 300, y: -300 }
`;

function load(): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("guestDropTarget(フェーズ4-1 Q2)", () => {
  const t = load();
  const at = (id: string) => t.layout.get(id);
  const drop = (x: number, y: number) => guestDropTarget(t, testCatalog, at, { x, y });

  it("ハイパーバイザの上に落とすと、そのホストのゲストにして、ホストの下に並べる", () => {
    // ゲストのいないホスト: ホストの下の段
    expect(drop(640, 30)).toEqual({ host: "pve2", position: { x: 600, y: 196 } });
    // ゲストのいるホスト: 今のゲストの右
    expect(drop(40, 30)).toEqual({ host: "pve1", position: { x: 196, y: 200 } });
  });

  it("ホストの枠の中に落とすと、いちばん内側の枠のホストのゲストにする(位置は落とした所)", () => {
    // vm1 の枠(左端 -20)の外で、pve1 の枠(左端 -34)の中
    expect(drop(-28, 300)).toEqual({ host: "pve1" });
    expect(drop(-10, 300)).toEqual({ host: "vm1" });
  });

  it("それ以外の所や、ハイパーバイザでない機器の上ならホストなし", () => {
    expect(drop(300, 600)).toBeUndefined();
    expect(drop(330, -270)).toBeUndefined();
  });

  it("隠しているゲストの枠には入れない", () => {
    const hidden = (id: string) => (id === "vm1" || id === "nested" ? undefined : at(id));
    expect(guestDropTarget(t, testCatalog, hidden, { x: -10, y: 300 })).toBeUndefined();
  });
});

describe("hostCandidates", () => {
  it("自分自身と、自分の上で動くゲスト(入れ子も)を除く", () => {
    const t = load();
    expect(hostCandidates(t, "pve1")).toEqual(["pve2", "sw1"]);
    expect(hostCandidates(t, "vm1")).toEqual(["pve1", "pve2", "sw1"]);
  });
});
