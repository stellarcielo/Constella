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

  it("グループの枠を、種類ごとの見た目でいちばん下に描き、表示設定に従う", () => {
    const t = load(
      `${twoRouters}groups:\n  - { id: dc, kind: site, label: 本社 & DC, members: [ r1, r2 ] }\n  - { id: v10, kind: vlan, members: [ r1 ] }\n`,
    );
    const { svg } = renderSvg(t, testCatalog);
    expect(svg).toContain(">拠点: 本社 &amp; DC</text>");
    expect(svg).toContain(">VLAN: v10</text>");
    expect(svg).toContain('stroke-dasharray="8 5" fill="#8250df"');
    // 枠はリンクの線より下、枠のラベルは線より上・機器より下に描く
    const frameRect = svg.indexOf('stroke="#57606a" stroke-width="2.5"');
    const firstLine = svg.indexOf('fill="none" stroke-width="2"');
    expect(frameRect).toBeLessThan(firstLine);
    expect(firstLine).toBeLessThan(svg.indexOf("拠点: 本社"));
    expect(svg.indexOf("拠点: 本社")).toBeLessThan(svg.indexOf(">Edge &lt;1&gt;</text>"));
    // 外側の枠(拠点)が先
    expect(svg.indexOf("拠点: 本社")).toBeLessThan(svg.indexOf("VLAN: v10"));
    const hidden = renderSvg(t, testCatalog, { showGroups: false }).svg;
    expect(hidden).not.toContain("拠点: 本社");
    // 枠の分だけ図が大きくなる
    expect(renderSvg(t, testCatalog).height).toBeGreaterThan(
      renderSvg(t, testCatalog, { showGroups: false }).height,
    );
  });

  it("枠は、選んだ種類だけを描く(表示レイヤー。種類なし・custom はいつも描く)", () => {
    const t = load(
      `${twoRouters}groups:\n  - { id: dc, kind: site, members: [ r1, r2 ] }\n  - { id: v10, kind: vlan, members: [ r1 ] }\n  - { id: misc, kind: custom, label: その他, members: [ r2 ] }\n`,
    );
    const svg = renderSvg(t, testCatalog, { groupKinds: ["vlan"] }).svg;
    expect(svg).toContain(">VLAN: v10</text>");
    expect(svg).toContain(">その他</text>");
    expect(svg).not.toContain(">拠点: dc</text>");
    expect(renderSvg(t, testCatalog).svg).toContain(">拠点: dc</text>");
  });

  it("IF 名の下に IP・VLAN を描き、表示の切り替えに従う(フェーズ3-2)", () => {
    const t = load(`constella: 1
devices:
  r1:
    model: generic-router-4
    interfaces:
      Gi0/0: { ip: [ 192.0.2.1/30, 2001:db8::1/64 ], mode: routed }
  sw:
    role: l2switch
    interfaces:
      p1: { mode: access, vlan: 10 }
links:
  - { a: r1:Gi0/0, b: sw:p1 }
layout:
  r1: { x: 0, y: 0 }
  sw: { x: 0, y: 300 }
`);
    const { svg } = renderSvg(t, testCatalog);
    for (const text of ["Gi0/0", "192.0.2.1/30", "2001:db8::1/64", "p1", "VLAN 10"]) {
      expect(svg).toContain(`>${text}</text>`);
    }
    // IP・VLAN の行は IF 名より薄い色
    expect(svg).toContain('fill="#646b75">192.0.2.1/30</text>');
    expect(renderSvg(t, testCatalog, { showIp: false }).svg).not.toContain("192.0.2.1/30");
    expect(renderSvg(t, testCatalog, { showVlan: false }).svg).not.toContain("VLAN 10");
    const noNames = renderSvg(t, testCatalog, { showIfLabels: false }).svg;
    expect(noNames).not.toContain(">Gi0/0</text>");
    expect(noNames).toContain(">192.0.2.1/30</text>");
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
