import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { importProxmox } from "./proxmox";
import { testCatalog } from "./testFixtures";
import type { Topology } from "./types";
import { validateTopology } from "./validate";

/** pvesh の結果の形(書き出しスクリプトの JSON) */
const exported = {
  format: "constella-proxmox",
  version: 1,
  exported: "2026-11-04T05:00:00Z",
  host: "pve1",
  nodes: [
    {
      node: "pve1",
      network: [
        {
          iface: "vmbr0",
          type: "bridge",
          bridge_ports: "bond0",
          bridge_vlan_aware: 1,
          bridge_vids: "2-4094",
          cidr: "192.168.10.2/24",
          comments: "LAN\n",
        },
        { iface: "eno10", type: "eth" },
        { iface: "bond0", type: "bond", slaves: "eno1 eno2", bond_mode: "802.3ad" },
        { iface: "eno2", type: "eth" },
        { iface: "eno1", type: "eth" },
        {
          iface: "vmbr1",
          type: "bridge",
          bridge_ports: "",
          bridge_vlan_aware: 1,
          bridge_vids: "10 20 30-40",
        },
        {
          iface: "vmbr0.20",
          type: "vlan",
          "vlan-raw-device": "vmbr0",
          "vlan-id": "20",
          address: "192.168.20.2",
          netmask: "255.255.255.0",
        },
        {
          iface: "mgmt",
          type: "vlan",
          "vlan-raw-device": "eno10",
          "vlan-id": 99,
          cidr: "10.99.0.2/24",
          cidr6: "fd00:99::2/64",
        },
        { iface: "eno1:1", type: "alias" },
      ],
      qemu: [
        {
          vmid: 101,
          config: {
            name: "web01",
            net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0,firewall=1,tag=10",
            ipconfig0: "ip=192.168.10.11/24,gw=192.168.10.1,ip6=dhcp",
          },
        },
        {
          vmid: 100,
          config: {
            name: "fw01",
            net0: "virtio=BC:24:11:00:00:02,bridge=vmbr0,trunks=10;20;30",
            net1: "e1000=BC:24:11:00:00:03,bridge=vmbr9",
          },
        },
        {
          vmid: 900,
          config: { name: "tmpl", template: 1, net0: "virtio=BC:24:11:00:00:04,bridge=vmbr0" },
        },
        { vmid: 102, config: { name: "pve2", net0: "virtio=BC:24:11:00:00:05" } },
        { vmid: 103, config: { net0: "virtio=BC:24:11:00:00:06,bridge=vmbr1" } },
        { vmid: 104, config: null },
      ],
      lxc: [
        {
          vmid: 200,
          config: {
            hostname: "db 01",
            net0: "name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:07,ip=192.168.20.21/24,ip6=auto,tag=20,type=veth",
          },
        },
      ],
    },
    {
      node: "pve2",
      network: null,
      qemu: [
        {
          vmid: 300,
          config: { name: "web01", net0: "virtio=BC:24:11:00:00:08,bridge=vmbr0,tag=10" },
        },
      ],
      lxc: [],
    },
    {
      node: "pve3",
      network: [
        { iface: "ovsbr0", type: "OVSBridge", ovs_ports: "ovsbond0 mgmt0 lan0" },
        {
          iface: "ovsbond0",
          type: "OVSBond",
          ovs_bonds: "enp1s0 enp2s0",
          bond_mode: "balance-slb",
        },
        { iface: "enp1s0", type: "OVSPort" },
        { iface: "enp2s0", type: "OVSPort" },
        {
          iface: "mgmt0",
          type: "OVSIntPort",
          ovs_bridge: "ovsbr0",
          ovs_tag: 50,
          cidr: "10.50.0.3/24",
        },
        { iface: "lan0", type: "OVSIntPort", ovs_bridge: "ovsbr0", cidr: "192.168.1.3/24" },
      ],
      qemu: [],
      lxc: [],
    },
  ],
};

function load(data: unknown = exported) {
  const result = importProxmox(JSON.stringify(data));
  if (!result.ok) throw new Error(result.error);
  return result;
}

function ifs(t: Topology, id: string) {
  return [...(t.devices.get(id)?.interfaces ?? [])];
}

