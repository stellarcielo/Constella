// 図を確かめる・SVG にする(SPEC 11 章)。CLI のコマンドと MCP サーバーで同じ処理を使う。

import {
  allBridges,
  type Issue,
  LAYER_PRESETS,
  lineColumn,
  type ModelCatalog,
  type ParseResult,
  parseTopology,
  placeMissing,
  type RenderedSvg,
  renderSvg,
  type Topology,
  VIEW_LAYERS,
  type ViewLayer,
  validateTopology,
} from "../core";

/** 位置(行と桁)を付けた問題 */
export interface PlacedIssue extends Issue {
  line?: number;
  column?: number;
}

export interface CheckedDiagram {
  parsed: ParseResult;
  /** アプリの問題パネルと同じ問題。位置の順に並べ、位置の無い問題は最後 */
  issues: PlacedIssue[];
  errors: number;
  warnings: number;
}

/** 図の YAML(text)を読んで確かめる */
export function checkDiagram(text: string, catalog: ModelCatalog): CheckedDiagram {
  const parsed = parseTopology(text, { catalog });
  const found = parsed.ok
    ? [...parsed.issues, ...validateTopology(parsed.topology, catalog, parsed.base)]
    : parsed.issues;
  const issues = found
    .map((issue, i) => ({ issue, i }))
    .sort(
      (p, q) =>
        (p.issue.range?.start ?? Infinity) - (q.issue.range?.start ?? Infinity) || p.i - q.i,
    )
    .map(({ issue }) =>
      issue.range ? { ...issue, ...lineColumn(text, issue.range.start) } : issue,
    );
  const errors = issues.filter((i) => i.severity === "error").length;
  return { parsed, issues, errors, warnings: issues.length - errors };
}

/** 問題の 1 行(ファイル:行:桁: error: メッセージ。位置が無ければ ファイル: error: メッセージ) */
export function issueLine(file: string, issue: PlacedIssue): string {
  const at = issue.line === undefined ? file : `${file}:${issue.line}:${issue.column}`;
  return `${at}: ${issue.severity}: ${issue.message}`;
}

export const isViewLayer = (value: string): value is ViewLayer =>
  (VIEW_LAYERS as readonly string[]).includes(value);

/** SVG の表示(CLI の --layer・--long-names・--no-if-labels・--no-guests・--no-groups) */
export interface DiagramSvgOptions {
  layer: ViewLayer;
  longIfNames: boolean;
  showIfLabels: boolean;
  showGuests: boolean;
  showGroups: boolean;
  /** アイコンの画像(ファイル名 → data: URL) */
  iconImages: ReadonlyMap<string, string>;
}

/** 図を SVG にする(アプリの書き出しと同じ) */
export async function diagramSvg(
  t: Topology,
  catalog: ModelCatalog,
  options: DiagramSvgOptions,
): Promise<RenderedSvg> {
  // 座標の無いデバイスとブリッジは、アプリで開いたときと同じく自動で並べる(SPEC 9 章)
  const missing = [...t.devices.keys(), ...allBridges(t).map((b) => b.key)].filter(
    (id) => !t.layout.has(id),
  );
  const fallbackPositions =
    missing.length > 0
      ? await placeMissing(t, catalog, missing, (id) => t.layout.get(id))
      : undefined;
  const layer = LAYER_PRESETS[options.layer];
  return renderSvg(t, catalog, {
    ...layer,
    showIfLabels: layer.showIfLabels && options.showIfLabels,
    showGuests: layer.showGuests && options.showGuests,
    showGroups: layer.showGroups && options.showGroups,
    longIfNames: options.longIfNames,
    fallbackPositions,
    iconImages: options.iconImages,
  });
}
