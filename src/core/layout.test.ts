import { describe, expect, it } from "vitest";
import { DEVICE_BOX, groupFrames } from "./groupFrames";
import { bridgePositions, computeLayout, guestPositions, placeMissing } from "./layout";
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

  /** 冗長構成。ファイアウォールどうし(HA)とコアどうし(LAG)は、同じ段の機器をつなぐ */
  const redundant = `constella: 1
devices:
  isp1: { role: cloud }
  isp2: { role: cloud }
  fw1: { role: firewall }
  fw2: { role: firewall }
  core1: { role: l3switch }
  core2: { role: l3switch }
  acc1: { role: l2switch }
  acc2: { role: l2switch }
links:
  - { a: isp1:wan, b: fw1:p1 }
  - { a: isp2:wan, b: fw2:p1 }
  - { a: fw1:ha, b: fw2:ha }
  - { a: fw1:p2, b: core1:p1 }
  - { a: fw2:p2, b: core2:p1 }
  - { a: core1:lag1, b: core2:lag1 }
  - { a: core1:lag2, b: core2:lag2 }
  - { a: core1:d1, b: acc1:up1 }
  - { a: core2:d1, b: acc1:up2 }
  - { a: core1:d2, b: acc2:up1 }
  - { a: core2:d2, b: acc2:up2 }
`;

  it("同じ段の機器どうしがつながっていても、同じ高さに並べる", async () => {
    const pos = await computeLayout(load(redundant), testCatalog);
    const y = (id: string) => pos.get(id)?.y ?? NaN;
    expect(y("fw1")).toBe(y("fw2"));
    expect(y("core1")).toBe(y("core2"));
    expect(y("acc1")).toBe(y("acc2"));
    expect(y("isp1")).toBeLessThan(y("fw1"));
    expect(y("fw1")).toBeLessThan(y("core1"));
    expect(y("core1")).toBeLessThan(y("acc1"));
  });

  /** コア 1 台の下にアクセス 3 台、その下に端末 */
  const twoTier = `constella: 1
devices:
  core1: { role: l3switch }
  acc1: { role: l2switch }
  acc2: { role: l2switch }
  acc3: { role: l2switch }
  pc1: { role: pc }
  pc2: { role: pc }
  pc3: { role: pc }
  ap1: { role: ap }
  srv1: { role: server }
  srv2: { role: server }
links:
  - { a: core1:d1, b: acc1:up }
  - { a: core1:d2, b: acc2:up }
  - { a: core1:d3, b: acc3:up }
  - { a: acc1:p1, b: pc1:eth0 }
  - { a: acc1:p2, b: pc2:eth0 }
  - { a: acc2:p1, b: pc3:eth0 }
  - { a: acc2:p2, b: ap1:eth0 }
  - { a: acc3:p1, b: srv1:eth0 }
  - { a: acc3:p2, b: srv2:eth0 }
`;

  it("同じ段の中は、YAML に書いた順に左から並べる", async () => {
    const x = (pos: Map<string, { x: number }>, id: string) => pos.get(id)?.x ?? NaN;
    const r = await computeLayout(load(redundant), testCatalog);
    expect(x(r, "fw1")).toBeLessThan(x(r, "fw2"));
    expect(x(r, "core1")).toBeLessThan(x(r, "core2"));
    expect(x(r, "acc1")).toBeLessThan(x(r, "acc2"));
    const t = await computeLayout(load(twoTier), testCatalog);
    expect(x(t, "acc1")).toBeLessThan(x(t, "acc2"));
    expect(x(t, "acc2")).toBeLessThan(x(t, "acc3"));
    const hosts = ["pc1", "pc2", "pc3", "ap1", "srv1", "srv2"].map((id) => x(t, id));
    expect(hosts).toEqual([...hosts].sort((a, b) => a - b));
  });

  it("上の段の機器は、下につながる機器の左端と右端の間に置く", async () => {
    const pos = await computeLayout(load(twoTier), testCatalog);
    const x = (id: string) => pos.get(id)?.x ?? NaN;
    expect(x("core1")).toBeGreaterThan(x("acc1"));
    expect(x("core1")).toBeLessThan(x("acc3"));
  });
});

