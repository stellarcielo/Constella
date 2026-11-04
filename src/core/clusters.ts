// クラスタ(SPEC 4.6・フェーズ4-5)。kind: cluster のグループに並べたホストと、クラスタのネットワーク。
// ラベルでは、クラスタのホストの IP に、その IP が入るネットワークの名前を添える。

import { parseIpAddress, parseSubnet, type Subnet, subnetContains } from "./ip";
import type { Group, Topology } from "./types";

/** クラスタのネットワーク(サブネットが読めるもの) */
export interface ClusterNetwork {
  name: string;
  /** サブネット(書いたとおり) */
  text: string;
  subnet: Subnet;
}

/**
 * ホストのデバイスID → 入っているクラスタ(groups の中の位置)。図にあるメンバーだけ。
 * 2 つ以上のクラスタに入っていれば、最初のクラスタだけ(ほかはエラーで知らせる)
 */
export function clusterOfHosts(t: Topology): Map<string, number> {
  const result = new Map<string, number>();
  t.groups.forEach((group, index) => {
    if (group.kind !== "cluster") return;
    for (const member of group.members) {
      if (t.devices.has(member) && !result.has(member)) result.set(member, index);
    }
  });
  return result;
}

/** クラスタのネットワークのうち、サブネットが読めるもの(書いた順。読めないものは警告で知らせる) */
export function clusterNetworks(group: Group): ClusterNetwork[] {
  if (group.kind !== "cluster" || !group.networks) return [];
  return [...group.networks].flatMap(([name, text]) => {
    const subnet = parseSubnet(text);
    return subnet ? [{ name, text, subnet }] : [];
  });
}

/** IP(「10.10.0.11/24」。`/` の後ろは見ない)がネットワークに入るか */
export function inClusterNetwork(network: ClusterNetwork, ip: string): boolean {
  const address = parseIpAddress(ip);
  return address !== undefined && subnetContains(network.subnet, address);
}

/**
 * ラベルの IP の行の書き方(SPEC 4.6)。クラスタのホストの IP には、入るネットワークの名前を添える
 * (「10.10.0.11/24 (corosync)」「10.20.0.11/24 (ceph-public, ceph-cluster)」)。
 * デバイスID を渡すと、そのデバイスの IP の書き方を返す。ゲストなど、クラスタのホストでなければそのまま
 */
export function clusterIpText(t: Topology): (deviceId: string) => (ip: string) => string {
  const clusterOf = clusterOfHosts(t);
  const networks = new Map<number, ClusterNetwork[]>();
  const networksOf = (index: number) => {
    let list = networks.get(index);
    if (!list) {
      list = clusterNetworks(t.groups[index]);
      networks.set(index, list);
    }
    return list;
  };
  return (deviceId) => {
    const index = clusterOf.get(deviceId);
    const list = index === undefined ? [] : networksOf(index);
    if (list.length === 0) return (ip) => ip;
    return (ip) => {
      const names = list.filter((network) => inClusterNetwork(network, ip)).map((n) => n.name);
      return names.length === 0 ? ip : `${ip} (${names.join(", ")})`;
    };
  };
}
