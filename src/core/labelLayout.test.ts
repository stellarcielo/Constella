import { describe, expect, it } from "vitest";
import { renameBridge } from "./bridges";
import { removeDevices, removeLinks, renameDevice } from "./edit";
import {
  dropRemovedLabels,
  labelKey,
  labelKeyNorm,
  movableLabelKeys,
  resetLabels,
  setLabelOffset,
} from "./labelLayout";
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
      vmbr1: { type: bridge }
  vm1: { model: generic-vm, host: pve1 }
links:
  - { a: r1:GigabitEthernet0/0, b: r2:Gi0/0 }
  - { a: r1:Gi0/2, b: r1:Gi0/3 }
  - { a: vm1:net0, b: pve1:vmbr0 }
  - { a: pve1:eno1, b: r2:Gi0/1 }
layout:
  _labels:
    r1:Gi0/0: { along: 60, side: -8 }
    pve1:vmbr0: { along: 40, side: 0 }
`;

describe("ラベルの位置のキー(SPEC 4.3)", () => {
  it("IF 名は短い形にそろえる。比べるときは書き方と大文字小文字の違いをならす", () => {
    expect(labelKey("r1", "GigabitEthernet0/1")).toBe("r1:Gi0/1");
    expect(labelKeyNorm("r1:gi0/1")).toBe(labelKeyNorm("r1:GigabitEthernet0/1"));
    expect(labelKeyNorm("r1:Gi0/1")).not.toBe(labelKeyNorm("r2:Gi0/1"));
  });

  it("動かせるのは、リンクのブリッジでない端と、members のあるブリッジのホスト側のラベル", () => {
    // 自分自身へのリンク(r1:Gi0/2・Gi0/3)と、members の無い vmbr1 は動かせない
    expect([...movableLabelKeys(load(text))].sort()).toEqual(
      ["pve1:eno1", "pve1:vmbr0", "r1:Gi0/0", "r2:Gi0/0", "r2:Gi0/1", "vm1:net0"].sort(),
    );
  });
});

describe("ラベルの位置を書く・戻す", () => {
  it("書くと整数に丸める", () => {
    const t = load(text);
    setLabelOffset(t, "r2:Gi0/0", { along: 50.4, side: -3.6 });
    expect(t.labelLayout.get("r2:Gi0/0")).toEqual({ along: 50, side: -4 });
  });

  it("キーを渡せばそのラベルだけ、省けばすべてを自動の位置に戻す", () => {
    const t = load(text);
    resetLabels(t, ["r1:Gi0/0"]);
    expect([...t.labelLayout.keys()]).toEqual(["pve1:vmbr0"]);
    resetLabels(t);
    expect(t.labelLayout.size).toBe(0);
  });

  it("編集でラベルが無くなった端の位置は消し、前から対応するラベルの無いキーは残す", () => {
    const t = load(text);
    setLabelOffset(t, "ghost:eth0", { along: 1, side: 1 });
    const before = movableLabelKeys(t);
    removeLinks(
      t,
      t.links.filter((l) => l.a?.device === "r1" && l.b?.device === "r2").map((l) => l.id),
    );
    dropRemovedLabels(t, before);
    expect([...t.labelLayout.keys()]).toEqual(["pve1:vmbr0", "ghost:eth0"]);
  });
});

describe("ほかの編集に合わせる", () => {
  it("デバイスの ID を変えると、キーのデバイスID も書き換える", () => {
    const t = load(text);
    renameDevice(t, "r1", "edge1");
    expect([...t.labelLayout.keys()]).toEqual(["edge1:Gi0/0", "pve1:vmbr0"]);
  });

  it("ブリッジの名前を変えると、ホスト側のラベルのキーも書き換える", () => {
    const t = load(text);
    renameBridge(t, "pve1", "vmbr0", "vmbr9");
    expect([...t.labelLayout.keys()]).toEqual(["r1:Gi0/0", "pve1:vmbr9"]);
  });

  it("デバイスを消すと、そのデバイスに付くラベルの位置も消す", () => {
    const t = load(text);
    removeDevices(t, ["pve1"]);
    expect([...t.labelLayout.keys()]).toEqual(["r1:Gi0/0"]);
  });
});