describe("importProxmox: ノード(SPEC 4.7)", () => {
  it("モデル無しの hypervisor にし、IF は物理的な IF・bond・ブリッジ・VLAN インターフェースの順に並べる", () => {
    const { topology: t } = load();
    const pve1 = t.devices.get("pve1");
    expect([pve1?.role, pve1?.model]).toEqual(["hypervisor", undefined]);
    expect(ifs(t, "pve1")).toEqual([
      ["eno1", { extra: {} }],
      ["eno2", { extra: {} }],
      ["eno10", { extra: {} }],
      ["bond0", { type: "bond", members: ["eno1", "eno2"], bondMode: "802.3ad", extra: {} }],
      [
        "vmbr0",
        {
          type: "bridge",
          members: ["bond0"],
          vlanAware: true,
          ip: ["192.168.10.2/24"],
          description: "LAN",
          extra: {},
        },
      ],
      ["vmbr1", { type: "bridge", vlanAware: true, vlans: "10,20,30-40", extra: {} }],
      [
        "mgmt",
        {
          type: "vlan",
          vlanRawDevice: "eno10",
          vlan: 99,
          ip: ["10.99.0.2/24", "fd00:99::2/64"],
          extra: {},
        },
      ],
      // 名前から分かる親と VLAN ID は書かない。netmask はプレフィックス長にする
      ["vmbr0.20", { type: "vlan", ip: ["192.168.20.2/24"], extra: {} }],
    ]);
  });

  it("OVS のブリッジ・bond も取り込む。タグの無い内部ポートの IP は、ブリッジに書く", () => {
    const { topology: t } = load();
    expect(ifs(t, "pve3")).toEqual([
      ["enp1s0", { extra: {} }],
      ["enp2s0", { extra: {} }],
      // Linux の bond に無いモード(balance-slb)は書かない
      ["ovsbond0", { type: "bond", members: ["enp1s0", "enp2s0"], extra: {} }],
      [
        "ovsbr0",
        {
          type: "bridge",
          members: ["ovsbond0"],
          vlanAware: true,
          ip: ["192.168.1.3/24"],
          extra: {},
        },
      ],
      [
        "mgmt0",
        { type: "vlan", vlanRawDevice: "ovsbr0", vlan: 50, ip: ["10.50.0.3/24"], extra: {} },
      ],
    ]);
  });
});

describe("importProxmox: ゲスト(SPEC 4.7)", () => {
  it("ノードのあとに、ノードごとのゲストを VMID の順に並べる。テンプレートと読めないゲストは取り込まない", () => {
    const { topology: t } = load();
    expect([...t.devices.keys()]).toEqual([
      "pve1",
      "pve2",
      "pve3",
      "fw01",
      "web01",
      "pve2-102",
      "vm103",
      "db-01",
      "web01-300",
    ]);
    const web01 = t.devices.get("web01");
    expect([web01?.model, web01?.host, web01?.vmid, web01?.label]).toEqual([
      "generic-vm",
      "pve1",
      101,
      undefined,
    ]);
    // 名前と違う ID にしたときは、label に名前
    expect(t.devices.get("pve2-102")?.label).toBe("pve2");
    expect(t.devices.get("db-01")?.label).toBe("db 01");
    expect(t.devices.get("db-01")?.model).toBe("generic-container");
    expect(t.devices.get("web01-300")?.label).toBe("web01");
  });

  it("IF の tag・trunks・IP(dhcp などは書かない)。書くことの無い IF は書かない", () => {
    const { topology: t } = load();
    expect(ifs(t, "web01")).toEqual([["net0", { vlan: 10, ip: ["192.168.10.11/24"], extra: {} }]]);
    expect(ifs(t, "fw01")).toEqual([["net0", { mode: "trunk", vlans: "10,20,30", extra: {} }]]);
    expect(ifs(t, "db-01")).toEqual([["net0", { vlan: 20, ip: ["192.168.20.21/24"], extra: {} }]]);
    expect(ifs(t, "vm103")).toEqual([]);
  });

  it("bridge= からリンクを作る。読めたノードに無いブリッジへは作らず、読めないノードにはブリッジを作る", () => {
    const { topology: t, warnings } = load();
    expect(t.links.map((l) => `${l.a?.device}:${l.a?.iface} ${l.b?.device}:${l.b?.iface}`)).toEqual(
      [
        "fw01:net0 pve1:vmbr0",
        "web01:net0 pve1:vmbr0",
        "vm103:net0 pve1:vmbr1",
        "db-01:net0 pve1:vmbr0",
        "web01-300:net0 pve2:vmbr0",
      ],
    );
    expect(ifs(t, "pve2")).toEqual([["vmbr0", { type: "bridge", extra: {} }]]);
    expect(warnings).toEqual([
      "pve2 のネットワークを読めませんでした(ゲストの設定から、ブリッジだけを作りました)",
      "fw01 の net1 のつなぎ先「vmbr9」は、pve1 のブリッジにも SDN の VNet にも無いので、リンクを作りませんでした",
      "VM 104(pve1)の設定を読めませんでした",
    ]);
  });
});

