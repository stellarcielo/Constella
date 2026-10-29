import { describe, expect, it } from "vitest";
import { testCatalog } from "../core/testFixtures";
import { createUserModelsStore, modelFileName, userModelCatalog } from "./userModels";

const model = (id: string, role = "l2switch", ports = "eth{1-2}") =>
  `id: ${id}\nrole: ${role}\nports:\n  - name: "${ports}"\n    type: rj45\n`;

function setup(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const store = createUserModelsStore({
    list: async () => [...disk].map(([file, text]) => ({ file, text })),
    write: async (file, text) => void disk.set(file, text),
    remove: async (file) => void disk.delete(file),
  });
  return { disk, store, s: () => store.getState() };
}

describe("ユーザーモデル(フェーズ3-4)", () => {
  it("フォルダの YAML を読み、読めないファイルもエラー付きで残す(Q7)", async () => {
    const env = setup({ "b.yaml": model("b"), "a.yaml": model("a"), "bad.yaml": "id: bad\n" });
    await env.s().reload();
    expect(env.s().files.map((f) => [f.file, f.model?.id])).toEqual([
      ["a.yaml", "a"],
      ["b.yaml", "b"],
      ["bad.yaml", undefined],
    ]);
    expect(env.s().files[2].issues.map((i) => i.message)).toContain("role がありません");
  });

  it("保存すると読み直す。ID を変えたら古いファイルを消す", async () => {
    const env = setup();
    await env.s().save(modelFileName("sw-a"), model("sw-a"));
    expect([...env.disk.keys()]).toEqual(["sw-a.yaml"]);
    await env.s().save(modelFileName("sw-b"), model("sw-b"), "sw-a.yaml");
    expect([...env.disk.keys()]).toEqual(["sw-b.yaml"]);
    expect(env.s().files.map((f) => f.model?.id)).toEqual(["sw-b"]);
    await env.s().remove("sw-b.yaml");
    expect(env.s().files).toEqual([]);
  });

  it("フォルダが読めなければ理由を残す", async () => {
    const store = createUserModelsStore({
      list: async () => {
        throw new Error("denied");
      },
      write: async () => {},
      remove: async () => {},
    });
    await store.getState().reload();
    expect(store.getState().loadError).toBe("Error: denied");
  });

  it("カタログは組み込みとユーザーを合わせ、同じ ID はユーザーが優先(SPEC 5.2)", async () => {
    const env = setup({
      "mine.yaml": model("mine"),
      "router.yaml": model("generic-router-4", "router", "Gi0/{0-7}"),
    });
    await env.s().reload();
    const catalog = userModelCatalog(testCatalog.values(), env.s().files);
    expect(catalog.has("mine")).toBe(true);
    expect(catalog.get("generic-router-4")?.ports).toHaveLength(8);
    expect(catalog.get("generic-server-2")).toBe(testCatalog.get("generic-server-2"));
  });
});
