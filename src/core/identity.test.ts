import { describe, expect, it } from "vitest";
import { adoptIdentity } from "./identity";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import { locateTarget } from "./validate";

function parse(text: string) {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result;
}

describe("adoptIdentity", () => {
  it("デバイスは ID、リンクは両端で対応させて、前の識別子を引き継ぐ", () => {
    const prev = parse(specExample).topology;
    // 先頭にリンクを 1 本足し、mgmt のリンクのラベルを変えたもの
    const edited = specExample
      .replace("links:\n", "links:\n  - a: rt1:Gi0/2\n    b: srv1:eth1\n")
      .replace("label: mgmt", "label: management");
    const next = adoptIdentity(prev, parse(edited));
    expect(next.topology.devices.get("rt1")?.uid).toBe(prev.devices.get("rt1")?.uid);
    const ids = next.topology.links.map((l) => l.id);
    expect(ids.slice(1)).toEqual(prev.links.map((l) => l.id));
    expect(prev.links.map((l) => l.id)).not.toContain(ids[0]);
    expect(next.topology.links[3].label).toBe("management");
  });

  it("base のリンクの対応も付け替える(位置が引ける)", () => {
    const prev = parse(specExample).topology;
    const parsed = parse(specExample);
    const text = specExample;
    const next = adoptIdentity(prev, parsed);
    const range = locateTarget(next.base, { kind: "link", id: prev.links[2].id, end: "b" });
    expect(range && text.slice(range.start, range.end)).toBe("srv1:eth0");
    expect(next.base.topology.links.map((l) => l.id)).toEqual(prev.links.map((l) => l.id));
  });

  it("同じ両端のリンクが複数あれば、先頭から順に対応させる", () => {
    const text = "constella: 1\nlinks:\n  - a: x:1\n    b: y:1\n  - a: x:1\n    b: y:1\n";
    const prev = parse(text).topology;
    const next = adoptIdentity(prev, parse(text));
    expect(next.topology.links.map((l) => l.id)).toEqual(prev.links.map((l) => l.id));
  });

  it("グループは ID で対応させる(同じ ID が複数あれば先頭から順に。ID の無いグループは引き継がない)", () => {
    const text =
      "constella: 1\ngroups:\n  - { id: a, members: [] }\n  - { id: b, members: [] }\n" +
      "  - { id: b, members: [] }\n  - { kind: rack, members: [] }\n";
    const prev = parse(text).topology;
    // 先頭のグループを消し、ラベルを足したもの
    const edited = text
      .replace("  - { id: a, members: [] }\n", "")
      .replace("{ id: b,", "{ id: b, label: B,");
    const next = adoptIdentity(prev, parse(edited));
    const uids = next.topology.groups.map((g) => g.uid);
    expect(uids.slice(0, 2)).toEqual([prev.groups[1].uid, prev.groups[2].uid]);
    expect(uids[2]).not.toBe(prev.groups[3].uid);
    expect(next.base.topology.groups.map((g) => g.uid)).toEqual(uids);
  });

  it("リンクの問題も引き継いだ ID に付け替える", () => {
    const text = "constella: 1\nlinks:\n  - a: x:1\n    b: y:1\n    color: red\n";
    const prev = parse(text).topology;
    const next = adoptIdentity(prev, parse(text));
    expect(next.issues[0].target).toEqual({ kind: "link", id: prev.links[0].id });
  });
});
