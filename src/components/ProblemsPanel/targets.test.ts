import { describe, expect, it } from "vitest";
import { expandIfName, parseTopology } from "../../core";
import { specExample, testCatalog } from "../../core/testFixtures";
import { describeTarget, issueFocus } from "./targets";

function load(text = specExample) {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error();
  return result.topology;
}

const same = (name: string) => name;

describe("describeTarget", () => {
  const t = load();

  it("対象の種類ごとの表示名", () => {
    expect(describeTarget({ kind: "document" }, t, same)).toBe("ファイル全体");
    expect(describeTarget({ kind: "device", id: "rt1" }, t, same)).toBe("rt1");
    expect(describeTarget({ kind: "interface", device: "core-sw1", name: "Gi0/1" }, t, same)).toBe(
      "core-sw1 の Gi0/1",
    );
    expect(describeTarget({ kind: "link", id: t.links[1].id }, t, same)).toBe(
      "rt1:Gi0/1 ↔ core-sw1:Gi0/1",
    );
    expect(describeTarget({ kind: "layout", id: "ghost" }, t, same)).toBe("layout の ghost");
    expect(describeTarget({ kind: "group", index: 0 }, t, same)).toBe("groups の 1 番目");
  });

  it("IF 名は表示の設定(長い名前)に合わせる", () => {
    expect(describeTarget({ kind: "link", id: t.links[2].id }, t, expandIfName)).toBe(
      "core-sw1:FastEthernet0/1 ↔ srv1:eth0",
    );
  });
});

describe("issueFocus", () => {
  const t = load();

  it("デバイス・IF・layout はそのデバイスを選ぶ", () => {
    const rt1 = { selection: { devices: ["rt1"], links: [] }, devices: ["rt1"] };
    expect(issueFocus({ kind: "device", id: "rt1" }, t)).toEqual(rt1);
    expect(issueFocus({ kind: "interface", device: "rt1", name: "Gi0/9" }, t)).toEqual(rt1);
    expect(issueFocus({ kind: "layout", id: "rt1" }, t)).toEqual(rt1);
    expect(issueFocus({ kind: "layout", id: "ghost" }, t)).toBeUndefined();
  });

  it("リンクはそのリンクを選び、両端のデバイスが見えるようにする", () => {
    const id = t.links[0].id;
    expect(issueFocus({ kind: "link", id }, t)).toEqual({
      selection: { devices: [], links: [id] },
      devices: ["rt1", "isp"],
    });
  });

  it("存在しないデバイスへのリンクも選ぶ(表示は分かる端だけに合わせる)", () => {
    const broken = load("constella: 1\ndevices:\n  a: {}\nlinks:\n  - a: a:x\n    b: ghost:y\n");
    const id = broken.links[0].id;
    expect(issueFocus({ kind: "link", id }, broken)).toEqual({
      selection: { devices: [], links: [id] },
      devices: ["a"],
    });
  });

  it("ファイル全体では何も選ばない", () => {
    expect(issueFocus({ kind: "document" }, t)).toBeUndefined();
  });

  it("グループでは、存在するメンバーを選ぶ(無ければ何も選ばない)", () => {
    const grouped = load(
      "constella: 1\ndevices:\n  a: {}\n  b: {}\ngroups:\n  - { id: g, members: [ a, ghost, b, a ] }\n  - { id: e, members: [ ghost ] }\n",
    );
    expect(issueFocus({ kind: "group", index: 0 }, grouped)).toEqual({
      selection: { devices: ["a", "b"], links: [] },
      devices: ["a", "b"],
    });
    expect(issueFocus({ kind: "group", index: 1 }, grouped)).toBeUndefined();
    expect(issueFocus({ kind: "group", index: 5 }, grouped)).toBeUndefined();
  });
});

describe("issueFocus: ブリッジ(フェーズ4-2)", () => {
  const t = load(`constella: 1
devices:
  pve1:
    interfaces:
      vmbr0: { type: bridge }
  vm1: { host: pve1 }
links:
  - { a: vm1:net0, b: pve1:vmbr0 }
`);

  it("ブリッジの IF と layout のキーはブリッジの箱を選び、リンクはブリッジの箱に表示を合わせる", () => {
    expect(issueFocus({ kind: "interface", device: "pve1", name: "vmbr0" }, t)).toEqual({
      selection: { devices: ["pve1:vmbr0"], links: [] },
      devices: ["pve1:vmbr0"],
    });
    expect(issueFocus({ kind: "layout", id: "pve1:vmbr0" }, t)?.devices).toEqual(["pve1:vmbr0"]);
    expect(issueFocus({ kind: "layout", id: "pve1:vmbr9" }, t)).toBeUndefined();
    expect(issueFocus({ kind: "link", id: t.links[0].id }, t)?.devices).toEqual([
      "vm1",
      "pve1:vmbr0",
    ]);
  });
});
