// MCP サーバー(SPEC 11 章)。AI アシスタントが図を確かめ、SVG にし、モデルと書き方を調べるための
// ツールとリソース。図の YAML は書き換えない。render が書くのは .svg のファイルだけ。
// ユーザーモデルはツールを使うたびに読み直す(サーバーを動かしたまま、アプリでモデルを足せるように)。

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import schemaText from "../../schema/constella.schema.json?raw";
import { VIEW_LAYERS } from "../core";
import type { CliCatalog } from "./catalog";
import type { CliDeps, ModelSource } from "./commands";
import { checkDiagram, diagramSvg, issueLine } from "./diagram";

export type McpDeps = Pick<
  CliDeps,
  "version" | "readText" | "writeText" | "catalog" | "iconImages"
>;

const exampleFiles = import.meta.glob<string>("../../examples/*.constella.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** examples の図(名前 → YAML)。名前はファイル名から .constella.yaml を除いたもの */
export const EXAMPLES: ReadonlyMap<string, string> = new Map(
  Object.entries(exampleFiles)
    .map(
      ([path, text]) => [path.replace(/^.*\//, "").replace(".constella.yaml", ""), text] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b)),
);

/** 例の説明(先頭のコメントのうち、スキーマを指す行の次の 1 行) */
function exampleSummary(text: string): string {
  const line = text
    .split("\n")
    .find((l) => l.startsWith("# ") && !l.includes("yaml-language-server"));
  return line?.slice(2) ?? "";
}

const INSTRUCTIONS = `Constella(ネットワークトポロジ図のアプリ)の図の YAML を確かめ、SVG にするサーバーです。
- 図を書く前に、get_schema で書き方を、get_example で例を、list_models・get_model で使えるモデルと IF 名を調べてください。
- 書いた図は validate で確かめ、エラーが無くなるまで直してください(警告は残ってもかまいません)。
- render で SVG にできます。座標(layout)の無い機器は、アプリで開いたときと同じく自動で並べます。
- 図は yaml(YAML の文字列)か path(ファイルのパス)で渡します。このサーバーは図の YAML を書き換えません。`;

const diagramInput = {
  yaml: z.string().optional().describe("図の YAML(文字列)。path とどちらか一方を渡す"),
  path: z
    .string()
    .optional()
    .describe(
      "図の YAML のファイルのパス。yaml とどちらか一方を渡す。相対パスはサーバーの作業フォルダから(絶対パスを推奨)",
    ),
};

/** 図の YAML と、問題の行の先頭に付ける名前(ファイルのパス。文字列で渡されたら yaml) */
async function readDiagram(
  { yaml, path }: { yaml?: string; path?: string },
  deps: McpDeps,
): Promise<{ text: string; label: string }> {
  if ((yaml === undefined) === (path === undefined)) {
    throw new Error("yaml(YAML の文字列)か path(ファイルのパス)の、どちらか一方を渡してください");
  }
  if (yaml !== undefined) return { text: yaml, label: "yaml" };
  try {
    return { text: await deps.readText(path ?? ""), label: path ?? "" };
  } catch (e) {
    throw new Error(
      `${path}: ファイルを読めません: ${e instanceof Error ? e.message : String(e)}`,
      {
        cause: e,
      },
    );
  }
}

/** 読めなかったユーザーモデルのお知らせ(図は組み込みのモデルとほかのユーザーモデルで確かめる) */
const modelNotes = ({ problems }: CliCatalog) =>
  problems.map((problem) => `読めないユーザーモデルは使いません: ${problem}`);

/** ツールの結果。お知らせ(notes)があれば、本文(body)の前に別の項目で出す */
function result(notes: readonly string[], body: string): CallToolResult {
  return {
    content: [
      ...(notes.length > 0 ? [{ type: "text" as const, text: notes.join("\n") }] : []),
      { type: "text", text: body },
    ],
  };
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export function createMcpServer(deps: McpDeps, source: ModelSource): McpServer {
  const server = new McpServer(
    { name: "constella", title: "Constella", version: deps.version },
    { instructions: INSTRUCTIONS },
  );
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "validate",
    {
      title: "図を確かめる",
      description:
        "Constella の図(YAML)を、アプリの問題パネルと同じように確かめる。問題を「名前:行:桁: error|warning: メッセージ」の形で位置の順に返し、最後に件数を返す。エラーが 0 件なら、アプリで開ける図",
      inputSchema: diagramInput,
      annotations: readOnly,
    },
    async (args) => {
      const { text, label } = await readDiagram(args, deps);
      const models = await deps.catalog(source);
      const { issues, errors, warnings } = checkDiagram(text, models.catalog);
      const lines = issues.map((issue) => issueLine(label, issue));
      return result(
        modelNotes(models),
        [...lines, `エラー ${errors} 件、警告 ${warnings} 件`].join("\n"),
      );
    },
  );

  server.registerTool(
    "render",
    {
      title: "図を SVG にする",
      description:
        "Constella の図(YAML)を、アプリの書き出しと同じ SVG にする。output を渡すとそのファイルに書き、省くと SVG の文字列を返す。座標(layout)の無い機器は自動で並べる。図にエラーがあっても描く(YAML として読めないときは描かない)",
      inputSchema: {
        ...diagramInput,
        output: z
          .string()
          .optional()
          .describe(
            "書き出す SVG のファイルのパス(拡張子は .svg)。同じ名前のファイルがあれば上書きする。相対パスはサーバーの作業フォルダから",
          ),
        layer: z
          .enum(VIEW_LAYERS)
          .optional()
          .describe(
            "表示レイヤー。all = すべて(既定)、l1 = 物理(IF 名・トランシーバ、拠点・ラックの枠。ゲストは出さない)、l2 = VLAN、l3 = IP",
          ),
        longIfNames: z
          .boolean()
          .optional()
          .describe("IF 名を長い形(GigabitEthernet0/1 など)で出す。既定は false"),
        showIfLabels: z.boolean().optional().describe("IF 名ラベルを出す。既定は true"),
        showGuests: z
          .boolean()
          .optional()
          .describe("ゲスト(VM・コンテナ)とブリッジを出す。既定は true"),
        showGroups: z.boolean().optional().describe("グループの枠を出す。既定は true"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const { output } = args;
      if (output !== undefined && !/\.svg$/i.test(output)) {
        throw new Error(`output は .svg のファイルにしてください: ${output}`);
      }
      const { text, label } = await readDiagram(args, deps);
      const models = await deps.catalog(source);
      const { parsed, issues, errors } = checkDiagram(text, models.catalog);
      const notes = modelNotes(models);
      if (!parsed.ok) {
        const lines = issues.map((issue) => issueLine(label, issue));
        throw new Error(
          [...notes, ...lines, "YAML として読めないので、SVG にできません"].join("\n"),
        );
      }
      if (errors > 0) notes.push(`図にエラーが ${errors} 件あります(validate で確かめられます)`);
      const { svg, width, height } = await diagramSvg(parsed.topology, models.catalog, {
        layer: args.layer ?? "all",
        longIfNames: args.longIfNames ?? false,
        showIfLabels: args.showIfLabels ?? true,
        showGuests: args.showGuests ?? true,
        showGroups: args.showGroups ?? true,
        iconImages: await deps.iconImages(source),
      });
      if (output === undefined) return result(notes, svg);
      try {
        await deps.writeText(output, svg);
      } catch (e) {
        throw new Error(
          `${output} に書き出せません: ${e instanceof Error ? e.message : String(e)}`,
          { cause: e },
        );
      }
      return result(notes, `SVG を書き出しました: ${output}(${width} × ${height})`);
    },
  );

  server.registerTool(
    "list_models",
    {
      title: "モデルの一覧",
      description:
        "使えるモデル(組み込みとユーザーモデル)の一覧を JSON で返す。devices の model には id を書く。ports はポートの数、flexible が true なら定義に無い IF 名も使える、guest は VM・コンテナのモデル。ポートの名前は get_model で調べる",
      annotations: readOnly,
    },
    async () => {
      const models = await deps.catalog(source);
      const list = [...models.catalog.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(({ id, vendor, name, role, ports, flexible, guest }) => ({
          id,
          vendor,
          name,
          role,
          ports: ports.length,
          flexible,
          guest,
        }));
      return result(modelNotes(models), json(list));
    },
  );

  server.registerTool(
    "get_model",
    {
      title: "モデルのポート",
      description:
        "モデルの役割とポート(IF 名・種別・速度)を JSON で返す。links の a・b は「デバイスID:IF 名」で書き、IF 名は短い形(Gi0/1)でも長い形(GigabitEthernet0/1)でもよい",
      inputSchema: { id: z.string().describe("モデルの ID(list_models の id)") },
      annotations: readOnly,
    },
    async ({ id }) => {
      const models = await deps.catalog(source);
      const model = models.catalog.get(id);
      if (!model)
        throw new Error(`モデル「${id}」はありません(list_models で一覧を確かめられます)`);
      return result(modelNotes(models), json(model));
    },
  );

  server.registerTool(
    "get_schema",
    {
      title: "図の書き方(JSON Schema)",
      description:
        "Constella の図の YAML の書き方を、JSON Schema で返す(constella://schema のリソースと同じ)",
      annotations: readOnly,
    },
    async () => result([], schemaText),
  );

  server.registerTool(
    "get_example",
    {
      title: "図の例",
      description: `examples の図の YAML を返す(constella://examples/<名前> のリソースと同じ)。name を省くと、例の名前と説明の一覧を返す`,
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(`例の名前(${[...EXAMPLES.keys()].join("・")})`),
      },
      annotations: readOnly,
    },
    async ({ name }) => {
      if (name === undefined) {
        return result(
          [],
          [...EXAMPLES].map(([n, text]) => `${n}: ${exampleSummary(text)}`).join("\n"),
        );
      }
      const text = EXAMPLES.get(name);
      if (text === undefined) {
        throw new Error(`例「${name}」はありません(name を省くと一覧を返します)`);
      }
      return result([], text);
    },
  );

  server.registerResource(
    "schema",
    "constella://schema",
    {
      title: "図の書き方(JSON Schema)",
      description: "Constella の図の YAML の JSON Schema",
      mimeType: "application/schema+json",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/schema+json", text: schemaText }],
    }),
  );

  server.registerResource(
    "example",
    new ResourceTemplate("constella://examples/{name}", {
      list: () => ({
        resources: [...EXAMPLES].map(([name, text]) => ({
          uri: `constella://examples/${name}`,
          name,
          description: exampleSummary(text),
          mimeType: "application/yaml",
        })),
      }),
    }),
    { title: "図の例", mimeType: "application/yaml" },
    (uri, { name }) => {
      const text = EXAMPLES.get(String(name));
      if (text === undefined) throw new Error(`例「${String(name)}」はありません`);
      return { contents: [{ uri: uri.href, mimeType: "application/yaml", text }] };
    },
  );

  return server;
}
