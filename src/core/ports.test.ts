import { describe, expect, it } from "vitest";
import { parseTopology } from "./parse";
import {
  buildPortUsage,
  canonicalIfName,
  firstFreePort,
  listDevicePorts,
  portTypesCompatible,
} from "./ports";
import { specExample, testCatalog } from "./testFixtures";
import type { Topology } from "./types";

function load(text: string): Topology {
  const result = parseTopology(text, { catalog: testCatalog });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.topology;
}

function device(t: Topology, id: string) {
  const d = t.devices.get(id);
  if (!d) throw new Error(id);
  return d;
}

describe("portTypesCompatible", () => {
  it("差し込み口が同じ種別は合う", () => {
    expect(portTypesCompatible("sfp", "sfp+")).toBe(true);
    expect(portTypesCompatible("qsfp+", "qsfp28")).toBe(true);
    expect(portTypesCompatible("rj45", "sfp+")).toBe(false);
  });
});

describe("buildPortUsage", () => {
  it("両端のポートと接続先を記録する", () => {
    const t = load(specExample);
    const usage = buildPortUsage(t);
    expect(usage.get("rt1")?.get("gi0/1")?.peer).toEqual({ device: "core-sw1", iface: "Gi0/1" });
    expect(usage.get("isp")?.get("wan")?.peer).toEqual({ device: "rt1", iface: "Gi0/0" });
    expect(usage.get("srv1")?.has("eth1")).toBe(false);
  });
});

describe("listDevicePorts", () => {
  it("モデルのポートを定義順に並べ、使用状況を付ける", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "rt1"), t, testCatalog);
    expect(ports.map((p) => [p.name, p.type, p.use?.peer?.device])).toEqual([
      ["Gi0/0", "rj45", "isp"],
      ["Gi0/1", "rj45", "core-sw1"],
      ["Gi0/2", "rj45", undefined],
      ["Gi0/3", "rj45", undefined],
    ]);
  });

  it("モデルの長い名前は短い形で出す", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "core-sw1"), t, testCatalog);
    expect(ports[0]).toMatchObject({ name: "Fa0/1", type: "rj45", defined: true });
    expect(ports[0].use?.peer).toEqual({ device: "srv1", iface: "eth0" });
    expect(ports).toHaveLength(26);
  });

  it("フレキシブルデバイスは使われている IF を出てきた順に出す", () => {
    const t = load(`constella: 1
devices:
  isp:
    role: cloud
    interfaces:
      mgmt: {}
  rt1: { model: generic-router-4 }
links:
  - a: rt1:Gi0/0
    b: isp:wan
  - a: isp:wan2
    b: rt1:Gi0/1
`);
    const ports = listDevicePorts(device(t, "isp"), t, testCatalog);
    expect(ports.map((p) => [p.name, p.defined, p.use?.peer?.iface])).toEqual([
      ["mgmt", false, undefined],
      ["wan", false, "Gi0/0"],
      ["wan2", false, "Gi0/1"],
    ]);
  });

  it("作りかけの接続で押さえたポートは使用中にする(接続先なし)", () => {
    const t = load(specExample);
    const ports = listDevicePorts(device(t, "rt1"), t, testCatalog, undefined, {
      device: "rt1",
      iface: "Gi0/2",
    });
    expect(ports[2].use).toEqual({});
  });
});

describe("firstFreePort", () => {
  it("先頭の空いている定義済みポート", () => {
    const t = load(specExample);
    expect(firstFreePort(listDevicePorts(device(t, "rt1"), t, testCatalog))?.name).toBe("Gi0/2");
    expect(firstFreePort(listDevicePorts(device(t, "srv1"), t, testCatalog))?.name).toBe("eth1");
  });

  it("定義済みのポートが無ければ undefined(Q5)", () => {
    const t = load(specExample);
    expect(firstFreePort(listDevicePorts(device(t, "isp"), t, testCatalog))).toBeUndefined();
  });
});

describe("canonicalIfName", () => {
  it("モデルや既存の IF と同じなら、その表記に合わせる", () => {
    const t = load(specExample);
    expect(canonicalIfName(t, "core-sw1", "fastethernet0/3", testCatalog)).toBe("Fa0/3");
    expect(canonicalIfName(t, "isp", "WAN", testCatalog)).toBe("wan");
  });

  it("どれとも一致しなければ短い形にする", () => {
    const t = load(specExample);
    expect(canonicalIfName(t, "isp", "GigabitEthernet9/9", testCatalog)).toBe("Gi9/9");
    expect(canonicalIfName(t, "isp", " uplink ", testCatalog)).toBe("uplink");
  });
});
