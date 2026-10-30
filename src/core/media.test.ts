import { describe, expect, it } from "vitest";
import { inferMedia, linkMedia, portTypeOf } from "./media";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { DeviceModel, Link, ModelCatalog, Topology } from "./types";

const ap: DeviceModel = {
  id: "ap",
  role: "ap",
  flexible: false,
  ports: [
    { name: "eth0", type: "rj45" },
    { name: "wlan0", type: "wireless" },
  ],
};
const vm: DeviceModel = {
  id: "vm",
  role: "server",
  flexible: false,
  ports: [{ name: "vnic0", type: "virtual" }],
};
const catalog: ModelCatalog = new Map([...testCatalog, ["ap", ap], ["vm", vm]]);

function load(links: string): Topology {
  const result = parseTopology(
    `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-l2switch-24 }
  sw2: { model: generic-l2switch-24 }
  ap1: { model: ap }
  ap2: { model: ap }
  vm1: { model: vm }
  isp: { role: cloud }
  x: {}
links:
${links}`,
    { catalog },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

function media(link: string): string {
  const t = load(link);
  return inferMedia(t.links[0], t, catalog);
}

describe("portTypeOf", () => {
  it("モデルのポート種別を返す。分からなければ undefined", () => {
    const t = load("  - a: sw1:GigabitEthernet0/1\n    b: isp:wan\n");
    const link = t.links[0] as Required<Link>;
    expect(portTypeOf(t, link.a, catalog)).toBe("rj45");
    expect(portTypeOf(t, link.b, catalog)).toBeUndefined();
  });
});

describe("inferMedia(Q3)", () => {
  it("RJ45 同士は copper", () => {
    expect(media("  - a: rt1:Gi0/0\n    b: sw1:Gi0/1\n")).toBe("copper");
  });

  it("SFP+ 同士は fiber", () => {
    expect(media("  - a: sw1:Te0/25\n    b: sw2:Te0/25\n")).toBe("fiber");
  });

  it("どちらかが無線なら wireless", () => {
    expect(media("  - a: ap1:wlan0\n    b: ap2:wlan0\n")).toBe("wireless");
    expect(media("  - a: ap1:wlan0\n    b: x:wifi\n")).toBe("wireless");
  });

  it("どちらかが仮想なら virtual", () => {
    expect(media("  - a: vm1:vnic0\n    b: sw1:Gi0/1\n")).toBe("virtual");
  });

  it("片方が分からなければ、もう片方から決める", () => {
    expect(media("  - a: isp:wan\n    b: sw1:Te0/26\n")).toBe("fiber");
  });

  it("両方分からなければ copper", () => {
    expect(media("  - a: isp:wan\n    b: x:eth0\n")).toBe("copper");
  });
});

describe("linkMedia", () => {
  it("書かれた media を優先する", () => {
    const t = load("  - a: sw1:Te0/25\n    b: sw2:Te0/25\n    media: dac\n");
    expect(linkMedia(t.links[0], t, catalog)).toBe("dac");
  });
});

describe("ブリッジへのリンク(SPEC 4.3)", () => {
  it("ポート種別が分からなくても virtual と推定する", () => {
    const result = parseTopology(
      `constella: 1
devices:
  pve1:
    interfaces:
      vmbr0: { type: bridge }
  guest: { host: pve1 }
links:
  - { a: guest:eth0, b: pve1:vmbr0 }
  - { a: guest:eth1, b: pve1:eth0 }
`,
      { catalog },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const t = result.topology;
    expect(t.links.map((l) => inferMedia(l, t, catalog))).toEqual(["virtual", "copper"]);
  });
});
