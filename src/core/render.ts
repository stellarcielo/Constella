// トポロジを SVG の文字列にする(SVG / PNG の書き出し。将来の CLI の `constella render` でも使う)。
// 見た目はキャンバスに合わせ、ライトテーマ・白背景で描く(フェーズ2-4 Q2)。選択や問題の印は描かない。

import { groupFrames, groupTitle } from "./groupFrames";
import { ROLE_ICON_SVG, ROLE_ICON_VIEWBOX } from "./icons";
import { expandIfName } from "./ifname";
import {
  endLabelPositions,
  estimateLabelSize,
  midpoint,
  offsetLine,
  parallelSlots,
  type Point,
  selfLoop,
  slotOffset,
} from "./linkGeometry";
import { linkMedia } from "./media";
import { resolveLabel, resolveRole } from "./topology";
import type { GroupKind, Media, ModelCatalog, Position, Role, Topology } from "./types";

export interface RenderOptions {
  /** layout に座標の無いデバイスの位置(キャンバスの自動配置。キー = デバイスID) */
  fallbackPositions?: ReadonlyMap<string, Position>;
  /** リンク両端の IF 名を描くか(ツールバーの「IF 名」) */
  showIfLabels?: boolean;
  /** IF 名を長い形で描くか(ツールバーの「長い名前」) */
  longIfNames?: boolean;
  /** グループの枠を描くか(ツールバーの「グループ」) */
  showGroups?: boolean;
  /** 図のまわりの余白 */
  padding?: number;
}

export interface RenderedSvg {
  svg: string;
  width: number;
  height: number;
}

/** 書き出しの色(App.css のライトテーマと合わせる) */
const THEME = {
  background: "#ffffff",
  panel: "#f6f7f9",
  border: "#d9dce1",
  text: "#1f2328",
  textMuted: "#646b75",
  labelBg: "#ffffff",
  labelBgOpacity: 0.92,
};

const ROLE_COLORS: Record<Role, string> = {
  cloud: "#6e7781",
  router: "#2f6fde",
  firewall: "#cf3d2e",
  l3switch: "#8250df",
  l2switch: "#1a7f37",
  server: "#bf5b00",
  pc: "#0a7d8c",
  ap: "#b3368f",
  generic: "#57606a",
};

/** media ごとの線の色と種類(Canvas.css と合わせる) */
const MEDIA_STYLES: Record<Media, string> = {
  copper: 'stroke="#8c959f"',
  fiber: 'stroke="#e8822a"',
  dac: 'stroke="#3d7be0"',
  wireless: 'stroke="#8c959f" stroke-dasharray="8 5"',
  virtual: 'stroke="#8c959f" stroke-dasharray="2 4" stroke-linecap="round"',
};

/**
 * グループの種類ごとの枠の見た目(Canvas.css と合わせる。フェーズ3-1 Q2)。
 * 拠点は太い実線、ラックは実線、VLAN は破線、サブネットは点線、AS は一点鎖線、種類なしは細い実線
 */
const GROUP_STYLES: Record<GroupKind | "none", string> = {
  site: 'stroke="#57606a" stroke-width="2.5" fill="#f6f8fa"',
  rack: 'stroke="#8c959f" stroke-width="1.5" fill="#eef1f4" fill-opacity="0.7"',
  vlan: 'stroke="#8250df" stroke-width="1.5" stroke-dasharray="8 5" fill="#8250df" fill-opacity="0.05"',
  subnet:
    'stroke="#1a7f37" stroke-width="1.5" stroke-dasharray="1 4" stroke-linecap="round" fill="#1a7f37" fill-opacity="0.05"',
  as: 'stroke="#bc4c00" stroke-width="1.5" stroke-dasharray="10 4 2 4" fill="#bc4c00" fill-opacity="0.05"',
  custom: 'stroke="#8c959f" stroke-width="1" fill="none"',
  none: 'stroke="#8c959f" stroke-width="1" fill="none"',
};

const GROUP_TEXT_COLORS: Record<GroupKind | "none", string> = {
  site: "#424a53",
  rack: "#57606a",
  vlan: "#8250df",
  subnet: "#1a7f37",
  as: "#bc4c00",
  custom: "#57606a",
  none: "#57606a",
};

const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Segoe UI", sans-serif';
const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// デバイスの大きさ(Canvas.css の .device-node と合わせる)。座標はノードの左上
const NODE_WIDTH = 96;
const ICON_BOX = 52;
const ICON_SIZE = 34;
const NAME_TOP = ICON_BOX + 4;
const NAME_HEIGHT = 18;
const NAME_FONT = 12;

