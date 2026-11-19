// CLI のコマンド(SPEC 11 章)。validate は図を確かめて問題を出し、render は SVG を書き出す。
// ファイルの読み書きと出力は CliDeps から使う(テストで差し替えられるように)。戻り値は終了コード。

import { parseArgs } from "node:util";
import {
  allBridges,
  type Issue,
  LAYER_PRESETS,
  lineColumn,
  type ModelCatalog,
  type ParseResult,
  parseTopology,
  placeMissing,
  renderSvg,
  VIEW_LAYERS,
  type ViewLayer,
  validateTopology,
} from "../core";
import type { CliCatalog } from "./catalog";

/** 終了コード: エラーなし、図にエラーがある、使い方の間違い・ファイルが読めない */
export const EXIT = { ok: 0, problems: 1, usage: 2 } as const;

/** ユーザーモデルとアイコンの画像を読むフォルダ(--models・--icons・--no-user-models) */
export interface ModelSource {
  models?: string;
  icons?: string;
  userModels: boolean;
}

export interface CliDeps {
  version: string;
  /** 既定のフォルダ(--help に出す) */
  defaultDirs: { models: string; icons: string };
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  stdout(text: string): void;
  stderr(text: string): void;
  catalog(source: ModelSource): Promise<CliCatalog>;
  iconImages(source: ModelSource): Promise<ReadonlyMap<string, string>>;
}

/** 使い方の間違い(終了コード 2 で、理由を出す) */
class UsageError extends Error {}

const COMMON_OPTIONS = {
  models: { type: "string" },
  icons: { type: "string" },
  "no-user-models": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const VALIDATE_OPTIONS = {
  ...COMMON_OPTIONS,
  json: { type: "boolean" },
  strict: { type: "boolean" },
} as const;

const RENDER_OPTIONS = {
  ...COMMON_OPTIONS,
  output: { type: "string", short: "o" },
  layer: { type: "string" },
  "long-names": { type: "boolean" },
  "no-if-labels": { type: "boolean" },
  "no-guests": { type: "boolean" },
  "no-groups": { type: "boolean" },
} as const;

export function helpText(deps: Pick<CliDeps, "version" | "defaultDirs">): string {
  return `Constella ${deps.version} — ネットワークトポロジ図の YAML を確かめ、SVG にする

使い方:
  constella validate <ファイル…> [--json] [--strict]
  constella render <ファイル> [-o <出力.svg>] [--layer all|l1|l2|l3] [--long-names]
                   [--no-if-labels] [--no-guests] [--no-groups]

validate  図を確かめ、問題を「ファイル:行:桁: error / warning: メッセージ」の形で出す
  --json             問題を JSON で出す
  --strict           警告があっても、終了コードを 1 にする
render    図を SVG にする(-o を省くと標準出力に出す)
  -o, --output       書き出す SVG のファイル
  --layer            表示レイヤー(all・l1・l2・l3。既定は all)
  --long-names       IF 名を長い形で出す
  --no-if-labels     IF 名ラベルを出さない
  --no-guests        ゲスト(VM・コンテナ)とブリッジを出さない
  --no-groups        グループの枠を出さない

共通のオプション:
  --models <フォルダ>  ユーザーモデルのフォルダ(既定: ${deps.defaultDirs.models})
  --icons <フォルダ>   アイコンの画像のフォルダ(既定: ${deps.defaultDirs.icons})
  --no-user-models    組み込みのモデルだけを使う
  -h, --help          この説明を出す
  -v, --version       版を出す

終了コード: 0 = エラーなし、1 = 図にエラーがある(--strict では警告も)、
            2 = 使い方の間違い・ファイルが読めない
`;
}

export async function runCli(args: readonly string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = args;
  try {
    switch (command) {
      case undefined:
        // コマンドが無いのは使い方の間違い(説明は標準エラー出力に出す)
        deps.stderr(helpText(deps));
        return EXIT.usage;
      case "-h":
      case "--help":
      case "help":
        deps.stdout(helpText(deps));
        return EXIT.ok;
      case "-v":
      case "--version":
        deps.stdout(`${deps.version}\n`);
        return EXIT.ok;
      case "validate": {
        const { values, positionals } = parse(rest, VALIDATE_OPTIONS);
        if (values.help) {
          deps.stdout(helpText(deps));
          return EXIT.ok;
        }
        if (positionals.length === 0) throw new UsageError("確かめるファイルを指定してください");
        return await validate(positionals, values, sourceOf(values), deps);
      }
      case "render": {
        const { values, positionals } = parse(rest, RENDER_OPTIONS);
        if (values.help) {
          deps.stdout(helpText(deps));
          return EXIT.ok;
        }
        if (positionals.length !== 1)
          throw new UsageError("SVG にするファイルを 1 つ指定してください");
        const layer = values.layer ?? "all";
        if (!isLayer(layer)) {
          throw new UsageError(`--layer は ${VIEW_LAYERS.join("・")} のどれかにしてください`);
        }
        return await render(positionals[0], { ...values, layer }, sourceOf(values), deps);
      }
      default:
        throw new UsageError(`知らないコマンドです: ${command}`);
    }
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    deps.stderr(`constella: ${e.message}(constella --help で使い方を出します)\n`);
    return EXIT.usage;
  }
}

/** 引数を読む。知らないオプション・値の無いオプションは UsageError にする */
function parse<T extends typeof VALIDATE_OPTIONS | typeof RENDER_OPTIONS>(
  args: readonly string[],
  options: T,
) {
  try {
    return parseArgs({ args: [...args], options, allowPositionals: true, strict: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Node.js の英語のメッセージから、オプションの名前だけを取り出す
    const option = /'([^']+)'/.exec(message)?.[1];
    const code = e instanceof Error && "code" in e ? e.code : undefined;
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      throw new UsageError(`このコマンドでは使えないオプションです: ${option ?? message}`);
    }
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
      throw new UsageError(`オプションの値がありません: ${option ?? message}`);
    }
    throw new UsageError(message);
  }
}

