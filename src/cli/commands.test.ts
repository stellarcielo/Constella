import { describe, expect, it } from "vitest";
import { cliCatalog } from "./catalog";
import { type CliDeps, EXIT, helpText, type ModelSource, runCli } from "./commands";

const good = `constella: 1
devices:
  r1: { model: generic-router-4 }
  s1: { model: generic-l2switch-24 }
links:
  - { a: r1:Gi0/0, b: s1:Gi0/1 }
layout:
  r1: { x: 0, y: 0 }
  s1: { x: 0, y: 200 }
`;

/** 3 行目にエラー(存在しないデバイス)、4 行目に警告(ポート種別の不一致) */
const bad = `constella: 1
devices: { r1: { model: generic-router-4 }, s1: { model: generic-l2switch-24 } }
links:
  - { a: r1:Gi0/0, b: sw9:Gi0/1 }
  - { a: r1:Gi0/1, b: s1:Te0/25 }
`;

const warnOnly = `constella: 1
devices: { r1: { model: generic-router-4 }, s1: { model: generic-l2switch-24 } }
links:
  - { a: r1:Gi0/1, b: s1:Te0/25 }
`;

/** 座標が無く、直角の線の図 */
const noLayout = `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-l2switch-24 }
  pc1: { model: generic-pc }
links:
  - { a: rt1:Gi0/0, b: sw1:Gi0/24 }
  - { a: sw1:Gi0/1, b: pc1:eth0 }
layout:
  _routing: orthogonal
`;

function setup(files: Record<string, string>, userModels: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const sources: ModelSource[] = [];
  const deps: CliDeps = {
    version: "9.9.9",
    defaultDirs: { models: "/data/Constella/models", icons: "/data/Constella/icons" },
    readText: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    writeText: async (path, text) => void written.set(path, text),
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    catalog: async (source) => {
      sources.push(source);
      const user = source.userModels ? Object.entries(userModels) : [];
      return cliCatalog(user.map(([file, text]) => ({ file, text })));
    },
    iconImages: async () => new Map(),
  };
  return {
    deps,
    run: (...args: string[]) => runCli(args, deps),
    out: () => out.join(""),
    err: () => err.join(""),
    written,
    sources,
  };
}

describe("constella validate(SPEC 11 章)", () => {
  it("問題が無ければ終了コード 0 で、件数だけを出す", async () => {
    const cli = setup({ "a.yaml": good, "b.yaml": good });
    expect(await cli.run("validate", "a.yaml", "b.yaml")).toBe(EXIT.ok);
    expect(cli.out()).toBe("2 ファイル: エラー 0 件、警告 0 件\n");
  });

  it("問題を「ファイル:行:桁: error / warning: メッセージ」で位置の順に出し、エラーがあれば 1", async () => {
    const cli = setup({ "bad.yaml": bad });
    expect(await cli.run("validate", "bad.yaml")).toBe(EXIT.problems);
    const lines = cli.out().trimEnd().split("\n");
    expect(lines[0]).toMatch(/^bad\.yaml:4:\d+: error: デバイス「sw9」は存在しません$/);
    expect(lines[1]).toMatch(/^bad\.yaml:5:\d+: warning: ポート種別が合いません/);
    expect(lines[2]).toBe("1 ファイル: エラー 1 件、警告 1 件");
  });

  it("警告だけなら 0。--strict では 1", async () => {
    const cli = setup({ "w.yaml": warnOnly });
    expect(await cli.run("validate", "w.yaml")).toBe(EXIT.ok);
    expect(await cli.run("validate", "--strict", "w.yaml")).toBe(EXIT.problems);
  });

  it("YAML として読めなければ、その位置をエラーとして出す", async () => {
    const cli = setup({ "x.yaml": "constella: 1\ndevices: [\n" });
    expect(await cli.run("validate", "x.yaml")).toBe(EXIT.problems);
    expect(cli.out()).toMatch(/^x\.yaml:\d+:\d+: error: /);
  });

  it("読めないファイルは標準エラー出力に出し、ほかのファイルは確かめて、終了コード 2", async () => {
    const cli = setup({ "a.yaml": good });
    expect(await cli.run("validate", "a.yaml", "nope.yaml")).toBe(EXIT.usage);
    expect(cli.err()).toContain("constella: nope.yaml: ファイルを読めません: ENOENT: nope.yaml");
    expect(cli.out()).toBe("2 ファイル: エラー 0 件、警告 0 件\n");
  });

  it("--json で、ファイルごとの問題(位置つき)と件数を出す", async () => {
    const cli = setup({ "bad.yaml": bad });
    expect(await cli.run("validate", "--json", "bad.yaml", "nope.yaml")).toBe(EXIT.usage);
    const json = JSON.parse(cli.out()) as {
      files: { file: string; issues?: { severity: string; code: string; line?: number }[] }[];
      errors: number;
      warnings: number;
    };
    expect(json.errors).toBe(1);
    expect(json.warnings).toBe(1);
    expect(json.files[0].issues?.map((i) => [i.severity, i.line])).toEqual([
      ["error", 4],
      ["warning", 5],
    ]);
    expect(json.files[1]).toEqual({
      file: "nope.yaml",
      error: "ファイルを読めません: ENOENT: nope.yaml",
    });
  });

  it("ユーザーモデルも使い、読めないユーザーモデルは知らせて使わない。--no-user-models で組み込みだけ", async () => {
    const mine = "id: my-sw\nrole: l2switch\nports:\n  - { name: 'p{1-4}', type: rj45 }\n";
    const text = `constella: 1
devices: { s1: { model: my-sw } }
links: []
`;
    const cli = setup({ "m.yaml": text }, { "my-sw.yaml": mine, "broken.yaml": "role: pc\n" });
    expect(await cli.run("validate", "m.yaml")).toBe(EXIT.ok);
    expect(cli.err()).toContain("constella: 読めないユーザーモデルは使いません: broken.yaml:");
    expect(await cli.run("validate", "--no-user-models", "--models", "/x", "m.yaml")).toBe(
      EXIT.problems,
    );
    expect(cli.sources[cli.sources.length - 1]).toEqual({
      models: "/x",
      icons: undefined,
      userModels: false,
    });
  });
});

