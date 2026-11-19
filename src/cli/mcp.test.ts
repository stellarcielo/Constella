import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { cliCatalog } from "./catalog";
import { createMcpServer, EXAMPLES, type McpDeps } from "./mcp";

const good = `constella: 1
devices:
  r1: { model: generic-router-4 }
  s1:
    model: generic-l2switch-24
    interfaces: { Gi0/1: { mode: access, vlan: 10 } }
links:
  - { a: r1:Gi0/0, b: s1:Gi0/1 }
`;

/** 4 行目にエラー(存在しないデバイス)、5 行目に警告(ポート種別の不一致) */
const bad = `constella: 1
devices: { r1: { model: generic-router-4 }, s1: { model: generic-l2switch-24 } }
links:
  - { a: r1:Gi0/0, b: sw9:Gi0/1 }
  - { a: r1:Gi0/1, b: s1:Te0/25 }
`;

const broken = "constella: 1\ndevices: [\n";

const mine = "id: my-sw\nrole: l2switch\nports:\n  - { name: 'p{1-4}', type: rj45 }\n";

async function connect(files: Record<string, string>, userModels: Record<string, string> = {}) {
  const written = new Map<string, string>();
  const deps: McpDeps = {
    version: "9.9.9",
    readText: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    writeText: async (path, text) => void written.set(path, text),
    catalog: async (source) =>
      cliCatalog(
        source.userModels ? Object.entries(userModels).map(([file, text]) => ({ file, text })) : [],
      ),
    iconImages: async () => new Map(),
  };
  const server = createMcpServer(deps, { userModels: true });
  const client = new Client({ name: "test", version: "0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  /** ツールを呼び、エラーかどうかと、文字列の項目を返す */
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
    return {
      error: result.isError === true,
      texts: result.content.map((c) => (c.type === "text" ? c.text : "")),
    };
  };
  return { client, call, written };
}

describe("MCP サーバー(SPEC 11 章)", () => {
  it("名前・版・使い方の説明と、6 つのツールを出す", async () => {
    const { client } = await connect({});
    expect(client.getServerVersion()).toMatchObject({ name: "constella", version: "9.9.9" });
    expect(client.getInstructions()).toContain("validate");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "validate",
      "render",
      "list_models",
      "get_model",
      "get_schema",
      "get_example",
    ]);
    const hints = new Map(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    expect(hints.get("validate")).toBe(true);
    expect(hints.get("render")).toBe(false);
  });
});

describe("validate", () => {
  it("YAML の文字列でもファイルのパスでも確かめ、問題を位置の順に、最後に件数を返す", async () => {
    const { call } = await connect({ "bad.yaml": bad, "good.yaml": good });
    const byText = await call("validate", { yaml: bad });
    expect(byText.error).toBe(false);
    const lines = byText.texts[0].split("\n");
    expect(lines[0]).toMatch(/^yaml:4:\d+: error: デバイス「sw9」は存在しません$/);
    expect(lines[1]).toMatch(/^yaml:5:\d+: warning: ポート種別が合いません/);
    expect(lines[2]).toBe("エラー 1 件、警告 1 件");
    expect((await call("validate", { path: "bad.yaml" })).texts[0]).toMatch(/^bad\.yaml:4:/);
    expect((await call("validate", { path: "good.yaml" })).texts).toEqual([
      "エラー 0 件、警告 0 件",
    ]);
  });

  it("yaml と path は、どちらか一方だけ。読めないファイルはエラー", async () => {
    const { call } = await connect({ "good.yaml": good });
    for (const args of [{}, { yaml: good, path: "good.yaml" }]) {
      const r = await call("validate", args);
      expect(r.error).toBe(true);
      expect(r.texts[0]).toContain("どちらか一方を渡してください");
    }
    const missing = await call("validate", { path: "nope.yaml" });
    expect(missing.error).toBe(true);
    expect(missing.texts[0]).toBe("nope.yaml: ファイルを読めません: ENOENT: nope.yaml");
  });

  it("ユーザーモデルも使い、読めないユーザーモデルは別の項目で知らせる", async () => {
    const { call } = await connect({}, { "my-sw.yaml": mine, "broken.yaml": "role: pc\n" });
    const r = await call("validate", {
      yaml: "constella: 1\ndevices: { s1: { model: my-sw } }\nlinks: []\n",
    });
    expect(r.texts[0]).toMatch(/^読めないユーザーモデルは使いません: broken\.yaml: /);
    expect(r.texts[1]).toBe("エラー 0 件、警告 0 件");
  });
});