/** ノードの左上の座標から、アイコンの中心へ(キャンバスのリンクの端と同じ点) */
function iconCenter(p: Position): Point {
  return { x: p.x + NODE_WIDTH / 2, y: p.y + ICON_BOX / 2 };
}

/** デバイス名の幅の見積もり(全角は 12px、半角は 7px) */
function nameWidth(text: string): number {
  let width = 12;
  for (const ch of text) width += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? 12 : 7;
  return width;
}

/** SVG の文字や属性に入れるため、特別な意味のある文字を置き換える */
export function escapeXml(text: string): string {
  return text
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

const n = (v: number) => String(Math.round(v * 10) / 10);

/** 描いたものの範囲 */
class Bounds {
  left = Infinity;
  top = Infinity;
  right = -Infinity;
  bottom = -Infinity;

  add(x0: number, y0: number, x1: number, y1: number): void {
    this.left = Math.min(this.left, x0);
    this.top = Math.min(this.top, y0);
    this.right = Math.max(this.right, x1);
    this.bottom = Math.max(this.bottom, y1);
  }

  get empty(): boolean {
    return this.left > this.right;
  }
}

/** 背景付きのラベル(中心が at) */
function label(
  at: Point,
  text: string,
  size: { width: number; height: number },
  style: { font: string; fontSize: number; color: string; border: boolean; bold?: boolean },
  bounds: Bounds,
): string {
  const x = at.x - size.width / 2;
  const y = at.y - size.height / 2;
  bounds.add(x, y, x + size.width, y + size.height);
  const border = style.border ? ` stroke="${THEME.border}"` : "";
  return (
    `<rect x="${n(x)}" y="${n(y)}" width="${n(size.width)}" height="${n(size.height)}" rx="3" ` +
    `fill="${THEME.labelBg}" fill-opacity="${THEME.labelBgOpacity}"${border}/>` +
    `<text x="${n(at.x)}" y="${n(at.y + style.fontSize * 0.35)}" text-anchor="middle" ` +
    `font-family="${escapeXml(style.font)}" font-size="${style.fontSize}"` +
    `${style.bold ? ' font-weight="600"' : ""} fill="${style.color}">${escapeXml(text)}</text>`
  );
}

/**
 * 図全体を SVG にする。座標の無い(fallbackPositions にも無い)デバイスと、そこにつながるリンクは描かない
 */
export function renderSvg(
  t: Topology,
  catalog: ModelCatalog,
  options: RenderOptions = {},
): RenderedSvg {
  const showIfLabels = options.showIfLabels ?? true;
  const padding = options.padding ?? 24;
  const bounds = new Bounds();

  const positions = new Map<string, Position>();
  for (const id of t.devices.keys()) {
    const pos = t.layout.get(id) ?? options.fallbackPositions?.get(id);
    if (pos) positions.set(id, pos);
  }

  // グループの枠(いちばん下。外側の枠から描く)。ラベルは背景を付けて線より手前に描く(キャンバスと同じ)
  const frames: string[] = [];
  const frameLabels: string[] = [];
  if (options.showGroups ?? true) {
    for (const frame of groupFrames(t, (id) => positions.get(id))) {
      const kind = frame.group.kind ?? "none";
      bounds.add(frame.x, frame.y, frame.x + frame.width, frame.y + frame.height);
      frames.push(
        `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}" ` +
          `rx="10" ${GROUP_STYLES[kind]}/>`,
      );
      const title = groupTitle(frame.group);
      const size = { width: nameWidth(title), height: 16 };
      frameLabels.push(
        label(
          { x: frame.x + 8 + size.width / 2, y: frame.y + 4 + size.height / 2 },
          title,
          size,
          { font: FONT, fontSize: 11, color: GROUP_TEXT_COLORS[kind], border: false, bold: true },
          bounds,
        ),
      );
    }
  }

  // リンク(線は下、ラベルはデバイスより上に描く。キャンバスと同じ重なり)
  const drawable = t.links.flatMap((link) =>
    link.a && link.b && positions.has(link.a.device) && positions.has(link.b.device)
      ? [{ link, a: link.a, b: link.b }]
      : [],
  );
  const slots = parallelSlots(
    drawable.map(({ link, a, b }) => ({ id: link.id, source: a.device, target: b.device })),
  );
  const ifName = (name: string) => (options.longIfNames ? expandIfName(name) : name);
  const lines: string[] = [];
  const linkLabels: string[] = [];
  for (const { link, a, b } of drawable) {
    const slot = slots.get(link.id) ?? { index: 0, count: 1 };
    const ca = iconCenter(positions.get(a.device) as Position);
    const cb = iconCenter(positions.get(b.device) as Position);
    const aName = ifName(a.iface);
    const bName = ifName(b.iface);
    let path: string;
    let ends: { a: Point; b: Point };
    let center: Point;
    if (a.device === b.device) {
      const loop = selfLoop(ca, slot.index, link.label);
      path = loop.path;
      ends = { a: loop.labelA, b: loop.labelB };
      center = loop.label;
      // 輪の制御点の範囲(曲線はこの内側に収まる)
      const width = 46 + slot.index * 22;
      const height = 12 + slot.index * 18 + 18 + slot.index * 14;
      bounds.add(ca.x, ca.y - height, ca.x + 26 + width, ca.y + height);
    } else {
      const line = offsetLine(ca, cb, slotOffset(slot), a.device > b.device);
      path = `M ${n(line.a.x)},${n(line.a.y)} L ${n(line.b.x)},${n(line.b.y)}`;
      ends = endLabelPositions(line.a, line.b, aName, bName, slot);
      center = midpoint(line.a, line.b);
    }
    lines.push(
      `<path d="${path}" fill="none" stroke-width="2" ${MEDIA_STYLES[linkMedia(link, t, catalog)]}/>`,
    );
    if (showIfLabels) {
      const style = { font: MONO_FONT, fontSize: 10, color: THEME.text, border: true };
      linkLabels.push(label(ends.a, aName, estimateLabelSize(aName), style, bounds));
      linkLabels.push(label(ends.b, bName, estimateLabelSize(bName), style, bounds));
    }
    if (link.label) {
      const style = { font: FONT, fontSize: 11, color: THEME.textMuted, border: false };
      linkLabels.push(label(center, link.label, estimateLabelSize(link.label), style, bounds));
    }
  }

  // デバイス(角丸の箱の中のアイコンと、その下の名前)
  const nodes: string[] = [];
  const iconScale = ICON_SIZE / ROLE_ICON_VIEWBOX;
  for (const [id, pos] of positions) {
    const device = t.devices.get(id);
    if (!device) continue;
    const role = resolveRole(device, catalog);
    const boxX = pos.x + (NODE_WIDTH - ICON_BOX) / 2;
    const iconX = pos.x + (NODE_WIDTH - ICON_SIZE) / 2;
    const iconY = pos.y + (ICON_BOX - ICON_SIZE) / 2;
    const name = resolveLabel(device);
    const nameCenter = { x: pos.x + NODE_WIDTH / 2, y: pos.y + NAME_TOP + NAME_HEIGHT / 2 };
    bounds.add(boxX, pos.y, boxX + ICON_BOX, pos.y + ICON_BOX);
    nodes.push(
      `<g>` +
        `<rect x="${n(boxX)}" y="${n(pos.y)}" width="${ICON_BOX}" height="${ICON_BOX}" rx="12" ` +
        `fill="${THEME.panel}" stroke="${THEME.border}"/>` +
        `<g transform="translate(${n(iconX)} ${n(iconY)}) scale(${iconScale.toFixed(4)})" ` +
        `fill="none" stroke="${ROLE_COLORS[role]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">` +
        `${ROLE_ICON_SVG[role]}</g>` +
        label(
          nameCenter,
          name,
          { width: nameWidth(name), height: NAME_HEIGHT },
          { font: FONT, fontSize: NAME_FONT, color: THEME.text, border: false },
          bounds,
        ) +
        `</g>`,
    );
  }

  if (bounds.empty) bounds.add(0, 0, 0, 0);
  const x = Math.floor(bounds.left - padding);
  const y = Math.floor(bounds.top - padding);
  const width = Math.ceil(bounds.right + padding) - x;
  const height = Math.ceil(bounds.bottom + padding) - y;
  const title = t.meta.title ? `<title>${escapeXml(t.meta.title)}</title>` : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${x} ${y} ${width} ${height}">` +
    title +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${THEME.background}"/>` +
    `<g>${frames.join("")}</g>` +
    `<g>${lines.join("")}</g>` +
    `<g>${frameLabels.join("")}</g>` +
    `<g>${nodes.join("")}</g>` +
    `<g>${linkLabels.join("")}</g>` +
    `</svg>\n`;
  return { svg, width, height };
}
