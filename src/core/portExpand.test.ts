import { describe, expect, it } from "vitest";
import { expandPortName, type ExpandResult } from "./portExpand";

function names(result: ExpandResult): string[] {
  if (!result.ok) throw new Error(result.error);
  return result.names;
}

describe("expandPortName", () => {
  it("展開する部分が無ければそのまま", () => {
    expect(names(expandPortName("wlan0"))).toEqual(["wlan0"]);
  });

  it("1 か所の展開", () => {
    expect(names(expandPortName("FastEthernet0/{1-3}"))).toEqual([
      "FastEthernet0/1",
      "FastEthernet0/2",
      "FastEthernet0/3",
    ]);
    expect(names(expandPortName("FastEthernet0/{1-24}"))).toHaveLength(24);
  });

  it("開始と終了が同じ", () => {
    expect(names(expandPortName("Gi0/{5-5}"))).toEqual(["Gi0/5"]);
  });

  it("複数か所は左を外側にして組み合わせる", () => {
    expect(names(expandPortName("Gi1/{0-1}/{1-2}"))).toEqual([
      "Gi1/0/1",
      "Gi1/0/2",
      "Gi1/1/1",
      "Gi1/1/2",
    ]);
    expect(names(expandPortName("Gi1/{0-1}/{1-4}"))).toHaveLength(8);
  });

  it("名前の先頭や末尾でも展開する", () => {
    expect(names(expandPortName("{1-2}x"))).toEqual(["1x", "2x"]);
  });

  it("0 で始まる開始値は桁をそろえる(Q2)", () => {
    expect(names(expandPortName("port{01-03}"))).toEqual(["port01", "port02", "port03"]);
    expect(names(expandPortName("p{001-002}"))).toEqual(["p001", "p002"]);
    expect(names(expandPortName("p{0-2}"))).toEqual(["p0", "p1", "p2"]);
  });

  it.each([
    ["Gi0/{4-1}", "開始が終了より大きく"],
    ["Gi0/{1-24", "閉じていません"],
    ["Gi0/1-24}", "対応する { がない"],
    ["Gi0/{a-b}", "{開始-終了} の形"],
    ["Gi0/{1}", "{開始-終了} の形"],
    ["Gi0/{}", "{開始-終了} の形"],
    ["{1-100}/{1-200}", "10000 個を超えます"],
  ])("%s はエラー", (pattern, message) => {
    const result = expandPortName(pattern);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
