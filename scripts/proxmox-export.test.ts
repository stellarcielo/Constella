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

// pvesh の代わり。pve2 は停止中として、どの問い合わせにも答えない
const bin = join(work, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "pvesh"),
  `#!/bin/sh
[ "$1" = get ] && [ "$3" = --output-format ] && [ "$4" = json ] || exit 9
case "$2" in
  /nodes/pve1/network) echo '[{"iface":"eno1","type":"eth"},{"iface":"vmbr0","type":"bridge","bridge_ports":"eno1","cidr":"192.168.1.2/24"}]' ;;
  /nodes/pve1/qemu/100/config) echo '{"name":"web01","net0":"virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=10"}' ;;
  /nodes/pve1/lxc/200/config) echo '{"hostname":"db01","net0":"name=eth0,bridge=vmbr0,ip=192.168.1.20/24"}' ;;
  *) echo "no such path: $2" >&2; exit 2 ;;
esac
`,
);
chmodSync(join(bin, "pvesh"), 0o755);

// /etc/pve の代わり(nodes/<ノード>/qemu-server・lxc の VMID.conf)
const pve = join(work, "pve");
for (const path of [
  "nodes/pve1/qemu-server/100.conf",
  "nodes/pve1/qemu-server/notes.conf",
  "nodes/pve1/lxc/200.conf",
  "nodes/pve2/qemu-server/101.conf",
]) {
  mkdirSync(join(pve, path, ".."), { recursive: true });
  writeFileSync(join(pve, path), "");
}

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
      ["pve1", false, 1, 1],
      ["pve2", true, 1, 0],
    ]);
    expect(data.nodes[1].qemu).toEqual([{ vmid: 101, config: null }]);
    expect(result.stderr).toContain("読めませんでした: /nodes/pve2/network");

    const imported = importProxmox(result.stdout);
    if (!imported.ok) throw new Error(imported.error);
    expect([...imported.topology.devices.keys()]).toEqual(["pve1", "pve2", "web01", "db01"]);
    expect(imported.warnings).toHaveLength(2);
  });

  it("pvesh が無ければ、理由を出して終わる", () => {
    const result = run({ PATH: "/usr/bin:/bin", CONSTELLA_PVE_DIR: pve });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("pvesh が見つかりません");
  });
});