function sourceOf(values: {
  models?: string;
  icons?: string;
  "no-user-models"?: boolean;
}): ModelSource {
  return { models: values.models, icons: values.icons, userModels: !values["no-user-models"] };
}

const isLayer = (value: string): value is ViewLayer =>
  (VIEW_LAYERS as readonly string[]).includes(value);

/** 位置(行と桁)を付けた問題 */
interface PlacedIssue extends Issue {
  line?: number;
  column?: number;
}

/** 図の問題(アプリの問題パネルと同じ)。位置の順に並べ、位置の無い問題は最後 */
function issuesOf(text: string, parsed: ParseResult, catalog: ModelCatalog): PlacedIssue[] {
  const issues = parsed.ok
    ? [...parsed.issues, ...validateTopology(parsed.topology, catalog, parsed.base)]
    : parsed.issues;
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort(
      (p, q) =>
        (p.issue.range?.start ?? Infinity) - (q.issue.range?.start ?? Infinity) || p.i - q.i,
    )
    .map(({ issue }) =>
      issue.range ? { ...issue, ...lineColumn(text, issue.range.start) } : issue,
    );
}

/** 問題の 1 行(ファイル:行:桁: error: メッセージ。位置が無ければ ファイル: error: メッセージ) */
function issueLine(file: string, issue: PlacedIssue): string {
  const at = issue.line === undefined ? file : `${file}:${issue.line}:${issue.column}`;
  return `${at}: ${issue.severity}: ${issue.message}\n`;
}

