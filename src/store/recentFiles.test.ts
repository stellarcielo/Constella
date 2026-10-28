import { describe, expect, it } from "vitest";
import { addRecent, createRecentFilesStore, RECENT_LIMIT, recentLabels } from "./recentFiles";

function memoryStorage(initial?: string) {
  const items = new Map<string, string>();
  if (initial !== undefined) items.set("constella.recentFiles", initial);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("addRecent", () => {
  it("先頭に入れ、同じパスは 1 つにまとめる", () => {
    expect(addRecent(["/a.yaml", "/b.yaml"], "/c.yaml")).toEqual(["/c.yaml", "/a.yaml", "/b.yaml"]);
    expect(addRecent(["/a.yaml", "/b.yaml", "/c.yaml"], "/b.yaml")).toEqual([
      "/b.yaml",
      "/a.yaml",
      "/c.yaml",
    ]);
  });

  it("10 件を超えたら、古いものから消す", () => {
    let paths: string[] = [];
    for (let i = 1; i <= 12; i++) paths = addRecent(paths, `/f${i}.yaml`);
    expect(paths).toHaveLength(RECENT_LIMIT);
    expect(paths[0]).toBe("/f12.yaml");
    expect(paths[paths.length - 1]).toBe("/f3.yaml");
  });
});

describe("recentLabels", () => {
  it("ふだんはファイル名だけ", () => {
    expect(recentLabels(["/Users/me/lab.constella.yaml", "C:\\work\\dc.constella.yaml"])).toEqual([
      "lab.constella.yaml",
      "dc.constella.yaml",
    ]);
  });

  it("同じファイル名があれば、フォルダ名を添える。それでも同じならフルパス", () => {
    expect(
      recentLabels([
        "/Users/me/projects/lab.yaml",
        "/Users/me/old/lab.yaml",
        "/a/x/net.yaml",
        "/b/x/net.yaml",
        "/Users/me/home.yaml",
      ]),
    ).toEqual([
      "lab.yaml — projects",
      "lab.yaml — old",
      "/a/x/net.yaml",
      "/b/x/net.yaml",
      "home.yaml",
    ]);
  });
});

describe("createRecentFilesStore", () => {
  it("追加・外す・消去し、変わるたびに保存する", () => {
    const storage = memoryStorage();
    const store = createRecentFilesStore(storage);
    store.getState().add("/a.yaml");
    store.getState().add("/b.yaml");
    expect(store.getState().paths).toEqual(["/b.yaml", "/a.yaml"]);
    expect(storage.items.get("constella.recentFiles")).toBe('["/b.yaml","/a.yaml"]');
    store.getState().remove("/b.yaml");
    expect(store.getState().paths).toEqual(["/a.yaml"]);
    store.getState().clear();
    expect(store.getState().paths).toEqual([]);
    expect(storage.items.get("constella.recentFiles")).toBe("[]");
  });

  it("保存した一覧を読み込む", () => {
    const store = createRecentFilesStore(memoryStorage('["/x.yaml","/y.yaml"]'));
    expect(store.getState().paths).toEqual(["/x.yaml", "/y.yaml"]);
  });

  it("壊れた保存データは、使える部分だけ読む", () => {
    expect(createRecentFilesStore(memoryStorage("{oops")).getState().paths).toEqual([]);
    expect(createRecentFilesStore(memoryStorage('{"a":1}')).getState().paths).toEqual([]);
    const mixed = JSON.stringify([
      "/a.yaml",
      3,
      "",
      "/a.yaml",
      ...Array.from({ length: 12 }, (_, i) => `/f${i}`),
    ]);
    const paths = createRecentFilesStore(memoryStorage(mixed)).getState().paths;
    expect(paths[0]).toBe("/a.yaml");
    expect(paths).toHaveLength(RECENT_LIMIT);
    expect(new Set(paths).size).toBe(RECENT_LIMIT);
  });

  it("保存先が無くても使える", () => {
    const store = createRecentFilesStore();
    store.getState().add("/a.yaml");
    expect(store.getState().paths).toEqual(["/a.yaml"]);
  });
});
