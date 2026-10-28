import { describe, expect, it, vi } from "vitest";
import { specExample, testCatalog } from "../core/testFixtures";
import { createTopologyStore } from "../store/topologyStore";
import { createExportCommands, exportFileName, PNG_SCALE } from "./export";

function setup(choose: string | null = "/tmp/out.svg") {
  const store = createTopologyStore(testCatalog);
  store.getState().openText(specExample, "/docs/lab.constella.yaml");
  const written: { path: string; data: string | Uint8Array }[] = [];
  const view = { showIfLabels: true, longIfNames: false };
  const deps = {
    platform: {
      chooseExportPath: vi.fn(async () => choose),
      writeTextFile: vi.fn(async (path: string, text: string) => {
        written.push({ path, data: text });
      }),
      writeBinaryFile: vi.fn(async (path: string, data: Uint8Array<ArrayBuffer>) => {
        written.push({ path, data });
      }),
    },
    store,
    view: () => view,
    rasterize: vi.fn(async () => new Uint8Array([1, 2, 3])),
    showError: vi.fn(async () => {}),
  };
  return { store, deps, written, view, commands: createExportCommands(deps) };
}

const placed = (env: ReturnType<typeof setup>) =>
  vi.waitFor(() => expect(env.store.getState().placing).toBe(false));

describe("exportFileName", () => {
  it("保存済みならファイル名の拡張子を替え、無ければタイトルから作る", () => {
    expect(exportFileName("svg", "x", "/a/lab.constella.yaml")).toBe("lab.svg");
    expect(exportFileName("png", "x", "/a/net.yml")).toBe("net.png");
    expect(exportFileName("svg", "自宅/ラボ")).toBe("自宅_ラボ.svg");
    expect(exportFileName("png")).toBe("無題.png");
  });
});

describe("exportImage", () => {
  it("SVG を、自動配置したデバイスも含めて書き出す", async () => {
    const env = setup();
    await placed(env);
    expect(await env.commands.exportImage("svg")).toBe(true);
    expect(env.deps.platform.chooseExportPath).toHaveBeenCalledWith("lab.svg", "svg");
    const svg = String(env.written[0]?.data);
    expect(env.written[0]?.path).toBe("/tmp/out.svg");
    expect(svg).toContain(">Edge Router</text>");
    // srv1 と isp は layout に座標が無い(自動配置の位置で描く)
    expect(svg).toContain(">srv1</text>");
    expect(svg).toContain(">isp</text>");
  });

  it("IF 名の表示設定を反映する", async () => {
    const env = setup();
    env.view.longIfNames = true;
    await env.commands.exportImage("svg");
    expect(String(env.written[0]?.data)).toContain("GigabitEthernet0/1");
  });

  it("PNG は SVG を 2 倍で画像にして書き出す", async () => {
    const env = setup("/tmp/out.png");
    expect(await env.commands.exportImage("png")).toBe(true);
    const [svg, width, height, scale] = env.deps.rasterize.mock.calls[0] as unknown as [
      string,
      number,
      number,
      number,
    ];
    expect(svg).toContain("<svg");
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(scale).toBe(PNG_SCALE);
    expect(env.written[0]).toEqual({ path: "/tmp/out.png", data: new Uint8Array([1, 2, 3]) });
  });

  it("キャンセルなら何もしない", async () => {
    const env = setup(null);
    expect(await env.commands.exportImage("svg")).toBe(false);
    expect(env.written).toEqual([]);
  });

  it("書き込めなければエラーを出す", async () => {
    const env = setup();
    env.deps.platform.writeTextFile.mockRejectedValueOnce(new Error("denied"));
    expect(await env.commands.exportImage("svg")).toBe(false);
    expect(env.deps.showError).toHaveBeenCalledWith(
      "書き出せませんでした",
      "out.svg に書き出せませんでした。",
      ["Error: denied"],
    );
  });

  it("打ち込み中の YAML も反映して描く", async () => {
    const env = setup();
    env.store.getState().setYamlDraft(specExample.replace("label: Edge Router", "label: Core"));
    await env.commands.exportImage("svg");
    expect(String(env.written[0]?.data)).toContain(">Core</text>");
  });
});
