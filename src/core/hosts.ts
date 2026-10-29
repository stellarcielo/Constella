// ホストとゲストの関係(SPEC 4.6)。枠・自動レイアウト・検証・編集で共有する。

import { findModel } from "./topology";
import type { Device, GuestKind, ModelCatalog, Topology } from "./types";

/**
 * ゲストの種類。デバイスの guest、無ければモデルの guest、どちらも無く host があれば vm。
 * ゲストでなければ undefined
 */
export function resolveGuest(device: Device, catalog: ModelCatalog): GuestKind | undefined {
  return (
    device.guest ??
    findModel(device, catalog)?.guest ??
    (device.host === undefined ? undefined : "vm")
  );
}

export interface HostTree {
  /** ゲストのデバイスID → ホストのデバイスID。ホストが図にあり、たどっても輪にならないものだけ */
  hostOf: ReadonlyMap<string, string>;
  /** ホスト → 直接のゲスト(YAML に書いた順) */
  guestsOf: ReadonlyMap<string, readonly string[]>;
  /** host をたどると輪になるデバイス(自分自身がホストの場合を含む)。輪ごとに、たどる順に並べる */
  cycles: readonly (readonly string[])[];
}

export function hostTree(t: Topology): HostTree {
  const cycles: string[][] = [];
  const inCycle = new Set<string>();
  // たどっている途中(visiting)と、たどり終えた(done)デバイス
  const state = new Map<string, "visiting" | "done">();
  for (const start of t.devices.keys()) {
    const path: string[] = [];
    let id: string | undefined = start;
    while (id !== undefined && !state.has(id)) {
      state.set(id, "visiting");
      path.push(id);
      const host: string | undefined = t.devices.get(id)?.host;
      id = host !== undefined && t.devices.has(host) ? host : undefined;
    }
    if (id !== undefined && state.get(id) === "visiting") {
      const cycle = path.slice(path.indexOf(id));
      cycles.push(cycle);
      for (const member of cycle) inCycle.add(member);
    }
    for (const member of path) state.set(member, "done");
  }

  const hostOf = new Map<string, string>();
  const guestsOf = new Map<string, string[]>();
  for (const device of t.devices.values()) {
    const host = device.host;
    if (host === undefined || !t.devices.has(host) || inCycle.has(device.id)) continue;
    hostOf.set(device.id, host);
    const guests = guestsOf.get(host);
    if (guests) guests.push(device.id);
    else guestsOf.set(host, [device.id]);
  }
  return { hostOf, guestsOf, cycles };
}

/** ホストの上で動くゲスト。入れ子のゲストも含め、ホストに近い順に返す */
export function guestsBelow(tree: HostTree, host: string): string[] {
  const result = [...(tree.guestsOf.get(host) ?? [])];
  for (let i = 0; i < result.length; i++) result.push(...(tree.guestsOf.get(result[i]) ?? []));
  return result;
}
