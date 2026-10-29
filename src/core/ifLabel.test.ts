import { describe, expect, it } from "vitest";
import { type IfLabelOptions, ifLabel, ifLabelLines, interfaceInfo, vlanText } from "./ifLabel";
import { parseTopology } from "./parse";
import { testCatalog } from "./testFixtures";
import type { InterfaceInfo } from "./types";

const all: IfLabelOptions = { showIfName: true, longIfNames: false, showIp: true, showVlan: true };
const info = (fields: Partial<InterfaceInfo>): InterfaceInfo => ({ extra: {}, ...fields });

describe("vlanText(Q4)", () => {
  it("access は VLAN 番号、trunk は通す VLAN", () => {
    expect(vlanText(info({ mode: "access", vlan: 10 }))).toBe("VLAN 10");
    expect(vlanText(info({ mode: "trunk", vlans: "10,20,100-110" }))).toBe("trunk 10,20,100-110");
    expect(vlanText(info({ mode: "trunk" }))).toBe("trunk");
  });

  it("モードが無くても、vlan なら VLAN 番号、vlans なら trunk として書く", () => {
    expect(vlanText(info({ vlan: 30 }))).toBe("VLAN 30");
    expect(vlanText(info({ vlans: "10,20" }))).toBe("trunk 10,20");
  });

  it("routed や、VLAN の書かれていない IF は出さない", () => {
    expect(vlanText(info({ mode: "routed", vlan: 10 }))).toBeUndefined();
    expect(vlanText(info({ mode: "access" }))).toBeUndefined();
    expect(vlanText(info({ description: "uplink" }))).toBeUndefined();
  });
});

describe("ifLabel", () => {
  it("IF 名の下に、IP を 1 つずつと VLAN を足す(Q1・Q3)", () => {
    const label = ifLabel(
      "Gi0/1",
      info({ ip: ["192.0.2.1/30", "2001:db8::1/64"], mode: "access", vlan: 10 }),
      all,
    );
    expect(label).toEqual({
      name: "Gi0/1",
      details: ["192.0.2.1/30", "2001:db8::1/64", "VLAN 10"],
    });
    expect(label && ifLabelLines(label)).toEqual([
      "Gi0/1",
      "192.0.2.1/30",
      "2001:db8::1/64",
      "VLAN 10",
    ]);
  });

  it("説明(description)は出さない(Q5)", () => {
    expect(ifLabel("eth0", info({ description: "to core" }), all)).toEqual({
      name: "eth0",
      details: [],
    });
  });

  it("表示の切り替えに従う(Q2)", () => {
    const data = info({ ip: ["192.0.2.1/30"], mode: "trunk", vlans: "10,20" });
    expect(ifLabel("Gi0/1", data, { ...all, showIp: false })?.details).toEqual(["trunk 10,20"]);
    expect(ifLabel("Gi0/1", data, { ...all, showVlan: false })?.details).toEqual(["192.0.2.1/30"]);
    expect(ifLabel("Gi0/1", data, { ...all, longIfNames: true })?.name).toBe("GigabitEthernet0/1");
    // IF 名を切っても、IP や VLAN だけのラベルにできる
    expect(ifLabel("Gi0/1", data, { ...all, showIfName: false })).toEqual({
      name: undefined,
      details: ["192.0.2.1/30", "trunk 10,20"],
    });
    // 出すものが無ければラベルを描かない
    expect(ifLabel("Gi0/1", undefined, { ...all, showIfName: false })).toBeUndefined();
  });
});

describe("interfaceInfo", () => {
  it("長い名前・短い名前、大文字小文字の違いも同じ IF として探す", () => {
    const result = parseTopology(
      "constella: 1\ndevices:\n  r1:\n    interfaces:\n      GigabitEthernet0/1: { vlan: 10 }\n",
      { catalog: testCatalog },
    );
    if (!result.ok) throw new Error("parse");
    const device = result.topology.devices.get("r1");
    expect(interfaceInfo(device, "Gi0/1")?.vlan).toBe(10);
    expect(interfaceInfo(device, "gi0/1")?.vlan).toBe(10);
    expect(interfaceInfo(device, "Gi0/2")).toBeUndefined();
    expect(interfaceInfo(undefined, "Gi0/1")).toBeUndefined();
  });
});
