// GUI でブリッジやゲストを 1 つ足すときの置き場所(フェーズ4-2)。ホストの枠の中の段に並べ、
// ほかのホストの枠や機器と重ならない場所を、右・左・下の段の順に探す。

import { allBridges, BRIDGE_NODE_SIZE, bridgeKey, bridgesOf, parseBridgeKey } from "./bridges";
import { roundPosition } from "./edit";
import { DEVICE_BOX, GROUP_PADDING, groupFrames } from "./groupFrames";
import { hostTree } from "./hosts";
import { bridgePositions, guestPositions } from "./layout";
import type { Position, Topology } from "./types";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * ホストの近くに置くときに避けるもの。ほかのホストの枠と、このホストの枠の外の機器・ブリッジ。
 * 置いたあとに広がる自分の枠の余白の分だけ、広げておく
 */
function obstacles(
  t: Topology,
  positionOf: (id: string) => Position | undefined,
  host: string,
): Box[] {
  const frames = groupFrames(t, positionOf, () => false);
  const own = new Set(frames.find((f) => f.type === "host" && f.host === host)?.members ?? [host]);
  const boxes: Box[] = frames.filter((f) => !f.members.includes(host));
  for (const id of [...t.devices.keys(), ...allBridges(t).map((b) => b.key)]) {
    const p = positionOf(id);
    if (!p || own.has(id)) continue;
    boxes.push({ x: p.x, y: p.y, ...(parseBridgeKey(id) ? BRIDGE_NODE_SIZE : DEVICE_BOX) });
  }
  return boxes.map((b) => ({
    x: b.x - GROUP_PADDING,
    y: b.y - GROUP_PADDING,
    width: b.width + GROUP_PADDING * 2,
    height: b.height + GROUP_PADDING * 2,
  }));
}

/**
 * ホストに 1 つ足すブリッジ(kind: "bridge")かゲスト(kind: "guest")の置き場所。
 * 同じ段の右、左、下の段の順に、重ならない場所を探す。どこも重なれば右に置く。
 * ホストに座標が無ければ undefined
 */
export function placeNearHost(
  t: Topology,
  positionOf: (id: string) => Position | undefined,
  host: string,
  kind: "bridge" | "guest",
): Position | undefined {
  const hostPos = positionOf(host);
  if (!hostPos) return undefined;
  const positions = (ids: string[]) =>
    ids.flatMap((id) => {
      const p = positionOf(id);
      return p ? [p] : [];
    });
  const bridges = positions(bridgesOf(t.devices.get(host)).map((b) => bridgeKey(host, b)));
  const guests = positions([...(hostTree(t).guestsOf.get(host) ?? [])]);
  const row = kind === "bridge" ? bridges : guests;
  const size = kind === "bridge" ? BRIDGE_NODE_SIZE : DEVICE_BOX;
  const next =
    kind === "bridge"
      ? (placed: Position[]) => bridgePositions(hostPos, placed, 1)[0]
      : (placed: Position[]) => guestPositions(hostPos, placed, 1, bridges)[0];

  const candidates = [next(row)];
  if (row.length > 0) {
    const y = Math.max(...row.map((p) => p.y));
    const inRow = row.filter((p) => p.y === y);
    const step = candidates[0].x - Math.max(...inRow.map((p) => p.x));
    candidates.push(roundPosition({ x: Math.min(...inRow.map((p) => p.x)) - step, y }));
    // 下の段(ホストを中心に)
    const below = y + size.height + (kind === "bridge" ? 20 : 100);
    candidates.push(roundPosition({ x: hostPos.x, y: below }));
  }
  const blocked = obstacles(t, positionOf, host);
  return (
    candidates.find((c) => blocked.every((b) => !overlaps({ ...c, ...size }, b))) ?? candidates[0]
  );
}