describe("constella render(SPEC 11 章)", () => {
  it("-o のファイルに SVG を書き、省けば標準出力に出す", async () => {
    const cli = setup({ "a.yaml": good });
    expect(await cli.run("render", "a.yaml", "-o", "a.svg")).toBe(EXIT.ok);
    expect(cli.written.get("a.svg")).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(cli.out()).toBe("");
    expect(await cli.run("render", "a.yaml")).toBe(EXIT.ok);
    expect(cli.out()).toBe(cli.written.get("a.svg"));
  });

  it("座標の無い機器は自動で並べ、直角の線の図は直角の線で描く", async () => {
    const cli = setup({ "n.yaml": noLayout });
    expect(await cli.run("render", "n.yaml")).toBe(EXIT.ok);
    const svg = cli.out();
    for (const name of ["rt1", "sw1", "pc1"]) expect(svg).toContain(`>${name}</text>`);
    // 縦 → 横 → 縦、またはまっすぐな縦の線(どの線も、縦か横の区間だけ)
    const paths = [...svg.matchAll(/<path d="(M [^"]+)" fill="none" stroke-width="2"/g)].map(
      (m) => m[1],
    );
    expect(paths).toHaveLength(2);
    for (const d of paths) {
      const points = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
      for (let i = 1; i < points.length; i++) {
        const [x0, y0] = points[i - 1];
        const [x1, y1] = points[i];
        expect(x0 === x1 || y0 === y1).toBe(true);
      }
    }
  });

  it("表示レイヤーと表示のオプションに従う", async () => {
    const text = good.replace(
      "  s1: { model: generic-l2switch-24 }",
      "  s1:\n    model: generic-l2switch-24\n    interfaces: { Gi0/1: { mode: access, vlan: 10 } }",
    );
    const cli = setup({ "v.yaml": text });
    await cli.run("render", "v.yaml", "-o", "all.svg");
    await cli.run("render", "v.yaml", "--layer", "l3", "-o", "l3.svg");
    await cli.run("render", "v.yaml", "--no-if-labels", "-o", "plain.svg");
    await cli.run("render", "v.yaml", "--long-names", "-o", "long.svg");
    expect(cli.written.get("all.svg")).toContain(">VLAN 10</text>");
    expect(cli.written.get("l3.svg")).not.toContain(">VLAN 10</text>");
    expect(cli.written.get("plain.svg")).not.toContain(">Gi0/0</text>");
    expect(cli.written.get("long.svg")).toContain(">GigabitEthernet0/0</text>");
  });

  it("図にエラーがあっても描いて知らせる。YAML として読めなければ 1", async () => {
    const cli = setup({ "bad.yaml": bad, "x.yaml": "constella: 1\ndevices: [\n" });
    expect(await cli.run("render", "bad.yaml", "-o", "b.svg")).toBe(EXIT.ok);
    expect(cli.err()).toContain("bad.yaml にはエラーが 1 件あります");
    expect(cli.written.has("b.svg")).toBe(true);
    expect(await cli.run("render", "x.yaml", "-o", "x.svg")).toBe(EXIT.problems);
    expect(cli.err()).toContain("x.yaml は YAML として読めないので、SVG にできません");
    expect(cli.written.has("x.svg")).toBe(false);
  });
});

describe("使い方", () => {
  it("--help・--version", async () => {
    const cli = setup({});
    expect(await cli.run("--version")).toBe(EXIT.ok);
    expect(cli.out()).toBe("9.9.9\n");
    expect(await cli.run("--help")).toBe(EXIT.ok);
    expect(cli.out()).toContain(helpText(cli.deps));
    expect(helpText(cli.deps)).toContain("既定: /data/Constella/models");
  });

  it("コマンドが無い・知らないコマンド・使えないオプション・ファイルが無いときは 2", async () => {
    const cli = setup({ "a.yaml": good });
    expect(await cli.run()).toBe(EXIT.usage);
    expect(cli.err()).toContain("使い方:");
    expect(await cli.run("draw", "a.yaml")).toBe(EXIT.usage);
    expect(cli.err()).toContain("知らないコマンドです: draw");
    expect(await cli.run("render", "a.yaml", "--json")).toBe(EXIT.usage);
    expect(cli.err()).toContain("このコマンドでは使えないオプションです: --json");
    expect(await cli.run("render", "a.yaml", "-o")).toBe(EXIT.usage);
    expect(cli.err()).toContain("オプションの値がありません");
    expect(await cli.run("render", "a.yaml", "--layer", "l9")).toBe(EXIT.usage);
    expect(await cli.run("validate")).toBe(EXIT.usage);
    expect(await cli.run("render")).toBe(EXIT.usage);
  });
});
