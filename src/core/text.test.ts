import { describe, expect, it } from "vitest";
import { lineColumn, yamlErrorMessage } from "./text";

describe("lineColumn", () => {
  it("1 始まりの行と列", () => {
    const text = "constella: 1\ndevices:\n  rt1: [\n";
    expect(lineColumn(text, 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn(text, text.indexOf("devices"))).toEqual({ line: 2, column: 1 });
    expect(lineColumn(text, text.indexOf("["))).toEqual({ line: 3, column: 8 });
  });
});

describe("yamlErrorMessage", () => {
  it("1 行目だけを使い、末尾の位置の表記を取り除く", () => {
    expect(
      yamlErrorMessage(
        "Flow sequence in block collection must end with a ] at line 6, column 1:\n\n  sw1: [\n",
      ),
    ).toBe("YAML の構文エラー: Flow sequence in block collection must end with a ]");
  });
});
