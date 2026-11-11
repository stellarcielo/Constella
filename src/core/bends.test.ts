import { describe, expect, it } from "vitest";
import { bendKey, orientBends, parseBendKey } from "./bendKeys";
import {
  bendKeyNorm,
  commonMove,
  dropRemovedBends,
  linkBendKey,
  movableBendKeys,
  resetBends,
  setBends,
  shiftBends,
} from "./bends";
import { renameBridge } from "./bridges";
import { removeDevices, removeLinks, renameDevice } from "./edit";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

const text = `constella: 1
devices:
  r1: { model: generic-router-4 }
  r2: { model: generic-router-4 }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ] }
  vm1: { model: generic-vm, host: pve1 }
links:
  - { a: r2:Gi0/0, b: r1:Gi0/0 }
  - { a: r1:Gi0/1, b: r2:Gi0/1 }
  - { a: r1:Gi0/2, b: r1:Gi0/3 }
  - { a: vm1:net0, b: pve1:vmbr0 }
layout:
  _bends:
    r2 r1: [ { x: 200, y: 0 }, { x: 100, y: 0 } ]
    vm1 pve1:VMBR0: [ { x: 5, y: 6 } ]
`;

describe("キー(SPEC 4.3)", () => {
  it("両端のノードを名前の順に並べて空白でつなぐ。自分自身へのリンクには無い", () => {
    expect(bendKey("r2", "r1")).toBe("r1 r2");
    expect(bendKey("pve1:vmbr0", "vm1")).toBe("pve1:vmbr0 vm1");
    expect(bendKey("r1", "r1")).toBeUndefined();
    expect(parseBendKey("r1 r2")).toEqual(["r1", "r2"]);
    expect(parseBendKey("r1")).toBeUndefined();
    expect(parseBendKey("r1  r2")).toBeUndefined();
  });

  it("比べるときは、ノードの順とブリッジの IF 名の書き方の違いをならす", () => {
    expect(bendKeyNorm("vm1 pve1:VMBR0")).toBe(bendKeyNorm("pve1:vmbr0 vm1"));
    expect(bendKeyNorm("r2 r1")).toBe(bendKeyNorm("r1 r2"));
  });

  it("点を、線の向きに合わせて並べる", () => {
    const points = [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(orientBends(points, "r1", "r2")).toEqual(points);
    expect(orientBends(points, "r2", "r1")).toEqual([...points].reverse());
  });

  it("読み込むと、キーを名前の順に、点をその順に、ブリッジの名前を今の表記にそろえる", () => {
    const t = load(text);
    expect([...t.bends]).toEqual([
      [
        "r1 r2",
        [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
        ],
      ],
      ["pve1:vmbr0 vm1", [{ x: 5, y: 6 }]],
    ]);
  });

  it("曲げられる線は、描けるリンクのうち自分自身へのリンクでないもの。同じ 2 台の線は 1 つ", () => {
    const t = load(text);
    expect([...movableBendKeys(t)]).toEqual(["r1 r2", "pve1:vmbr0 vm1"]);
    expect(linkBendKey(t, t.links[2])).toBeUndefined();
    expect(linkBendKey(t, t.links[3])).toBe("pve1:vmbr0 vm1");
  });
});

describe("書き換え", () => {
  it("点は整数に丸め、点が無ければまっすぐに戻す", () => {
    const t = load(text);
    setBends(t, "r1 r2", [{ x: 1.4, y: 2.6 }]);
    expect(t.bends.get("r1 r2")).toEqual([{ x: 1, y: 3 }]);
    setBends(t, "r1 r2", []);
    expect(t.bends.has("r1 r2")).toBe(false);
  });

  it("まっすぐに戻すのは、渡したキーだけ(省けばすべて)", () => {
    const t = load(text);
    resetBends(t, ["r1 r2"]);
    expect([...t.bends.keys()]).toEqual(["pve1:vmbr0 vm1"]);
    resetBends(t);
    expect(t.bends.size).toBe(0);
  });

  it("同じ 2 台の間の線がすべて無くなったら消す。前から線の無かったキーは残す", () => {
    const t = load(text);
    t.bends.set("r1 nowhere", [{ x: 0, y: 0 }]);
    const before = movableBendKeys(t);
    removeLinks(t, [t.links[0].id]);
    dropRemovedBends(t, before);
    expect(t.bends.has("r1 r2")).toBe(true);
    removeLinks(t, [t.links[0].id]);
    dropRemovedBends(t, before);
    expect([...t.bends.keys()]).toEqual(["pve1:vmbr0 vm1", "r1 nowhere"]);
  });

  it("デバイスID を変えるとキーも書き換え、名前の順が変われば点も並べ直す", () => {
    const t = load(text);
    renameDevice(t, "r1", "z1");
    expect(t.bends.get("r2 z1")).toEqual([
      { x: 200, y: 0 },
      { x: 100, y: 0 },
    ]);
    renameDevice(t, "pve1", "host1");
    expect(t.bends.has("host1:vmbr0 vm1")).toBe(true);
  });

  it("ブリッジの名前を変えると、キーも書き換える", () => {
    const t = load(text);
    renameBridge(t, "pve1", "vmbr0", "vmbr9");
    expect([...t.bends.keys()]).toEqual(["r1 r2", "pve1:vmbr9 vm1"]);
  });

  it("デバイスを消すと、そのデバイスとブリッジに付く点も消す", () => {
    const t = load(text);
    removeDevices(t, ["pve1"]);
    expect([...t.bends.keys()]).toEqual(["r1 r2"]);
  });
});

describe("両端をまとめて動かしたとき(SPEC 7.3)", () => {
  it("両端がそろって動いたときだけ、点も同じだけ動かす", () => {
    expect(commonMove({ x: 10, y: 5 }, { x: 10.2, y: 5 })).toEqual({ x: 10, y: 5 });
    expect(commonMove({ x: 10, y: 5 }, { x: 0, y: 0 })).toBeUndefined();
    expect(commonMove({ x: 10, y: 5 }, undefined)).toBeUndefined();
    expect(commonMove({ x: 0, y: 0 }, { x: 0, y: 0 })).toBeUndefined();
  });

  it("両端のノードの動いた量から、そろって動いた線の点を動かす(整数に丸める)", () => {
    const t = load(text);
    shiftBends(
      t,
      new Map([
        ["r1", { x: 10.4, y: -5 }],
        ["r2", { x: 10.4, y: -5 }],
        ["vm1", { x: 3, y: 0 }],
      ]),
    );
    expect(t.bends.get("r1 r2")).toEqual([
      { x: 110, y: -5 },
      { x: 210, y: -5 },
    ]);
    expect(t.bends.get("pve1:vmbr0 vm1")).toEqual([{ x: 5, y: 6 }]);
  });
});
