import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import {
  bidiPartner,
  effectivePortType,
  endpointTakesTransceiver,
  endpointTransceiver,
  findTransceiver,
  type Transceiver,
  TRANSCEIVERS,
  takesTransceiver,
  transceiverFits,
  transceiverMedia,
  transceiverOptions,
  transceiversMatch,
} from "./transceivers";
import type { Topology } from "./types";

/** 一覧にある名前のトランシーバ(無ければテストを失敗させる) */
function tr(name: string): Transceiver {
  const found = findTransceiver(name);
  if (!found) throw new Error(`一覧に無い: ${name}`);
  return found;
}

function topology(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

describe("findTransceiver", () => {
  it("一覧の名前は、大文字小文字と前後の空白を区別しない", () => {
    expect(tr("10GBASE-SR")).toMatchObject({ name: "10GBASE-SR", form: "sfp+", kind: "optical" });
    expect(findTransceiver(" 10gbase-sr ")).toBe(tr("10GBASE-SR"));
  });

  it("別名は一覧の名前と同じものにする", () => {
    expect(findTransceiver("1000BASE-LX10")).toBe(tr("1000BASE-LX"));
    expect(findTransceiver("1000BASE-LH")).toBe(tr("1000BASE-LX"));
    expect(findTransceiver("1000BASE-BX10-D")).toBe(tr("1000BASE-BX-D"));
    expect(findTransceiver("10GBASE-BX10-U")).toBe(tr("10GBASE-BX-U"));
    expect(findTransceiver("10GBASE-CR")).toBe(tr("10G-DAC"));
    expect(findTransceiver("100GBASE-CR4")).toBe(tr("100G-DAC"));
  });

  it("一覧に無い名前(製品の型番など)と、書いていないときは undefined", () => {
    expect(findTransceiver("SFP-10G-SR")).toBeUndefined();
    expect(findTransceiver(undefined)).toBeUndefined();
  });

  it("一覧は SPEC 5.4 の 31 種類で、名前が重ならない", () => {
    expect(TRANSCEIVERS).toHaveLength(31);
    expect(new Set(TRANSCEIVERS.map((t) => t.name)).size).toBe(31);
  });
});

describe("ポートに挿せるか", () => {
  it("SFP 系と QSFP 系のポートだけに挿せる", () => {
    for (const type of ["sfp", "sfp+", "sfp28", "qsfp+", "qsfp28"] as const) {
      expect(takesTransceiver(type)).toBe(true);
    }
    for (const type of ["rj45", "console", "serial", "wireless", "virtual"] as const) {
      expect(takesTransceiver(type)).toBe(false);
    }
  });

  it("下の速度は挿せ、上の速度と形の違うものは挿せない", () => {
    expect(transceiverFits(tr("1000BASE-SX"), "sfp+")).toBe(true);
    expect(transceiverFits(tr("10GBASE-LR"), "sfp+")).toBe(true);
    expect(transceiverFits(tr("25GBASE-SR"), "sfp+")).toBe(false);
    expect(transceiverFits(tr("10GBASE-SR"), "sfp")).toBe(false);
    expect(transceiverFits(tr("10G-DAC"), "sfp28")).toBe(true);
    expect(transceiverFits(tr("40GBASE-SR4"), "qsfp28")).toBe(true);
    expect(transceiverFits(tr("100GBASE-SR4"), "qsfp+")).toBe(false);
    expect(transceiverFits(tr("100GBASE-SR4"), "sfp28")).toBe(false);
    expect(transceiverFits(tr("1000BASE-T"), "rj45")).toBe(false);
  });
});

describe("リンクの両端", () => {
  it("同じもの(別名・大文字小文字の違いを含む)なら合う", () => {
    expect(transceiversMatch(tr("10GBASE-SR"), tr("10gbase-sr"))).toBe(true);
    expect(transceiversMatch(tr("10G-DAC"), tr("10GBASE-CR"))).toBe(true);
    expect(transceiversMatch(tr("10GBASE-SR"), tr("10GBASE-LR"))).toBe(false);
    expect(transceiversMatch(tr("1000BASE-LX"), tr("10GBASE-LR"))).toBe(false);
  });

  it("BiDi は、同じ形の U と D の組み合わせだけ合う", () => {
    expect(transceiversMatch(tr("1000BASE-BX-U"), tr("1000BASE-BX-D"))).toBe(true);
    expect(transceiversMatch(tr("10GBASE-BX-D"), tr("10GBASE-BX-U"))).toBe(true);
    expect(transceiversMatch(tr("1000BASE-BX-U"), tr("1000BASE-BX-U"))).toBe(false);
    expect(transceiversMatch(tr("1000BASE-BX-U"), tr("10GBASE-BX-D"))).toBe(false);
    expect(transceiversMatch(tr("1000BASE-LX"), tr("1000BASE-BX-D"))).toBe(false);
  });

  it("BiDi の相手は U なら D、D なら U。BiDi でなければ無い", () => {
    expect(bidiPartner(tr("10GBASE-BX-U"))).toBe(tr("10GBASE-BX-D"));
    expect(bidiPartner(tr("1000BASE-BX-D"))).toBe(tr("1000BASE-BX-U"));
    expect(bidiPartner(tr("10GBASE-SR"))).toBeUndefined();
  });
});

describe("media とポート種別", () => {
  it("光と AOC は fiber、銅線は copper、DAC は dac", () => {
    expect(transceiverMedia(tr("10GBASE-SR"))).toBe("fiber");
    expect(transceiverMedia(tr("25G-AOC"))).toBe("fiber");
    expect(transceiverMedia(tr("1000BASE-T"))).toBe("copper");
    expect(transceiverMedia(tr("40G-DAC"))).toBe("dac");
  });

  it("銅線のトランシーバを挿したポートは RJ45 とみなす(SPEC 4.5)", () => {
    expect(effectivePortType("sfp+", "10GBASE-T")).toBe("rj45");
    expect(effectivePortType("sfp", "1000base-t")).toBe("rj45");
    expect(effectivePortType("sfp+", "10GBASE-SR")).toBe("sfp+");
    expect(effectivePortType("sfp+", "SFP-10G-T")).toBe("sfp+");
    expect(effectivePortType("sfp+", undefined)).toBe("sfp+");
  });
});

describe("transceiverOptions(入力欄の候補)", () => {
  const forms = (options: Transceiver[]) => [...new Set(options.map((t) => t.form))];

  it("ポートに挿せるものだけを、一覧の順に出す", () => {
    const options = transceiverOptions(["sfp+"]);
    expect(forms(options)).toEqual(["sfp", "sfp+"]);
    expect(options[0].name).toBe("1000BASE-SX");
  });

  it("両端なら、どちらにも挿せるもの。そろって挿せるものが無ければ、どちらかに挿せるもの", () => {
    expect(forms(transceiverOptions(["sfp+", "sfp28"]))).toEqual(["sfp", "sfp+"]);
    expect(forms(transceiverOptions(["sfp+", "qsfp28"]))).toEqual([
      "sfp",
      "sfp+",
      "qsfp+",
      "qsfp28",
    ]);
  });

  it("種別が分からないとき(と、挿せない種別)は絞らない", () => {
    expect(transceiverOptions([undefined])).toHaveLength(31);
    expect(transceiverOptions(["sfp+", undefined])).toEqual(transceiverOptions(["sfp+"]));
    expect(transceiverOptions(["rj45"])).toHaveLength(31);
  });
});

describe("リンクの端の IF", () => {
  const t = topology(`constella: 1
devices:
  sw1:
    model: generic-l2switch-24
    interfaces:
      Te0/25: { transceiver: 10GBASE-SR }
  pve1:
    model: generic-hypervisor-4
    interfaces:
      vmbr0: { type: bridge }
      bond0: { type: bond, members: [eno1, eno2] }
  vm1: { model: generic-vm, host: pve1 }
  isp: { role: cloud }
links: []
`);

  it("書かれたトランシーバ。IF 名の長い形・短い形は同じとみなす", () => {
    expect(endpointTransceiver(t, { device: "sw1", iface: "TenGigabitEthernet0/25" })).toBe(
      "10GBASE-SR",
    );
    expect(endpointTransceiver(t, { device: "sw1", iface: "Te0/26" })).toBeUndefined();
  });

  it("SFP 系のポートと、種別の分からない IF には挿せる", () => {
    expect(endpointTakesTransceiver(t, { device: "sw1", iface: "Te0/26" }, testCatalog)).toBe(true);
    expect(endpointTakesTransceiver(t, { device: "isp", iface: "wan" }, testCatalog)).toBe(true);
  });

  it("RJ45・仮想のポートと、ブリッジ・bond には挿せない", () => {
    const takes = (device: string, iface: string) =>
      endpointTakesTransceiver(t, { device, iface }, testCatalog);
    expect(takes("sw1", "Gi0/1")).toBe(false);
    expect(takes("vm1", "net0")).toBe(false);
    expect(takes("pve1", "vmbr0")).toBe(false);
    expect(takes("pve1", "bond0")).toBe(false);
    expect(takes("nowhere", "eth0")).toBe(false);
  });
});
