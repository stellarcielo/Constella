// パレットから VM・コンテナを置いたときの、ホストと位置(SPEC 7.1・フェーズ4-1 Q2)。

import { DEVICE_BOX, groupFrames } from "./groupFrames";
import { guestsBelow, hostTree } from "./hosts";
import { placeNearHost } from "./placement";
import { resolveRole } from "./topology";
import type { ModelCatalog, Position, Topology } from "./types";

export interface GuestDrop {
  /** ゲストにするホストのデバイスID */
  host: string;
  /** 置く位置。undefined なら落とした位置 */
  position?: Position;
}

/**
 * point(図の座標)に落としたゲストを、どのホストのゲストにするか。
 * - ハイパーバイザ(またはゲストのいるホスト)の機器の上: そのホストのゲストにし、ホストの下に並べる
 *   (ほかのホストの枠や機器と重ならない場所を探す)
 * - ホストの枠の中: そのホストのゲストにする(いちばん内側の枠。位置は落とした所)
 * - それ以外: undefined(ホストなし)
 * positionOf は今の機器の位置(隠している機器は undefined)
 */
export function guestDropTarget(
  t: Topology,
  catalog: ModelCatalog,
  positionOf: (id: string) => Position | undefined,
  point: Position,
): GuestDrop | undefined {
  const tree = hostTree(t);
  const inside = (p: Position, x: number, y: number, width: number, height: number) =>
    p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height;

  for (const device of t.devices.values()) {
    const pos = positionOf(device.id);
    if (!pos || !inside(point, pos.x, pos.y, DEVICE_BOX.width, DEVICE_BOX.height)) continue;
    const isHost = resolveRole(device, catalog) === "hypervisor" || tree.guestsOf.has(device.id);
    if (!isHost) break;
    return { host: device.id, position: placeNearHost(t, positionOf, device.id, "guest") };
  }

  // 枠は外側から順に並んでいるので、後ろから探すといちばん内側の枠が見つかる
  const frames = groupFrames(t, positionOf, () => false);
  for (const frame of [...frames].reverse()) {
    if (frame.type === "host" && inside(point, frame.x, frame.y, frame.width, frame.height)) {
      return { host: frame.host };
    }
  }
  return undefined;
}

/** ホストに置けるデバイス(自分自身と、自分の上で動くゲストを除く。輪にならないように) */
export function hostCandidates(t: Topology, id: string): string[] {
  const below = new Set(guestsBelow(hostTree(t), id));
  return [...t.devices.keys()].filter((other) => other !== id && !below.has(other));
}