describe("placeMissing", () => {
  it("座標の無いデバイスを、既にある座標の下に置く", async () => {
    const t = load(handWritten);
    const placed = new Map([
      ["rt1", { x: 100, y: 0 }],
      ["isp", { x: 300, y: 200 }],
    ]);
    const pos = await placeMissing(t, testCatalog, ["srv1", "sw1"], (id) => placed.get(id));
    expect(Math.min(...[...pos.values()].map((p) => p.x))).toBe(100);
    expect(Math.min(...[...pos.values()].map((p) => p.y))).toBeGreaterThan(200);
    expect((pos.get("sw1")?.y ?? 0) < (pos.get("srv1")?.y ?? 0)).toBe(true);
  });
});

describe("ゲストとホスト(SPEC 9章・4.6)", () => {
  const lab = `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-l2switch-24 }
  fw01: { model: generic-vm, role: firewall, host: pve1 }
  pve1: { model: generic-hypervisor-4 }
  web01: { model: generic-vm, host: pve1 }
  db01: { model: generic-container, host: pve1 }
  srv1: { model: generic-server-2 }
  nested: { model: generic-vm, host: pve2 }
  pve2: { model: generic-hypervisor-4 }
  inner: { model: generic-vm, host: nested }
links:
  - { a: rt1:Gi0/1, b: sw1:Gi0/24 }
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: pve2:eno1, b: sw1:Gi0/2 }
  - { a: srv1:eth0, b: sw1:Gi0/3 }
`;

  it("ゲストはロールに関係なく、ホストの下の段に、YAML の順で並べる", async () => {
    const pos = await computeLayout(load(lab), testCatalog);
    const p = (id: string) => pos.get(id) ?? { x: NaN, y: NaN };
    expect(pos.size).toBe(10);
    for (const guest of ["fw01", "web01", "db01"]) expect(p(guest).y).toBeGreaterThan(p("pve1").y);
    expect(p("fw01").y).toBe(p("web01").y);
    expect(p("fw01").x).toBeLessThan(p("web01").x);
    expect(p("web01").x).toBeLessThan(p("db01").x);
    // ホストは server と同じ段
    expect(p("pve1").y).toBe(p("srv1").y);
    // 入れ子のゲストは、さらに下の段
    expect(p("inner").y).toBeGreaterThan(p("nested").y);
  });

  it("ホストの枠が、ほかの機器と重ならない", async () => {
    const t = load(lab);
    const pos = await computeLayout(t, testCatalog);
    const frames = groupFrames(t, (id) => pos.get(id));
    expect(frames.map((f) => (f.type === "host" ? f.host : ""))).toEqual([
      "pve2",
      "pve1",
      "nested",
    ]);
    for (const frame of frames) {
      for (const [id, p] of pos) {
        if (frame.members.includes(id)) continue;
        const apart =
          p.x + DEVICE_BOX.width <= frame.x ||
          p.x >= frame.x + frame.width ||
          p.y + DEVICE_BOX.height <= frame.y ||
          p.y >= frame.y + frame.height;
        expect(apart, `${id} が ${frame.type === "host" ? frame.host : ""} の枠に重なる`).toBe(
          true,
        );
      }
    }
  });

  it("同じ入力なら同じ結果になる", async () => {
    const t = load(lab);
    expect([...(await computeLayout(t, testCatalog))]).toEqual([
      ...(await computeLayout(t, testCatalog)),
    ]);
  });

  it("ホストを並べないときは、ゲストも機器 1 台として並べる", async () => {
    const pos = await computeLayout(load(lab), testCatalog, { devices: ["fw01", "rt1"] });
    expect(pos.get("fw01")?.y).toBe(pos.get("rt1")?.y);
  });

  it("guestPositions: ゲストがいなければホストを中心に下の段へ、いれば右に続ける", () => {
    const host = { x: 400, y: 100 };
    expect(guestPositions(host, [], 3)).toEqual([
      { x: 204, y: 296 },
      { x: 400, y: 296 },
      { x: 596, y: 296 },
    ]);
    const placed = [
      { x: 300, y: 296 },
      { x: 496, y: 296 },
      { x: 300, y: 492 },
    ];
    expect(guestPositions(host, placed, 2)).toEqual([
      { x: 496, y: 492 },
      { x: 692, y: 492 },
    ]);
    // ブリッジがあれば、ブリッジの段の下に置く
    expect(guestPositions(host, [], 1, [{ x: 400, y: 212 }])).toEqual([{ x: 400, y: 352 }]);
  });

  it("placeMissing: ホストに座標があるゲストは、ホストの下に並べる(フェーズ4-1 Q1)", async () => {
    const t = load(lab);
    const placed = new Map([
      ["rt1", { x: 0, y: 0 }],
      ["sw1", { x: 0, y: 200 }],
      ["pve1", { x: 400, y: 400 }],
      ["web01", { x: 400, y: 600 }],
    ]);
    const missing = ["fw01", "db01", "srv1"];
    const pos = await placeMissing(t, testCatalog, missing, (id) => placed.get(id));
    expect(pos.get("fw01")).toEqual({ x: 596, y: 600 });
    expect(pos.get("db01")).toEqual({ x: 792, y: 600 });
    // ゲストでない機器は、今までどおり既にある座標の下に置く
    expect(pos.get("srv1")?.y).toBeGreaterThan(600);
  });
});

