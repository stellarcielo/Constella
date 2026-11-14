import { describe, expect, it } from "vitest";
import { parseTopology } from "../../core";
import { testCatalog } from "../../core/testFixtures";
import type { Topology } from "../../core";
import {
  contextMenuItems,
  isSeparator,
  type MenuEntry,
  selectedBendKeys,
  selectedLabelKeys,
} from "./menus";

const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  vm1: { model: generic-vm, host: pve1 }
  rt1: { model: generic-router-4 }
links:
  - { a: rt1:Gi0/0, b: pve1:eno1 }
  - { a: vm1:net0, b: pve1:vmbr0 }
layout:
  _bends:
    pve1 rt1: [ { x: 10, y: 10 } ]
  _labels:
    rt1:Gi0/0: { along: 30, side: 0 }
`;

function load(yaml = text): Topology {
  const result = parseTopology(yaml, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

/** 項目の action と、使えるか(区切りは "-") */
function summary(entries: MenuEntry[]): string[] {
  return entries.map((e) => (isSeparator(e) ? "-" : `${e.action}${e.enabled ? "" : "(off)"}`));
}

const linkIds = (t: Topology) => t.links.map((l) => l.id);

describe("contextMenuItems", () => {
  it("機器: 1 台なら接続を始められる。複数なら接続はできない", () => {
    const t = load();
    expect(
      summary(contextMenuItems({ kind: "nodes" }, t, { devices: ["rt1"], links: [] })),
    ).toEqual(["connect", "-", "copy", "cut", "-", "group", "-", "delete"]);
    const both = contextMenuItems({ kind: "nodes" }, t, { devices: ["rt1", "vm1"], links: [] });
    expect(summary(both)[0]).toBe("connect(off)");
  });

  it("ブリッジの箱だけなら、削除だけ", () => {
    const t = load();
    const entries = contextMenuItems({ kind: "nodes" }, t, { devices: ["pve1:vmbr0"], links: [] });
    expect(summary(entries)).toEqual(["delete"]);
  });

  it("線: 曲げた点・動かしたラベルが無ければ、戻す項目は薄くする", () => {
    const t = load();
    const [l1, l2] = linkIds(t);
    expect(summary(contextMenuItems({ kind: "links" }, t, { devices: [], links: [l1] }))).toEqual([
      "straighten",
      "resetLabels",
      "-",
      "delete",
    ]);
    expect(summary(contextMenuItems({ kind: "links" }, t, { devices: [], links: [l2] }))).toEqual([
      "straighten(off)",
      "resetLabels(off)",
      "-",
      "delete",
    ]);
  });

  it("グループ: 図にあるメンバーがいなければ、コピーは薄くする", () => {
    const t = load();
    const group = { kind: "group", uid: "g" } as const;
    expect(
      summary(contextMenuItems(group, t, { devices: ["rt1"], links: [], group: "g" })),
    ).toEqual(["copy", "ungroup"]);
    expect(summary(contextMenuItems(group, t, { devices: [], links: [], group: "g" }))).toEqual([
      "copy(off)",
      "ungroup",
    ]);
  });

  it("何も無い所: 動かしたラベルが無ければ、すべて戻すは薄くする", () => {
    const pane = { kind: "pane", at: { x: 0, y: 0 } } as const;
    const none = { devices: [], links: [] };
    expect(summary(contextMenuItems(pane, load(), none))).toEqual([
      "paste",
      "selectAll",
      "-",
      "autoArrange",
      "resetAllLabels",
    ]);
    const empty = load("constella: 1\n");
    expect(summary(contextMenuItems(pane, empty, none)).slice(3)).toEqual([
      "autoArrange(off)",
      "resetAllLabels(off)",
    ]);
  });
});

describe("selectedBendKeys・selectedLabelKeys", () => {
  it("選んでいる線の、曲げた点のキーと、動かしたラベルのキー(ブリッジの端は除く)", () => {
    const t = load();
    const [l1, l2] = linkIds(t);
    expect(selectedBendKeys(t, [l1, l2])).toEqual(["pve1 rt1"]);
    expect(selectedLabelKeys(t, [l1, l2])).toEqual(["rt1:Gi0/0"]);
    expect(selectedBendKeys(t, [])).toEqual([]);
  });
});