describe("render", () => {
  it("output を省くと SVG を返し、渡すとそのファイルに書く", async () => {
    const { call, written } = await connect({ "good.yaml": good });
    const r = await call("render", { path: "good.yaml" });
    expect(r.error).toBe(false);
    expect(r.texts).toHaveLength(1);
    expect(r.texts[0]).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    // 座標が無くても自動で並べて描く
    for (const name of ["r1", "s1"]) expect(r.texts[0]).toContain(`>${name}</text>`);

    const saved = await call("render", { yaml: good, output: "/out/net.svg" });
    expect(saved.texts[0]).toMatch(/^SVG を書き出しました: \/out\/net\.svg\(\d+ × \d+\)$/);
    expect(written.get("/out/net.svg")).toBe(r.texts[0]);
  });

  it("表示レイヤーと表示のオプションに従う", async () => {
    const { call } = await connect({});
    const svg = async (args: Record<string, unknown>) =>
      (await call("render", { yaml: good, ...args })).texts[0];
    expect(await svg({})).toContain(">VLAN 10</text>");
    expect(await svg({ layer: "l3" })).not.toContain(">VLAN 10</text>");
    expect(await svg({ showIfLabels: false })).not.toContain(">Gi0/0</text>");
    expect(await svg({ longIfNames: true })).toContain(">GigabitEthernet0/0</text>");
    const wrong = await call("render", { yaml: good, layer: "l9" });
    expect(wrong.error).toBe(true);
  });

  it("書くのは .svg のファイルだけ", async () => {
    const { call, written } = await connect({});
    const r = await call("render", { yaml: good, output: "notes.txt" });
    expect(r.error).toBe(true);
    expect(r.texts[0]).toBe("output は .svg のファイルにしてください: notes.txt");
    expect(written.size).toBe(0);
  });

  it("図にエラーがあっても描いて知らせる。YAML として読めなければ描かない", async () => {
    const { call, written } = await connect({});
    const r = await call("render", { yaml: bad, output: "bad.svg" });
    expect(r.error).toBe(false);
    expect(r.texts[0]).toBe("図にエラーが 1 件あります(validate で確かめられます)");
    expect(written.has("bad.svg")).toBe(true);
    const unreadable = await call("render", { yaml: broken, output: "x.svg" });
    expect(unreadable.error).toBe(true);
    expect(unreadable.texts[0]).toMatch(/^yaml:\d+:\d+: error: /);
    expect(unreadable.texts[0]).toContain("YAML として読めないので、SVG にできません");
    expect(written.has("x.svg")).toBe(false);
  });
});

describe("モデル・書き方・例", () => {
  it("list_models は組み込みとユーザーモデルを、get_model はポートを返す", async () => {
    const { call } = await connect({}, { "my-sw.yaml": mine });
    const list = JSON.parse((await call("list_models")).texts[0]) as {
      id: string;
      role: string;
      ports: number;
    }[];
    expect(list.find((m) => m.id === "generic-router-4")).toMatchObject({
      role: "router",
      ports: 4,
    });
    expect(list.find((m) => m.id === "my-sw")).toMatchObject({ role: "l2switch", ports: 4 });

    const model = JSON.parse((await call("get_model", { id: "my-sw" })).texts[0]) as {
      ports: { name: string; type: string }[];
    };
    expect(model.ports.map((p) => p.name)).toEqual(["p1", "p2", "p3", "p4"]);
    const missing = await call("get_model", { id: "nope" });
    expect(missing.error).toBe(true);
    expect(missing.texts[0]).toContain("モデル「nope」はありません");
  });

  it("get_schema は JSON Schema を、get_example は例の一覧と YAML を返す", async () => {
    const { call } = await connect({});
    const schema = JSON.parse((await call("get_schema")).texts[0]) as { $schema: string };
    expect(schema.$schema).toContain("json-schema.org");
    expect([...EXAMPLES.keys()]).toEqual(["proxmox", "redundant-lag", "small-lab", "two-tier"]);
    const index = (await call("get_example")).texts[0].split("\n");
    expect(index).toHaveLength(4);
    expect(index[2]).toMatch(/^small-lab: 小規模ラボ/);
    expect((await call("get_example", { name: "small-lab" })).texts[0]).toBe(
      EXAMPLES.get("small-lab"),
    );
    expect((await call("get_example", { name: "nope" })).error).toBe(true);
  });

  it("書き方と例を、リソースとしても出す", async () => {
    const { client, call } = await connect({});
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "constella://schema",
      "constella://examples/proxmox",
      "constella://examples/redundant-lag",
      "constella://examples/small-lab",
      "constella://examples/two-tier",
    ]);
    const schema = await client.readResource({ uri: "constella://schema" });
    expect(schema.contents[0]).toMatchObject({
      mimeType: "application/schema+json",
      text: (await call("get_schema")).texts[0],
    });
    const example = await client.readResource({ uri: "constella://examples/two-tier" });
    expect(example.contents[0]).toMatchObject({
      mimeType: "application/yaml",
      text: EXAMPLES.get("two-tier"),
    });
    await expect(client.readResource({ uri: "constella://examples/nope" })).rejects.toThrow();
  });
});