describe("ブリッジ(SPEC 9章・4.6)", () => {
  const lab = `constella: 1
devices:
  sw1: { model: generic-l2switch-24 }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ] }
      vmbr1: { type: bridge, members: [ eno2 ] }
  vm1: { model: generic-vm, host: pve1 }
  vm2: { model: generic-vm, host: pve1 }
  vm3: { model: generic-vm, host: pve1 }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: vm1:net0, b: pve1:vmbr1 }
  - { a: vm2:net0, b: pve1:vmbr0 }
  - { a: vm3:net0, b: pve1:vmbr1 }
`;

  it("上からホスト・ブリッジ・ゲストの段に並べ、ゲストはつながっているブリッジの下に寄せる", async () => {
    const pos = await computeLayout(load(lab), testCatalog);
    const p = (id: string) => pos.get(id) ?? { x: NaN, y: NaN };
    expect([...pos.keys()].sort()).toEqual(
      ["pve1", "pve1:vmbr0", "pve1:vmbr1", "sw1", "vm1", "vm2", "vm3"].sort(),
    );
    expect(p("pve1:vmbr0").y).toBeGreaterThan(p("pve1").y);
    expect(p("pve1:vmbr0").y).toBe(p("pve1:vmbr1").y);
    expect(p("vm1").y).toBeGreaterThan(p("pve1:vmbr0").y);
    // vm2 だけが vmbr0 につながる。vmbr0 は vmbr1 の左にあるので、vm2 はほかのゲストより左
    expect(p("pve1:vmbr0").x).toBeLessThan(p("pve1:vmbr1").x);
    expect(p("vm2").x).toBeLessThan(p("vm1").x);
    expect(p("vm2").x).toBeLessThan(p("vm3").x);
  });

  it("bridgePositions: ホストの下に、ホストを中心にして並べ、あれば右に続ける", () => {
    expect(bridgePositions({ x: 100, y: 0 }, [], 2)).toEqual([
      { x: 2, y: 112 },
      { x: 198, y: 112 },
    ]);
    expect(bridgePositions({ x: 100, y: 0 }, [{ x: 2, y: 112 }], 1)).toEqual([{ x: 198, y: 112 }]);
  });

  it("placeMissing: ホストに座標があるブリッジは、ホストの下に置く", async () => {
    const t = load(lab);
    const placed = new Map([
      ["sw1", { x: 0, y: 0 }],
      ["pve1", { x: 0, y: 200 }],
      ["pve1:vmbr0", { x: -78, y: 312 }],
    ]);
    const pos = await placeMissing(t, testCatalog, ["pve1:vmbr1"], (id) => placed.get(id));
    expect(pos.get("pve1:vmbr1")).toEqual({ x: 118, y: 312 });
  });
});
