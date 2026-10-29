import { describe, expect, it } from "vitest";
import {
  DEVICE_BOX,
  type Frame,
  GROUP_LABEL_BAND,
  GROUP_NEST_GAP,
  GROUP_PADDING,
  groupFrames,
  groupKindFilter,
  groupTitle,
  hostFrameTitle,
} from "./groupFrames";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(groups: string, layout = ""): Topology {
  const text = `constella: 1
devices:
  a: {}
  b: {}
  c: {}
  d: {}
groups:
${groups}
layout:
  a: { x: 0, y: 0 }
  b: { x: 200, y: 0 }
  c: { x: 0, y: 200 }
${layout}`;
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

const at = (t: Topology) => (id: string) => t.layout.get(id);
/** 枠の名前(グループは id、ホストの枠は host:ホストのデバイスID) */
const nameOf = (f: Frame) => (f.type === "group" ? f.group.id : `host:${f.host}`);

describe("groupFrames", () => {
  it("メンバーを、余白とラベルの帯を付けて囲む", () => {
    const t = load("  - { id: g, members: [ a, b ] }\n");
    const [frame] = groupFrames(t, at(t));
    expect(frame.members).toEqual(["a", "b"]);
    expect(frame.inner).toBe(0);
    // 左右と下は機器から GROUP_PADDING、上はさらにラベルの帯の分
    expect(frame.x).toBe(-GROUP_PADDING);
    expect(frame.y).toBe(-GROUP_PADDING - GROUP_LABEL_BAND);
    expect(frame.x + frame.width).toBe(200 + DEVICE_BOX.width + GROUP_PADDING);
    expect(frame.y + frame.height).toBe(DEVICE_BOX.height + GROUP_PADDING);
  });

  it("ほかのグループを含むグループは外側に描き、内側の枠とラベルを囲む", () => {
    const t = load(
      "  - { id: rack, kind: rack, members: [ a, c ] }\n  - { id: site, kind: site, members: [ a, b, c ] }\n",
    );
    const frames = groupFrames(t, at(t));
    // 外側の枠を先に描く
    expect(frames.map((f) => nameOf(f))).toEqual(["site", "rack"]);
    const [site, rack] = frames;
    expect([site.inner, rack.inner]).toEqual([1, 0]);
    expect(site.x).toBeLessThan(rack.x);
    expect(site.y + GROUP_LABEL_BAND).toBeLessThan(rack.y);
    expect(site.y + site.height).toBeGreaterThan(rack.y + rack.height);
  });

  it("メンバーが同じなら、先に書いたほうを外側にする", () => {
    const t = load("  - { id: first, members: [ a, b ] }\n  - { id: second, members: [ b, a ] }\n");
    const frames = groupFrames(t, at(t));
    expect(frames.map((f) => [nameOf(f), f.inner])).toEqual([
      ["first", 1],
      ["second", 0],
    ]);
  });

  it("一部だけ重なるグループは、どちらも入れ子にしない", () => {
    const t = load("  - { id: x, members: [ a, b ] }\n  - { id: y, members: [ b, c ] }\n");
    expect(groupFrames(t, at(t)).map((f) => f.inner)).toEqual([0, 0]);
  });

  it("座標の無い機器や存在しない機器は除き、描けるメンバーが無いグループは描かない", () => {
    const t = load(
      "  - { id: g, members: [ a, d, ghost ] }\n  - { id: empty, members: [ d ] }\n  - { id: none, members: [] }\n",
    );
    const frames = groupFrames(t, at(t));
    expect(frames.map((f) => [nameOf(f), f.members])).toEqual([["g", ["a"]]]);
  });

  it("表示する種類で絞り込み、隠したグループは入れ子の余白に数えない(フェーズ3-3)", () => {
    const t = load(
      "  - { id: rack, kind: rack, members: [ a, c ] }\n  - { id: site, kind: site, members: [ a, b, c ] }\n  - { id: v10, kind: vlan, members: [ a ] }\n  - { id: misc, kind: custom, members: [ b ] }\n  - { id: plain, members: [ c ] }\n",
    );
    const frames = groupFrames(t, at(t), groupKindFilter(["site"]));
    // 種類なし・custom はいつも出す
    expect(frames.map((f) => nameOf(f)).sort()).toEqual(["misc", "plain", "site"]);
    // ラックを隠したので、拠点は入れ子にならない(ただし種類なしの plain は拠点の内側)
    expect(frames.find((f) => nameOf(f) === "site")?.inner).toBe(1);
    const onlySite = groupFrames(t, at(t), (g) => g.kind === "site");
    expect(onlySite.map((f) => [nameOf(f), f.inner])).toEqual([["site", 0]]);
  });

  it("位置は渡した関数で決める(自動配置の位置を使える)", () => {
    const t = load("  - { id: g, members: [ d ] }\n");
    const frames = groupFrames(t, (id) => (id === "d" ? { x: 500, y: 500 } : at(t)(id)));
    expect(frames[0].x).toBe(500 - GROUP_PADDING);
  });
});

describe("groupTitle", () => {
  it("種類を日本語で添え、名前が無ければ id を使う", () => {
    const t = load(
      "  - { id: r1, kind: rack, label: Rack 1 }\n  - { id: v10, kind: vlan }\n  - { id: misc, kind: custom, label: その他 }\n  - { id: plain }\n",
    );
    expect(t.groups.map(groupTitle)).toEqual(["ラック: Rack 1", "VLAN: v10", "その他", "plain"]);
  });
});

describe("groupFrames: ホストの枠(SPEC 4.6・7.3)", () => {
  function hosts(groups = "", devices = ""): Topology {
    const text = `constella: 1
devices:
  pve1: { model: generic-hypervisor-4 }
  vm1: { model: generic-vm, host: pve1 }
  ct1: { model: generic-container, host: pve1 }
  sw1: {}
${devices}groups:
${groups}layout:
  sw1: { x: 0, y: -200 }
  pve1: { x: 0, y: 0 }
  vm1: { x: -100, y: 200 }
  ct1: { x: 100, y: 200 }
  vm2: { x: -100, y: 400 }
`;
    const result = parseTopology(text, { catalog: testCatalog });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    return result.topology;
  }

  it("ホストと、その上で動くゲストを囲む。ラベルはゲストの数", () => {
    const t = hosts();
    const frames = groupFrames(t, at(t));
    expect(frames.map(nameOf)).toEqual(["host:pve1"]);
    const [frame] = frames;
    expect(frame.members).toEqual(["pve1", "vm1", "ct1"]);
    expect(frame.x).toBe(-100 - GROUP_PADDING);
    expect(frame.y).toBe(-GROUP_PADDING - GROUP_LABEL_BAND);
    expect(frame.x + frame.width).toBe(100 + DEVICE_BOX.width + GROUP_PADDING);
    expect(frame.y + frame.height).toBe(200 + DEVICE_BOX.height + GROUP_PADDING);
    expect(frame.type === "host" && hostFrameTitle(t, testCatalog, frame)).toBe("VM 1・CT 1");
  });

  it("ゲストを隠している(位置が無い)ときは描かない", () => {
    const t = hosts();
    const hidden = (id: string) => (id === "vm1" || id === "ct1" ? undefined : at(t)(id));
    expect(groupFrames(t, hidden)).toEqual([]);
  });

  it("グループの枠は、メンバーのホストの枠を丸ごと囲む", () => {
    const t = hosts("  - { id: rack1, kind: rack, members: [ pve1 ] }\n");
    const frames = groupFrames(t, at(t));
    expect(frames.map((f) => [nameOf(f), f.inner])).toEqual([
      ["rack1", 1],
      ["host:pve1", 0],
    ]);
    expect(frames[0].members).toEqual(["pve1", "vm1", "ct1"]);
    expect(frames[0].x).toBe(frames[1].x - GROUP_NEST_GAP);
  });

  it("ゲストだけのグループは、ホストの枠の内側", () => {
    const t = hosts("  - { id: v10, kind: vlan, members: [ vm1, ct1 ] }\n");
    expect(groupFrames(t, at(t)).map((f) => [nameOf(f), f.inner])).toEqual([
      ["host:pve1", 1],
      ["v10", 0],
    ]);
  });

  it("入れ子のゲストは、内側のホストの枠に入り、外側の枠のラベルは直接のゲストだけを数える", () => {
    const t = hosts("", "  vm2: { model: generic-vm, host: vm1 }\n");
    const frames = groupFrames(t, at(t));
    expect(frames.map((f) => [nameOf(f), f.inner, f.members])).toEqual([
      ["host:pve1", 1, ["pve1", "vm1", "ct1", "vm2"]],
      ["host:vm1", 0, ["vm1", "vm2"]],
    ]);
    const outer = frames[0];
    expect(outer.type === "host" && hostFrameTitle(t, testCatalog, outer)).toBe("VM 1・CT 1");
  });

  it("グループを隠しても、ホストの枠は描く", () => {
    const t = hosts("  - { id: rack1, kind: rack, members: [ pve1 ] }\n");
    expect(groupFrames(t, at(t), () => false).map(nameOf)).toEqual(["host:pve1"]);
  });
});
