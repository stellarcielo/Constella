import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { specExample, testCatalog } from "./testFixtures";
import type { Issue } from "./types";
import { validateTopology } from "./validate";

function check(text: string): { issues: Issue[]; text: string } {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return { issues: validateTopology(result.topology, testCatalog, result.base), text };
}

function summary(issues: Issue[]): [string, string][] {
  return issues.map((i) => [i.severity, i.code]);
}

const devices = `constella: 1
devices:
  rt1: { model: generic-router-4 }
  sw1: { model: generic-l2switch-24 }
  srv1: { model: generic-server-2 }
  isp: { role: cloud }
links:
`;

describe("validateTopology", () => {
  it("SPEC 4.2 の例には問題が無い", () => {
    expect(check(specExample).issues).toEqual([]);
  });

  it("存在しないデバイスへの参照", () => {
    const { issues, text } = check(`${devices}  - a: rt1:Gi0/0\n    b: nowhere:eth0\n`);
    expect(summary(issues)).toEqual([["error", "unknown-device"]]);
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("nowhere:eth0");
  });

  it("モデルに無い IF への参照", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/9\n    b: srv1:eth0\n`);
    expect(summary(issues)).toEqual([["error", "unknown-interface"]]);
    expect(issues[0].target).toEqual(expect.objectContaining({ kind: "link", end: "a" }));
  });

  it("interfaces に書いた IF もモデルと照合する", () => {
    const { issues, text } = check(`constella: 1
devices:
  rt1:
    model: generic-router-4
    interfaces:
      Gi0/7: { description: x }
`);
    expect(summary(issues)).toEqual([["error", "unknown-interface"]]);
    const r = issues[0].range;
    expect(r && text.slice(r.start, r.end)).toBe("Gi0/7");
  });

  it("フレキシブルデバイスは任意の IF 名を使える", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: isp:anything-1\n`);
    expect(issues).toEqual([]);
  });

  it("未知のモデルはエラー 1 件だけにし、IF の参照ではエラーを出さない(Q3)", () => {
    const { issues } = check(`constella: 1
devices:
  x1:
    model: no-such-model
    interfaces:
      foo0: {}
  rt1: { model: generic-router-4 }
links:
  - a: x1:bar0
    b: rt1:Gi0/0
`);
    expect(summary(issues)).toEqual([["error", "unknown-model"]]);
  });

  it("同じポートの二重使用(長い形・大文字小文字の違いも同じポート)", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0
    b: sw1:Gi0/1
  - a: rt1:GigabitEthernet0/0
    b: sw1:Gi0/2
  - a: isp:WAN
    b: sw1:Gi0/3
  - a: isp:wan
    b: sw1:Gi0/4
`);
    expect(summary(issues)).toEqual([
      ["error", "port-in-use"],
      ["error", "port-in-use"],
    ]);
    expect(issues[0].message).toContain("sw1:Gi0/1");
  });

  it("自分自身への接続は警告", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: rt1:Gi0/1\n`);
    expect(summary(issues)).toEqual([["warning", "self-loop"]]);
  });

  it("同じポート同士をつなぐと二重使用と自己接続の両方", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: rt1:Gi0/0\n`);
    expect(summary(issues)).toEqual([
      ["error", "port-in-use"],
      ["warning", "self-loop"],
    ]);
  });

  it("ポート種別の不一致は警告(RJ45 と SFP+)", () => {
    const { issues } = check(`${devices}  - a: rt1:Gi0/0\n    b: sw1:Te0/25\n`);
    expect(summary(issues)).toEqual([["warning", "port-type-mismatch"]]);
  });

  it("フレキシブルデバイスの IF は種別が分からないので警告しない", () => {
    const { issues } = check(`${devices}  - a: sw1:Te0/25\n    b: isp:wan\n`);
    expect(issues).toEqual([]);
  });

  it("layout に存在しないデバイスがあれば警告", () => {
    const { issues } = check("constella: 1\nlayout:\n  ghost: { x: 0, y: 0 }\n");
    expect(summary(issues)).toEqual([["warning", "unknown-layout-device"]]);
  });
});
