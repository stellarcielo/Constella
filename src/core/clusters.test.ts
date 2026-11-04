import { describe, expect, it } from "vitest";
import { clusterIpText, clusterNetworks, clusterOfHosts } from "./clusters";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(groups: string): Topology {
  const text = `constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      eno3: { ip: [ 10.10.0.1/24 ] }
  pve2: { model: generic-hypervisor-4 }
  pve3: { model: generic-hypervisor-4 }
  web01: { model: generic-vm, host: pve1 }
groups:
${groups}`;
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("clusterOfHosts", () => {
  it("kind: cluster のグループのメンバーだけ。2 つ以上に入っていれば最初のクラスタ。図に無い機器は除く", () => {
    const t = load(`  - { id: rack1, kind: rack, members: [ pve3 ] }
  - { id: lab1, kind: cluster, members: [ pve1, ghost ] }
  - { id: lab2, kind: cluster, members: [ pve1, pve2 ] }
`);
    expect([...clusterOfHosts(t)]).toEqual([
      ["pve1", 1],
      ["pve2", 2],
    ]);
  });
});

describe("clusterNetworks", () => {
  it("サブネットが読めるネットワークを書いた順に返す。クラスタでなければ空", () => {
    const t = load(`  - id: lab
    kind: cluster
    networks: { migration: 10.30.0.0/24, bad: 10.30.0.0, corosync: 10.10.0.0/24 }
  - { id: rack1, kind: rack, networks: { corosync: 10.10.0.0/24 } }
`);
    expect(clusterNetworks(t.groups[0]).map((n) => [n.name, n.text])).toEqual([
      ["migration", "10.30.0.0/24"],
      ["corosync", "10.10.0.0/24"],
    ]);
    expect(clusterNetworks(t.groups[1])).toEqual([]);
  });
});

describe("clusterIpText(SPEC 4.6)", () => {
  const t = load(`  - id: lab
    kind: cluster
    members: [ pve1, pve2 ]
    networks:
      corosync: 10.10.0.0/24
      ceph-public: 10.20.0.0/24
      ceph-cluster: 10.20.0.0/24
      v6: "fd00:10::/64"
      bad: 10.30.0.0
  - { id: rack1, kind: rack, members: [ pve3 ], networks: { corosync: 10.10.0.0/24 } }
`);
  const text = clusterIpText(t);

  it("クラスタのホストの IP には、入るネットワークの名前を添える。2 つ以上なら並べる", () => {
    expect(text("pve1")("10.10.0.1/24")).toBe("10.10.0.1/24 (corosync)");
    expect(text("pve2")("10.20.0.2/24")).toBe("10.20.0.2/24 (ceph-public, ceph-cluster)");
    expect(text("pve2")("fd00:10::2/64")).toBe("fd00:10::2/64 (v6)");
  });

  it("どのネットワークにも入らない IP・読めない IP は、そのまま", () => {
    expect(text("pve1")("10.30.0.1/24")).toBe("10.30.0.1/24");
    expect(text("pve1")("dhcp")).toBe("dhcp");
  });

  it("クラスタのホストでなければ(ゲスト・ほかの種類のグループ・図に無い機器)、そのまま", () => {
    expect(text("web01")("10.10.0.11/24")).toBe("10.10.0.11/24");
    expect(text("pve3")("10.10.0.3/24")).toBe("10.10.0.3/24");
    expect(text("ghost")("10.10.0.9/24")).toBe("10.10.0.9/24");
  });
});
