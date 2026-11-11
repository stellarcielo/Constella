import { describe, expect, it } from "vitest";
import {
  iconMimeType,
  isIconImageName,
  parseIconRef,
  resolveIcon,
  ROLE_ICON_SVG,
  uniqueIconName,
} from "./icons";
import { ROLES } from "./types";

describe("アイコン(SPEC 5.1)", () => {
  it("組み込みのアイコンは role ごとにある", () => {
    for (const role of ROLES) expect(ROLE_ICON_SVG[role]).toMatch(/^</);
  });

  it("icon は組み込みのアイコンの名前か、画像のファイル名(フォルダを含まない)", () => {
    expect(parseIconRef("firewall")).toEqual({ kind: "builtin", role: "firewall" });
    expect(parseIconRef("Forti Gate.SVG")).toEqual({ kind: "image", file: "Forti Gate.SVG" });
    expect(parseIconRef("router.png")).toEqual({ kind: "image", file: "router.png" });
    expect(parseIconRef("laptop")).toBeUndefined();
    expect(parseIconRef("icons/router.png")).toBeUndefined();
    expect(parseIconRef("router.gif")).toBeUndefined();
    expect(isIconImageName("a.svg")).toBe(true);
    expect(isIconImageName("a.jpg")).toBe(false);
  });

  it("描くアイコンは、icon が無い・読めない・画像が見つからなければ role のアイコン", () => {
    const has = (file: string) => file === "fw.svg";
    expect(resolveIcon("router", undefined, has)).toEqual({ kind: "builtin", role: "router" });
    expect(resolveIcon("router", "laptop", has)).toEqual({ kind: "builtin", role: "router" });
    expect(resolveIcon("router", "firewall", has)).toEqual({ kind: "builtin", role: "firewall" });
    expect(resolveIcon("router", "fw.svg", has)).toEqual({ kind: "image", file: "fw.svg" });
    expect(resolveIcon("router", "gone.png", has)).toEqual({ kind: "builtin", role: "router" });
  });

  it("MIME タイプは拡張子から決める", () => {
    expect(iconMimeType("a.SVG")).toBe("image/svg+xml");
    expect(iconMimeType("a.png")).toBe("image/png");
  });

  it("取り込む画像の名前は、置けない文字を直し、同じ名前があれば番号を付ける", () => {
    const used = new Set(["router.svg", "router-2.svg"]);
    expect(uniqueIconName("/Users/me/router.svg", (f) => used.has(f))).toBe("router-3.svg");
    expect(uniqueIconName("My Router:1.PNG", () => false)).toBe("My-Router_1.png");
    expect(uniqueIconName(".svg", () => false)).toBe("icon.svg");
  });
});