/** 読めなかったユーザーモデルを知らせる(図は組み込みのモデルとほかのユーザーモデルで確かめる) */
function reportModelProblems({ problems }: CliCatalog, deps: CliDeps): void {
  for (const problem of problems) {
    deps.stderr(`constella: 読めないユーザーモデルは使いません: ${problem}\n`);
  }
}

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function validate(
  files: readonly string[],
  options: { json?: boolean; strict?: boolean },
  source: ModelSource,
  deps: CliDeps,
): Promise<number> {
  const models = await deps.catalog(source);
  reportModelProblems(models, deps);
  const results: { file: string; issues?: PlacedIssue[]; error?: string }[] = [];
  for (const file of files) {
    try {
      const text = await deps.readText(file);
      const parsed = parseTopology(text, { catalog: models.catalog });
      results.push({ file, issues: issuesOf(text, parsed, models.catalog) });
    } catch (e) {
      results.push({ file, error: `ファイルを読めません: ${reason(e)}` });
    }
  }
  const all = results.flatMap((r) => r.issues ?? []);
  const errors = all.filter((i) => i.severity === "error").length;
  const warnings = all.length - errors;

  if (options.json) {
    const json = {
      files: results.map(({ file, issues, error }) =>
        error !== undefined
          ? { file, error }
          : {
              file,
              issues: (issues ?? []).map(({ severity, code, message, line, column }) => ({
                severity,
                code,
                message,
                ...(line === undefined ? {} : { line, column }),
              })),
            },
      ),
      errors,
      warnings,
    };
    deps.stdout(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    for (const { file, issues, error } of results) {
      if (error !== undefined) deps.stderr(`constella: ${file}: ${error}\n`);
      for (const issue of issues ?? []) deps.stdout(issueLine(file, issue));
    }
    deps.stdout(`${files.length} ファイル: エラー ${errors} 件、警告 ${warnings} 件\n`);
  }
  if (results.some((r) => r.error !== undefined)) return EXIT.usage;
  return errors > 0 || (options.strict && warnings > 0) ? EXIT.problems : EXIT.ok;
}

async function render(
  file: string,
  options: {
    output?: string;
    layer: ViewLayer;
    "long-names"?: boolean;
    "no-if-labels"?: boolean;
    "no-guests"?: boolean;
    "no-groups"?: boolean;
  },
  source: ModelSource,
  deps: CliDeps,
): Promise<number> {
  let text: string;
  try {
    text = await deps.readText(file);
  } catch (e) {
    deps.stderr(`constella: ${file}: ファイルを読めません: ${reason(e)}\n`);
    return EXIT.usage;
  }
  const models = await deps.catalog(source);
  reportModelProblems(models, deps);
  const { catalog } = models;
  const parsed = parseTopology(text, { catalog });
  const issues = issuesOf(text, parsed, catalog);
  if (!parsed.ok) {
    for (const issue of issues) deps.stderr(issueLine(file, issue));
    deps.stderr(`constella: ${file} は YAML として読めないので、SVG にできません\n`);
    return EXIT.problems;
  }
  // 図にエラーがあっても描く(アプリと同じ)。知らせるだけ
  const errors = issues.filter((i) => i.severity === "error").length;
  if (errors > 0) {
    deps.stderr(
      `constella: ${file} にはエラーが ${errors} 件あります(constella validate で確かめられます)\n`,
    );
  }

  // 座標の無いデバイスとブリッジは、アプリで開いたときと同じく自動で並べる(SPEC 9 章)
  const t = parsed.topology;
  const missing = [...t.devices.keys(), ...allBridges(t).map((b) => b.key)].filter(
    (id) => !t.layout.has(id),
  );
  const fallbackPositions =
    missing.length > 0
      ? await placeMissing(t, catalog, missing, (id) => t.layout.get(id))
      : undefined;
  const layer = LAYER_PRESETS[options.layer];
  const { svg } = renderSvg(t, catalog, {
    ...layer,
    showIfLabels: layer.showIfLabels && !options["no-if-labels"],
    showGuests: layer.showGuests && !options["no-guests"],
    showGroups: layer.showGroups && !options["no-groups"],
    longIfNames: options["long-names"] ?? false,
    fallbackPositions,
    iconImages: await deps.iconImages(source),
  });
  if (options.output === undefined) {
    deps.stdout(svg);
    return EXIT.ok;
  }
  try {
    await deps.writeText(options.output, svg);
  } catch (e) {
    deps.stderr(`constella: ${options.output} に書き出せません: ${reason(e)}\n`);
    return EXIT.usage;
  }
  return EXIT.ok;
}
