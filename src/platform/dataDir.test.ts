import { describe, expect, it } from "vitest";
import { constellaDataDir } from "./dataDir";

describe("constellaDataDir(SPEC 5.2)", () => {
  it("macOS は ~/Library/Application Support/Constella", () => {
    expect(constellaDataDir({ platform: "darwin", home: "/Users/a", vars: {} })).toBe(
      "/Users/a/Library/Application Support/Constella",
    );
  });

  it("Windows は %APPDATA%\\Constella(無ければホームの AppData\\Roaming)", () => {
    expect(
      constellaDataDir({
        platform: "win32",
        home: "C:\\Users\\a",
        vars: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" },
      }),
    ).toBe("C:\\Users\\a\\AppData\\Roaming\\Constella");
    expect(constellaDataDir({ platform: "win32", home: "C:\\Users\\a", vars: {} })).toBe(
      "C:\\Users\\a\\AppData\\Roaming\\Constella",
    );
  });

  it("そのほかは $XDG_DATA_HOME/Constella。無いか、絶対パスでなければ ~/.local/share/Constella", () => {
    expect(
      constellaDataDir({ platform: "linux", home: "/home/a", vars: { XDG_DATA_HOME: "/data/" } }),
    ).toBe("/data/Constella");
    expect(constellaDataDir({ platform: "linux", home: "/home/a", vars: {} })).toBe(
      "/home/a/.local/share/Constella",
    );
    expect(
      constellaDataDir({ platform: "linux", home: "/home/a", vars: { XDG_DATA_HOME: "data" } }),
    ).toBe("/home/a/.local/share/Constella");
  });
});