describe("importProxmox: 図(SPEC 4.7)", () => {
  it("タイトルと説明を付け、JSON Schema のコメント行から始まる YAML にする。読み直すと問題が無い", () => {
    const { topology, text } = load();
    expect(topology.meta).toEqual({
      title: "Proxmox VE",
      description: "2026-11-04T05:00:00Z に pve1 で書き出した構成から取り込みました",
      extra: {},
    });
    expect(text.split("\n")[0]).toMatch(/^# yaml-language-server: \$schema=/);
    expect(text).toContain("  web01:\n    model: generic-vm\n    host: pve1\n    vmid: 101\n");
    const parsed = parseTopology(text, { catalog: testCatalog });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    expect([
      ...parsed.issues,
      ...validateTopology(parsed.topology, testCatalog, parsed.base),
    ]).toEqual([]);
  });

  it("書き出しスクリプトの JSON でなければ、理由を返す", () => {
    expect(importProxmox("{")).toEqual({ ok: false, error: "JSON として読めません" });
    expect(importProxmox('{"nodes":[]}')).toEqual({
      ok: false,
      error: "Proxmox VE の書き出しスクリプト(proxmox-export.sh)で作ったファイルではありません",
    });
    expect(importProxmox('{"format":"constella-proxmox","version":2}')).toEqual({
      ok: false,
      error: "対応していない版です(version: 2。読めるのは 1)",
    });
    expect(importProxmox('{"format":"constella-proxmox","version":1,"nodes":[]}')).toEqual({
      ok: false,
      error: "ノードがありません",
    });
  });
});

describe("importProxmox: クラスタと SDN(SPEC 4.7・フェーズ5-2)", () => {
  const clustered = {
    format: "constella-proxmox",
    version: 1,
    nodes: [
      {
        node: "pve1",
        network: [
          { iface: "eno1", type: "eth" },
          { iface: "eno2", type: "eth", cidr: "10.10.0.1/24" },
          { iface: "eno3", type: "eth", cidr: "fd00:11::1/64" },
          {
            iface: "vmbr0",
            type: "bridge",
            bridge_ports: "eno1",
            bridge_vlan_aware: 1,
            cidr: "192.168.10.2/24",
          },
        ],
        qemu: [
          { vmid: 100, config: { name: "app01", net0: "virtio=BC:24:11:00:00:01,bridge=vnet30" } },
        ],
        lxc: [],
      },
      {
        node: "pve2",
        network: null,
        qemu: [
          {
            vmid: 101,
            config: {
              name: "app02",
              net0: "virtio=BC:24:11:00:00:02,bridge=vnet30",
              net1: "virtio=BC:24:11:00:00:03,bridge=vmbr1",
            },
          },
        ],
        lxc: [],
      },
    ],
    cluster: {
      status: [
        { type: "cluster", name: "lab", nodes: 2 },
        { type: "node", name: "pve1" },
        { type: "node", name: "pve2" },
      ],
      nodes: [
        {
          node: "pve1",
          name: "pve1",
          nodeid: "1",
          ring0_addr: "10.10.0.1",
          ring1_addr: "fd00:11::1",
        },
        {
          node: "pve2",
          name: "pve2",
          nodeid: "2",
          ring0_addr: "10.10.0.2",
          ring1_addr: "fd00:11::2",
          ring2_addr: "pve2.local",
        },
      ],
      options: { migration: { type: "secure", network: "192.168.10.0/24" } },
      ceph: { public_network: "10.20.0.0/24, 10.22.0.0/24", cluster_network: "10.21.0.0/24" },
    },
    sdn: {
      zones: [
        { zone: "lan", type: "vlan", bridge: "vmbr0", nodes: "pve1,pve2" },
        { zone: "fab", type: "fabric" },
        { zone: "qz", type: "qinq", bridge: "vmbr0", tag: 100 },
      ],
      vnets: [
        { vnet: "vnet30", zone: "lan", tag: 30, type: "vnet" },
        { vnet: "fabnet", zone: "fab", tag: 5, type: "vnet" },
        { vnet: "q1", zone: "qz", tag: 7, type: "vnet" },
      ],
      subnets: {
        vnet30: [
          { cidr: "192.168.30.0/24", subnet: "lan-192.168.30.0-24" },
          { network: "fd00:30::", mask: "64" },
        ],
        q1: [{ subnet: "qz-10.7.0.0-24" }],
      },
    },
  };

  it("クラスタのグループに、corosync(リンクごと)・migration・Ceph のネットワークを書く", () => {
    const { topology: t } = load(clustered);
    expect(t.groups).toEqual([
      {
        id: "lab",
        uid: expect.any(String),
        kind: "cluster",
        members: ["pve1", "pve2"],
        networks: new Map([
          ["corosync", "10.10.0.0/24"],
          ["corosync-link1", "fd00:11::/64"],
          ["migration", "192.168.10.0/24"],
          ["ceph-public", "10.20.0.0/24"],
          ["ceph-public-2", "10.22.0.0/24"],
          ["ceph-cluster", "10.21.0.0/24"],
        ]),
        extra: {},
      },
    ]);
  });

  it("SDN のゾーンと VNet(サブネットを含む)。取り込めない種類のゾーンと、そこの VNet は取り込まない", () => {
    const { topology: t } = load(clustered);
    expect([...t.sdn.zones]).toEqual([
      ["lan", { type: "vlan", bridge: "vmbr0", nodes: ["pve1", "pve2"], extra: {} }],
      ["qz", { type: "qinq", bridge: "vmbr0", tag: 100, extra: {} }],
    ]);
    expect([...t.sdn.vnets]).toEqual([
      ["vnet30", { zone: "lan", tag: 30, subnets: ["192.168.30.0/24", "fd00:30::/64"], extra: {} }],
      ["q1", { zone: "qz", tag: 7, subnets: ["10.7.0.0/24"], extra: {} }],
    ]);
  });

  it("ゲストは VNet にもつなぐ。読めないノードにも、VNet の名前のブリッジは作らない", () => {
    const { topology: t, warnings } = load(clustered);
    expect(t.links.map((l) => `${l.a?.device}:${l.a?.iface} ${l.b?.device}:${l.b?.iface}`)).toEqual(
      ["app01:net0 pve1:vnet30", "app02:net0 pve2:vnet30", "app02:net1 pve2:vmbr1"],
    );
    expect(ifs(t, "pve2")).toEqual([["vmbr1", { type: "bridge", extra: {} }]]);
    expect(warnings).toEqual([
      "pve2 のネットワークを読めませんでした(ゲストの設定から、ブリッジだけを作りました)",
      "SDN のゾーン「fab」の種類「fabric」は取り込めないので、そのゾーンと VNet は取り込みませんでした",
      "クラスタのネットワーク corosync-link2 のサブネットが分からないので、書きませんでした(アドレス pve2.local を持つ IF がありません)",
    ]);
    // 書いた YAML は、そのまま読み直せる
    const { text } = load(clustered);
    const parsed = parseTopology(text, { catalog: testCatalog });
    expect(parsed.ok && parsed.issues).toEqual([]);
  });

  it("クラスタ名が無ければ(ノード 1 台だけ)グループを作らない。移行のネットワークは文字列でも読む", () => {
    const single = {
      ...clustered,
      cluster: { ...clustered.cluster, status: [{ type: "node", name: "pve1" }] },
    };
    expect(load(single).topology.groups).toEqual([]);
    const text = {
      ...clustered,
      cluster: {
        ...clustered.cluster,
        nodes: null,
        ceph: null,
        options: { migration: "type=insecure,network=10.30.0.0/24" },
      },
    };
    expect([...(load(text).topology.groups[0].networks ?? [])]).toEqual([
      ["migration", "10.30.0.0/24"],
    ]);
  });
});
