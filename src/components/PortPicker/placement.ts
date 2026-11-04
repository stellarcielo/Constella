// ポート選択ポップアップの置き場所(SPEC 7.2)。デバイスの右に開き、キャンバスに収まらなければ左に開く。
// 上下もキャンバスの中に収める(ポップアップは body に出すので、はみ出しても、ほかのパネルに隠れはしない)。

/** ウィンドウ座標の範囲(DOMRect をそのまま渡せる) */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PickerPosition {
  left: number;
  /** 下へ伸ばすときの上端(デバイスの上端にそろえる) */
  top?: number;
  /** 上へ伸ばすときの、ウィンドウの下端からの距離(デバイスの下端にそろえる) */
  bottom?: number;
  maxHeight: number;
}

export const PICKER_WIDTH = 280;
const MAX_HEIGHT = 420;
/** キャンバスが低くても、これより低くはしない(一覧が見えなくなるため) */
const MIN_HEIGHT = 200;
/** デバイスとの間 */
const GAP = 12;
/** キャンバス・ウィンドウの縁との間 */
const MARGIN = 8;

/** v を lo〜hi に収める。収まらない(lo > hi)ときは lo(左上を見せる) */
function fit(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/** device はデバイスの範囲、canvas はキャンバスの範囲(どちらもウィンドウ座標)、view はウィンドウの大きさ */
export function pickerPlacement(
  device: ScreenRect,
  canvas: ScreenRect,
  view: { width: number; height: number },
): PickerPosition {
  const toRight = device.right + GAP;
  const toLeft = device.left - GAP - PICKER_WIDTH;
  const x =
    toRight + PICKER_WIDTH <= canvas.right - MARGIN
      ? toRight
      : toLeft >= canvas.left + MARGIN
        ? toLeft
        : fit(toRight, canvas.left + MARGIN, canvas.right - MARGIN - PICKER_WIDTH);
  const left = fit(x, MARGIN, view.width - MARGIN - PICKER_WIDTH);

  // デバイスの上端から下へ伸ばす。下に収まらず、上のほうが広ければ、デバイスの下端から上へ伸ばす
  const below = canvas.bottom - MARGIN - device.top;
  const end = Math.min(device.bottom, canvas.bottom - MARGIN);
  const above = end - (canvas.top + MARGIN);
  const height = (room: number) => Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, room));
  if (below >= MAX_HEIGHT || below >= above) {
    const maxHeight = height(below);
    const top = fit(device.top, canvas.top + MARGIN, canvas.bottom - MARGIN - maxHeight);
    return { left, top: fit(top, MARGIN, view.height - MARGIN - maxHeight), maxHeight };
  }
  const maxHeight = height(above);
  return { left, bottom: view.height - Math.max(end, MARGIN + maxHeight), maxHeight };
}
