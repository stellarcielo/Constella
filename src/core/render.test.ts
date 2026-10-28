import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { escapeXml, renderSvg } from "./render";
import { specExample, testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

const twoRouters = `constella: 1
meta: { title: "A & B <lab>" }
devices:
  r1: { model: generic-router-4, label: "Edge <1>" }
  r2: { model: generic-router-4 }
links:
  - { a: r1:Gi0/0, b: r2:Gi0/0, media: fiber, label: uplink }
  - { a: r1:Gi0/1, b: r2:Gi0/1, media: wireless }
  - { a: r1:Gi0/2, b: r1:Gi0/3 }
layout:
  r1: { x: 0, y: 0 }
  r2: { x: 300, y: 0 }
`;

describe("renderSvg", () => {
  it("デバイス・リンク・ラベルを描き、文字はエスケープする", () => {
    const { svg } = renderSvg(load(twoRouters), testCatalog);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("<title>A &amp; B &lt;lab&gt;</title>");
    expect(svg).toContain(">Edge &lt;1&gt;</text>");
    expect(svg).toContain(">r2</text>");
    expect(svg).toContain(">uplink</text>");
    expect(svg).toContain(">Gi0/0</text>");
    // 線 3 本(並列 2 本 + 自分自身への輪)
    expect(svg.match(/<path d="M [^"]*" fill="none" stroke-width="2"/g)).toHaveLength(3);
    expect(svg).toContain('stroke="#e8822a"');
    expect(svg).toContain('stroke-dasharray="8 5"');
    expect(svg).toMatch(/<path d="M [^"]* C [^"]*"/);
  });

  it("並列リンクは平行にずらす", () => {
    const { svg } = renderSvg(load(twoRouters), testCatalog);
    const ys = [...svg.matchAll(/<path d="M ([\d.-]+),([\d.-]+) L/g)].map((m) => Number(m[2]));
    expect(ys).toHaveLength(2);
    expect(ys[0]).not.toBe(ys[1]);
  });

  it("図全体が収まる大きさに余白を付ける", () => {
    const { svg, width, height } = renderSvg(load(twoRouters), testCatalog, { padding: 10 });
    const [x, y, w, h] = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "").split(" ").map(Number);
    expect([w, h]).toEqual([width, height]);
    // r1 のアイコンの箱(x: 22〜74、y: 0〜52)が入る
    expect(x).toBeLessThanOrEqual(22 - 10);
    expect(y).toBeLessThanOrEqual(-10);
    // r2 の右に描く自分自身への輪は無いが、r1 の輪(右へ 72px)と r2 の箱(右端 374)が入る
    expect(x + w).toBeGreaterThanOrEqual(374 + 10);
  });

  it("IF 名の表示設定に従う", () => {
    const t = load(twoRouters);
    expect(renderSvg(t, testCatalog, { showIfLabels: false }).svg).not.toContain(">Gi0/0</text>");
    expect(renderSvg(t, testCatalog, { longIfNames: true }).svg).toContain(
      ">GigabitEthernet0/0</text>",
    );
  });

  it("座標の無いデバイスは fallbackPositions の位置に描き、どちらも無ければ描かない", () => {
    const t = load(specExample);
    const without = renderSvg(t, testCatalog).svg;
    expect(without).not.toContain(">srv1</text>");
    const withFallback = renderSvg(t, testCatalog, {
      fallbackPositions: new Map([
        ["srv1", { x: 300, y: 400 }],
        ["isp", { x: 300, y: -80 }],
      ]),
    }).svg;
    expect(withFallback).toContain(">srv1</text>");
    expect(withFallback.match(/<path d="M [^"]*" fill="none"/g)).toHaveLength(3);
  });

  it("空の図でも正しい SVG になる", () => {
    const { svg, width } = renderSvg(load("constella: 1\n"), testCatalog);
    expect(width).toBe(48);
    expect(svg).toContain("</svg>");
  });
});

describe("escapeXml", () => {
  it("特別な意味のある文字を置き換える", () => {
    expect(escapeXml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});
