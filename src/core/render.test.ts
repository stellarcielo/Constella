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

  it("ゲストに VM / CT の印を付け、ホストの枠を描く。「ゲスト」を隠すと、どちらも描かない(フェーズ4-1)", () => {
    const t = load(`constella: 1
devices:
  sw1: { model: generic-l2switch-24 }
  pve1: { model: generic-hypervisor-4 }
  web01: { model: generic-vm, host: pve1 }
  db01: { model: generic-container, host: pve1 }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
  - { a: web01:net0, b: sw1:Gi0/2 }
layout:
  sw1: { x: 0, y: 0 }
  pve1: { x: 0, y: 200 }
  web01: { x: -100, y: 400 }
  db01: { x: 100, y: 400 }
`);
    const { svg } = renderSvg(t, testCatalog);
    expect(svg).toContain('font-weight="700" fill="#646b75">VM</text>');
    expect(svg).toContain('font-weight="700" fill="#646b75">CT</text>');
    expect(svg).toContain(">VM 1・CT 1</text>");
    expect(svg).toContain('stroke="#6b7f00" stroke-width="1.5" fill="#6b7f00"');
    expect(svg.match(/<path d="M [^"]*" fill="none" stroke-width="2"/g)).toHaveLength(2);
    // ホストの枠は「グループ」を隠しても描く
    expect(renderSvg(t, testCatalog, { showGroups: false }).svg).toContain(">VM 1・CT 1</text>");

    const hidden = renderSvg(t, testCatalog, { showGuests: false }).svg;
    expect(hidden).not.toContain(">web01</text>");
    expect(hidden).not.toContain(">VM 1・CT 1</text>");
    expect(hidden).toContain(">pve1</text>");
    // ゲストにつながるリンクも描かない
    expect(hidden.match(/<path d="M [^"]*" fill="none" stroke-width="2"/g)).toHaveLength(1);
  });

  it("ブリッジの箱とホストとの点線を描き、ブリッジ側の端には IF 名を出さない(フェーズ4-2)", () => {
    const t = load(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge, members: [ eno1 ], vlan-aware: true, ip: [ 192.0.2.2/24 ] }
      vmbr1: { type: bridge }
  web01: { model: generic-vm, host: pve1 }
links:
  - { a: web01:net0, b: pve1:vmbr0 }
layout:
  pve1: { x: 0, y: 0 }
  pve1:vmbr0: { x: 0, y: 120 }
  pve1:vmbr1: { x: 200, y: 120 }
  web01: { x: 0, y: 240 }
`);
    const { svg } = renderSvg(t, testCatalog);
    expect(svg).toContain('font-size="11" fill="#1f2328">vmbr0</text>');
    expect(svg).toContain('font-size="11" fill="#1f2328">vmbr1</text>');
    expect(svg).toContain(">VLAN</text>");
    expect(svg).toContain(">192.0.2.2/24</text>");
    // 線は、ゲストとブリッジのリンク 1 本と、vmbr0 とホストの点線 1 本(members の無い vmbr1 は線なし)
    const lines = svg.match(/<path d="M [^"]*" fill="none" stroke-width="2"[^>]*>/g) ?? [];
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes('stroke-dasharray="2 4"'))).toBe(true);
    // ゲスト側の IF 名は出し、ブリッジ側(vmbr0)は箱の名前だけ。ホスト側に members を出す
    expect(svg).toContain(">net0</text>");
    expect(svg).toContain(">eno1</text>");
    expect(svg.match(/>vmbr0<\/text>/g)).toHaveLength(1);
    // ゲストを隠すと、ブリッジも描かない
    const hidden = renderSvg(t, testCatalog, { showGuests: false }).svg;
    expect(hidden).not.toContain("vmbr0");
    expect(hidden).not.toContain(">eno1</text>");
  });

  it("bond と VLAN インターフェースをラベルに出す(フェーズ4-3 Q1・Q2)", () => {
    const t = load(`constella: 1
devices:
  sw1: { model: generic-l2switch-24 }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      bond0: { type: bond, members: [ eno1, eno2 ], bond-mode: 802.3ad }
      bond1: { type: bond, members: [ eno3 ], ip: [ 10.20.0.11/24 ] }
      vmbr0: { type: bridge, members: [ bond0 ] }
      vmbr0.10: { type: vlan, ip: [ 192.168.10.2/24 ] }
links:
  - { a: pve1:eno1, b: sw1:Gi0/1 }
layout:
  sw1: { x: 0, y: 0 }
  pve1: { x: 0, y: 200 }
  pve1:vmbr0: { x: 0, y: 340 }
`);
    const { svg } = renderSvg(t, testCatalog);
    // 物理的な線: IF 名の下に、束ねている bond
    expect(svg).toMatch(/>eno1<\/text>.*?>bond0<\/text>/);
    // ブリッジとホストの間の線: members の下に、bond の中身とモード
    expect(svg).toContain(">eno1 + eno2(802.3ad)</text>");
    // ブリッジの箱の下に VLAN インターフェースの IP、ホストの名前の下に bond の IP
    expect(svg).toContain(">vmbr0.10 192.168.10.2/24</text>");
    expect(svg).toContain(">bond1 10.20.0.11/24</text>");
    // IP を出さないときは、IP の行を出さない
    const noIp = renderSvg(t, testCatalog, { showIp: false }).svg;
    expect(noIp).not.toContain("10.20.0.11");
    expect(noIp).not.toContain("192.168.10.2");
  });

  it("クラスタの枠を描き、クラスタのホストの IP にネットワークの名前を添える(フェーズ4-5)", () => {
    const t = load(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      eno3: { ip: [ 10.10.0.1/24 ] }
      bond1: { type: bond, members: [ eno4 ], ip: [ 10.20.0.1/24 ] }
      vmbr0: { type: bridge, members: [ eno1 ], ip: [ 10.30.0.1/24 ] }
  pve2:
    model: generic-hypervisor-4
    interfaces:
      eno3: { ip: [ 10.10.0.2/24 ] }
  vm1: { model: generic-vm, host: pve1, interfaces: { net0: { ip: [ 10.30.0.11/24 ] } } }
links:
  - { a: pve1:eno3, b: pve2:eno3 }
  - { a: vm1:net0, b: pve1:vmbr0 }
layout:
  pve1: { x: 0, y: 0 }
  pve2: { x: 300, y: 0 }
  pve1:vmbr0: { x: 0, y: 140 }
  vm1: { x: 0, y: 260 }
groups:
  - id: lab
    kind: cluster
    members: [ pve1, pve2 ]
    networks:
      corosync: 10.10.0.0/24
      ceph-public: 10.20.0.0/24
      ceph-cluster: 10.20.0.0/24
      migration: 10.30.0.0/24
`);
    // 表示レイヤーで選んだ種類に関係なく描く
    const { svg } = renderSvg(t, testCatalog, { groupKinds: [] });
    expect(svg).toContain(">クラスタ: lab</text>");
    expect(svg).toContain('stroke="#1b7c83" stroke-width="2"');
    // リンクの端・ホストの名前の下・ブリッジの箱の下
    expect(svg).toContain(">10.10.0.1/24 (corosync)</text>");
    expect(svg).toContain(">10.10.0.2/24 (corosync)</text>");
    expect(svg).toContain(">bond1 10.20.0.1/24 (ceph-public, ceph-cluster)</text>");
    expect(svg).toContain(">10.30.0.1/24 (migration)</text>");
    // ゲストの IP には添えない
    expect(svg).toContain(">10.30.0.11/24</text>");
  });

  it("VNet の箱に印と tag・subnets を描き、ゾーンのブリッジの箱やホストへ点線を引く(フェーズ4-6)", () => {
    const t = load(`constella: 1
devices:
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
  vm1: { model: generic-vm, host: pve1 }
links:
  - { a: vm1:net0, b: pve1:vnet30 }
  - { a: vm1:net1, b: pve1:vx1 }
layout:
  pve1: { x: 0, y: 0 }
  pve1:vmbr0: { x: -100, y: 120 }
  pve1:vnet30: { x: 0, y: 120 }
  pve1:vx1: { x: 100, y: 120 }
  vm1: { x: 0, y: 240 }
sdn:
  zones:
    lan: { type: vlan, bridge: vmbr0 }
    vx: { type: vxlan }
  vnets:
    vnet30: { zone: lan, tag: 30, subnets: [ 10.30.0.0/24 ] }
    vx1: { zone: vx, tag: 5000 }
`);
    const { svg } = renderSvg(t, testCatalog);
    expect(svg).toContain(">vnet30</text>");
    expect(svg.match(/>VNet<\/text>/g)).toHaveLength(2);
    expect(svg).toContain(">VLAN 30</text>");
    expect(svg).toContain(">10.30.0.0/24</text>");
    expect(svg).toContain(">VXLAN 5000</text>");
    // 点線は箱の中心から、vnet30 はゾーンのブリッジ(vmbr0)の箱へ、vx1 はホストのアイコンへ
    expect(svg).toContain('<path d="M 48,133 L -52,133"');
    expect(svg).toContain('<path d="M 148,133 L 48,26"');
    // tag は「VLAN」、subnets は「IP」の表示に従う
    const hidden = renderSvg(t, testCatalog, { showVlan: false, showIp: false }).svg;
    expect(hidden).not.toContain("VLAN 30");
    expect(hidden).not.toContain("10.30.0.0/24");
  });

  it("同じデバイスに付く、別々の線の IF 名ラベルを重ねない(SPEC 7.3)", () => {
    // r2 から、横の r1 へ IP 付きの線、左上の r3 へ近い角度の線
    const t = load(`constella: 1
devices:
  r1: { model: generic-router-4 }
  r2:
    model: generic-router-4
    interfaces:
      Gi0/2: { ip: [ 10.10.0.2/24 ] }
  r3: { model: generic-router-4 }
links:
  - { a: r2:Gi0/2, b: r1:Gi0/0 }
  - { a: r2:Gi0/3, b: r3:Gi0/0 }
layout:
  r1: { x: 0, y: 0 }
  r2: { x: 500, y: 0 }
  r3: { x: 0, y: -140 }
`);
    const { svg } = renderSvg(t, testCatalog);
    // IF 名ラベルの枠(枠線のある rect)と 1 行目の文字
    const boxes = new Map(
      [
        ...svg.matchAll(
          /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" rx="3" [^>]*stroke="[^"]*"\/><text [^>]*>([^<]*)<\/text>/g,
        ),
      ].map((m) => [m[5], m.slice(1, 5).map(Number)]),
    );
    const [x1, y1, w1, h1] = boxes.get("Gi0/2") ?? [];
    const [x2, y2, w2, h2] = boxes.get("Gi0/3") ?? [];
    const apart = x1 + w1 <= x2 || x2 + w2 <= x1 || y1 + h1 <= y2 || y2 + h2 <= y1;
    expect(apart).toBe(true);
  });

  it("手で動かした IF 名ラベルは、その位置に描く(SPEC 7.3)", () => {
    const t = load(`constella: 1
devices:
  r1: { model: generic-router-4 }
  r2: { model: generic-router-4 }
links:
  - { a: r1:Gi0/1, b: r2:Gi0/2 }
layout:
  r1: { x: 0, y: 0 }
  r2: { x: 300, y: 0 }
  _labels:
    r1:Gi0/1: { along: 100, side: 30 }
`);
    // r1 のアイコンの中心(48, 26)から右へ 100、下へ 30 が中心。ラベルの大きさは 39 × 15
    expect(renderSvg(t, testCatalog).svg).toContain(
      '<rect x="128.5" y="48.5" width="39" height="15" rx="3"',
    );
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
