import { describe, expect, it, vi } from "vitest";
import { createIconsStore, iconDataUrl, type IconsIo } from "./icons";

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

function memoryIo(
  initial: Record<string, string> = {},
  chosen?: { name: string; data: Uint8Array<ArrayBuffer> },
) {
  const files = new Map(Object.entries(initial).map(([file, text]) => [file, bytes(text)]));
  const io: IconsIo = {
    list: async () => [...files].map(([file, data]) => ({ file, data })),
    choose: async () => chosen ?? null,
    write: vi.fn(async (file: string, data: Uint8Array<ArrayBuffer>) => {
      files.set(file, data);
    }),
    remove: vi.fn(async (file: string) => {
      files.delete(file);
    }),
  };
  return { io, files };
}

describe("アイコンの画像(SPEC 5.1・5.2)", () => {
  it("フォルダの画像を、ファイル名の順に data: URL にして持つ", async () => {
    const { io } = memoryIo({ "b.png": "PNG", "a.svg": "<svg/>" });
    const store = createIconsStore(io);
    await store.getState().reload();
    expect([...store.getState().images.keys()]).toEqual(["a.svg", "b.png"]);
    expect(store.getState().images.get("a.svg")).toBe(
      `data:image/svg+xml;base64,${btoa("<svg/>")}`,
    );
    expect(iconDataUrl("b.png", bytes("PNG"))).toBe(`data:image/png;base64,${btoa("PNG")}`);
  });

  it("取り込むと、同じ名前があれば番号を付けて書き込み、そのファイル名を返す", async () => {
    const { io, files } = memoryIo(
      { "router.svg": "<svg/>" },
      { name: "router.svg", data: bytes("<svg>2</svg>") },
    );
    const store = createIconsStore(io);
    await store.getState().reload();
    expect(await store.getState().importImage()).toBe("router-2.svg");
    expect([...files.keys()]).toEqual(["router.svg", "router-2.svg"]);
    expect(store.getState().images.has("router-2.svg")).toBe(true);
  });

  it("キャンセルなら何もしない。1 MB を超える画像は取り込まない", async () => {
    const cancel = memoryIo();
    expect(await createIconsStore(cancel.io).getState().importImage()).toBeUndefined();
    const big = memoryIo({}, { name: "big.png", data: new Uint8Array(1024 * 1024 + 1) });
    await expect(createIconsStore(big.io).getState().importImage()).rejects.toThrow("1 MB まで");
    expect(big.io.write).not.toHaveBeenCalled();
  });

  it("名前を決めた画像をまとめて書き込み、読み直す(SPEC 5.5)", async () => {
    const { io, files } = memoryIo({ "a.svg": "<svg/>" });
    const store = createIconsStore(io);
    await store.getState().reload();
    await store.getState().addImages([
      { file: "b.png", data: bytes("PNG") },
      { file: "a-2.svg", data: bytes("<svg>2</svg>") },
    ]);
    expect([...files.keys()]).toEqual(["a.svg", "b.png", "a-2.svg"]);
    expect([...store.getState().images.keys()]).toEqual(["a-2.svg", "a.svg", "b.png"]);
  });

  it("消すとフォルダから消して読み直す。フォルダが読めなければ理由を持つ", async () => {
    const { io } = memoryIo({ "a.svg": "<svg/>" });
    const store = createIconsStore(io);
    await store.getState().reload();
    await store.getState().remove("a.svg");
    expect(store.getState().images.size).toBe(0);
    const failing = createIconsStore({
      ...io,
      list: async () => Promise.reject(new Error("読めない")),
    });
    await failing.getState().reload();
    expect(failing.getState().loadError).toContain("読めない");
  });
});
