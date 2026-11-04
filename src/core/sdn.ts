// SDN(Proxmox VE の SDN。SPEC 4.6・フェーズ4-6)。ゾーン(zones)と VNet(vnets)。
// VNet は、ゾーンの各ホストの中のブリッジとして扱う(箱を描くのは bridges.ts)。

import { ifNameKey } from "./ifname";
import { resolveRole } from "./topology";
import type { Device, ModelCatalog, SdnZone, Topology } from "./types";

/** VNet ID の長さの上限(Proxmox VE の制限) */
export const VNET_ID_MAX_LENGTH = 8;

/**
 * IF 名が VNet なら、その VNet ID(sdn に書いた表記)。IF 名と同じ規則で比べる。
 * デバイスの interfaces に同じ名前の IF があれば、そちらを優先する(重なりはエラーで知らせる)
 */
export function findVnet(
  t: Topology,
  device: Device | undefined,
  iface: string,
): string | undefined {
  if (!device || t.sdn.vnets.size === 0) return undefined;
  const key = ifNameKey(iface);
  for (const name of device.interfaces.keys()) if (ifNameKey(name) === key) return undefined;
  for (const id of t.sdn.vnets.keys()) if (ifNameKey(id) === key) return id;
  return undefined;
}

/** VNet のゾーン。VNet やゾーンが無ければ undefined */
export function zoneOfVnet(t: Topology, vnet: string): SdnZone | undefined {
  const zone = t.sdn.vnets.get(vnet)?.zone;
  return zone === undefined ? undefined : t.sdn.zones.get(zone);
}

/** ゾーンを使うホスト。nodes のうち図にあるもの、省略時はロールが hypervisor の機器すべて(YAML の順) */
export function zoneHosts(t: Topology, zone: SdnZone, catalog: ModelCatalog): string[] {
  if (zone.nodes) return [...new Set(zone.nodes)].filter((id) => t.devices.has(id));
  return [...t.devices.values()]
    .filter((device) => resolveRole(device, catalog) === "hypervisor")
    .map((device) => device.id);
}

/** ホストで使える VNet(ホストが入っているゾーンの VNet。sdn に書いた順) */
export function hostVnets(t: Topology, host: string, catalog: ModelCatalog): string[] {
  return [...t.sdn.vnets.keys()].filter((id) => {
    const zone = zoneOfVnet(t, id);
    return zone !== undefined && zoneHosts(t, zone, catalog).includes(host);
  });
}

/**
 * VNet の箱の下に出す tag の行(SPEC 7.3)。vlan は「VLAN 40」、qinq は「VLAN 40(外側 100)」、
 * vxlan は「VXLAN 1000」、evpn は「EVPN 1000」。simple や、tag・ゾーンが無ければ undefined
 */
export function vnetTagText(t: Topology, vnet: string): string | undefined {
  const tag = t.sdn.vnets.get(vnet)?.tag;
  const zone = zoneOfVnet(t, vnet);
  if (tag === undefined || !zone) return undefined;
  switch (zone.type) {
    case "vlan":
      return `VLAN ${tag}`;
    case "qinq":
      return zone.tag === undefined ? `VLAN ${tag}` : `VLAN ${tag}(外側 ${zone.tag})`;
    case "vxlan":
      return `VXLAN ${tag}`;
    case "evpn":
      return `EVPN ${tag}`;
    default:
      return undefined;
  }
}
