// 書き出しスクリプト(proxmox-export.sh)のテスト(SPEC 4.7)。pvesh の代わりの小さなスクリプトと、
// /etc/pve の代わりのフォルダを用意して実行し、取り込める JSON になるかを確かめる。
// Node.js の機能(子プロセス・ファイル)を使うので、src の外に置き、scripts/tsconfig.json で型を確かめる。

import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { importProxmox } from "../src/core";

const script = fileURLToPath(new URL("./proxmox-export.sh", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "constella-proxmox-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

// pvesh の代わり。pve2 は停止中として、どの問い合わせにも答えない。
// SDN は適用済み(--running 1)と今の設定で答えを変え、サブネットは今の設定でだけ答える(古い版のつもり)
const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "pvesh"),
  `#!/bin/sh
[ "$1" = get ] || exit 9
path=$2
shift 2
running=0
while [ $# -gt 0 ]; do
  case $1 in
    --running) running=$2; shift 2 ;;
    --output-format) [ "$2" = json ] || exit 9; shift 2 ;;
    *) exit 9 ;;
  esac
done
case "$path:$running" in
  /nodes/pve1/network:0) echo '[{"iface":"eno1","type":"eth"},{"iface":"vmbr0","type":"bridge","bridge_ports":"eno1","cidr":"192.168.1.2/24"}]' ;;
  /nodes/pve1/qemu/100/config:0) echo '{"name":"web01","net0":"virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=10"}' ;;
  /nodes/pve1/qemu/102/config:0) echo '{"name":"app01","net0":"virtio=BC:24:11:00:00:02,bridge=vnet30"}' ;;
  /nodes/pve1/lxc/200/config:0) echo '{"hostname":"db01","net0":"name=eth0,bridge=vmbr0,ip=192.168.1.20/24"}' ;;
  /cluster/status:0) echo '[{"type":"cluster","name":"lab","nodes":2},{"type":"node","name":"pve1"},{"type":"node","name":"pve2"}]' ;;
  /cluster/config/nodes:0) echo '[{"node":"pve1","name":"pve1","ring0_addr":"192.168.1.2"},{"node":"pve2","name":"pve2","ring0_addr":"192.168.1.3"}]' ;;
  /cluster/options:0) echo '{"migration":{"type":"secure","network":"192.168.1.0/24"}}' ;;
  /cluster/sdn/zones:1) echo '[{"type":"vlan","zone":"lan","bridge":"vmbr0"}]' ;;
  /cluster/sdn/zones:0) echo '[{"type":"vlan","zone":"edited","bridge":"vmbr0"}]' ;;
  /cluster/sdn/vnets:1) echo '[{"tag":30,"type":"vnet","vnet":"vnet30","zone":"lan"}]' ;;
  /cluster/sdn/vnets/vnet30/subnets:0) echo '[{"cidr":"192.168.30.0/24","subnet":"lan-192.168.30.0-24","type":"subnet","vnet":"vnet30"}]' ;;
  *) echo "no such path: $path" >&2; exit 2 ;;
esac
`,
);
chmodSync(join(bin, "pvesh"), 0o755);

// /etc/pve の代わり(nodes/<ノード>/qemu-server・lxc の VMID.conf)
const pve = join(work, "pve");
for (const path of [
  "nodes/pve1/qemu-server/100.conf",
  "nodes/pve1/qemu-server/102.conf",
  "nodes/pve1/qemu-server/notes.conf",
  "nodes/pve1/lxc/200.conf",
  "nodes/pve2/qemu-server/101.conf",
]) {
  mkdirSync(join(pve, path, ".."), { recursive: true });
  writeFileSync(join(pve, path), "");
}
// Ceph の設定(キーは「public network」のように空白でも書ける)
writeFileSync(
  join(pve, "ceph.conf"),
  "[global]\n\t auth_client_required = cephx\n\t cluster network = 10.21.0.0/24\n\t public_network = 10.20.0.0/24\n",
);

function run(env: Record<string, string>) {
  return spawnSync("sh", [script], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

describe("書き出しスクリプト(SPEC 4.7)", () => {
  it("ノードとゲストの設定を、取り込める JSON にまとめる。読めないところは null にして続ける", () => {
    const result = run({ PATH: `${bin}:${process.env.PATH ?? ""}`, CONSTELLA_PVE_DIR: pve });
    expect(result.status).toBe(0);
    const data = JSON.parse(result.stdout) as {
      format: string;
      version: number;
      nodes: { node: string; network: unknown; qemu: unknown[]; lxc: unknown[] }[];
    };
    expect([data.format, data.version]).toEqual(["constella-proxmox", 1]);
    expect(
      data.nodes.map((n) => [n.node, n.network === null, n.qemu.length, n.lxc.length]),
    ).toEqual([
      ["pve1", false, 2, 1],
      ["pve2", true, 1, 0],
    ]);
    expect(data.nodes[1].qemu).toEqual([{ vmid: 101, config: null }]);
    expect(result.stderr).toContain("読めませんでした: /nodes/pve2/network");

    const imported = importProxmox(result.stdout);
    if (!imported.ok) throw new Error(imported.error);
    expect([...imported.topology.devices.keys()]).toEqual([
      "pve1",
      "pve2",
      "web01",
      "app01",
      "db01",
    ]);
    expect(imported.warnings).toHaveLength(2);
  });

  it("クラスタと Ceph のネットワーク、SDN(適用済みの設定。読めなければ今の設定)も書き出す", () => {
    const result = run({ PATH: `${bin}:${process.env.PATH ?? ""}`, CONSTELLA_PVE_DIR: pve });
    const data = JSON.parse(result.stdout) as {
      cluster: { status: unknown[]; nodes: unknown[]; options: unknown; ceph: unknown };
      sdn: { zones: { zone: string }[]; vnets: unknown[]; subnets: Record<string, unknown[]> };
    };
    expect(data.cluster.status).toHaveLength(3);
    expect(data.cluster.ceph).toEqual({
      public_network: "10.20.0.0/24",
      cluster_network: "10.21.0.0/24",
    });
    expect(data.sdn.zones.map((z) => z.zone)).toEqual(["lan"]);
    expect(Object.keys(data.sdn.subnets)).toEqual(["vnet30"]);

    const imported = importProxmox(result.stdout);
    if (!imported.ok) throw new Error(imported.error);
    const t = imported.topology;
    expect([...(t.groups[0].networks ?? [])]).toEqual([
      ["corosync", "192.168.1.0/24"],
      ["migration", "192.168.1.0/24"],
      ["ceph-public", "10.20.0.0/24"],
      ["ceph-cluster", "10.21.0.0/24"],
    ]);
    expect(t.sdn.vnets.get("vnet30")?.subnets).toEqual(["192.168.30.0/24"]);
    expect(t.links.map((l) => `${l.a?.device} ${l.b?.device}:${l.b?.iface}`)).toContain(
      "app01 pve1:vnet30",
    );
  });

  it("pvesh が無ければ、理由を出して終わる", () => {
    const result = run({ PATH: "/usr/bin:/bin", CONSTELLA_PVE_DIR: pve });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pvesh が見つかりません");
  });
});
