import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cliCatalog, iconDataUrls, isModelFile, readFolder } from "./catalog";

describe("CLI のカタログ(SPEC 11 章)", () => {
  it("組み込みのモデルにユーザーモデルを足し、同じ ID ならユーザーモデルを使う", () => {
    const { catalog, problems } = cliCatalog([
      { file: "r.yaml", text: "id: generic-router-4\nrole: firewall\nflexible: true\n" },
    ]);
    expect(problems).toEqual([]);
    expect(catalog.get("generic-router-4")?.role).toBe("firewall");
    expect(catalog.has("generic-l2switch-24")).toBe(true);
  });

  it("アイコンの画像を data: URL にする", () => {
    const urls = iconDataUrls([
      { file: "a.svg", data: new TextEncoder().encode("<svg/>") },
      { file: "b.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(urls.get("a.svg")).toBe(`data:image/svg+xml;base64,${btoa("<svg/>")}`);
    expect(urls.get("b.png")).toBe("data:image/png;base64,AQID");
  });

  it("フォルダの中の合うファイルを名前の順に読み、フォルダが無ければ空", async () => {
    const dir = await mkdtemp(join(tmpdir(), "constella-cli-"));
    try {
      await writeFile(join(dir, "b.yml"), "id: b\n");
      await writeFile(join(dir, "a.yaml"), "id: a\n");
      await writeFile(join(dir, "notes.txt"), "x");
      const files = await readFolder(dir, isModelFile);
      expect(files.map((f) => [f.file, new TextDecoder().decode(f.data)])).toEqual([
        ["a.yaml", "id: a\n"],
        ["b.yml", "id: b\n"],
      ]);
      expect(await readFolder(join(dir, "missing"), isModelFile)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
