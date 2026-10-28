import { describe, expect, it } from "vitest";
import { expandIfName, ifNameEquals, normalizeIfName } from "./ifname";

describe("normalizeIfName", () => {
  it.each([
    ["Ethernet1/1", "Eth1/1"],
    ["FastEthernet0/1", "Fa0/1"],
    ["GigabitEthernet0/1", "Gi0/1"],
    ["TenGigabitEthernet1/0/1", "Te1/0/1"],
    ["TwentyFiveGigE1/0/1", "Twe1/0/1"],
    ["FortyGigabitEthernet1/0/49", "Fo1/0/49"],
    ["HundredGigE1/0/1", "Hu1/0/1"],
    ["Port-channel1", "Po1"],
    ["Vlan10", "Vl10"],
    ["Loopback0", "Lo0"],
    ["Serial0/0/0", "Se0/0/0"],
    ["Management0", "Mgmt0"],
  ])("%s → %s", (long, short) => {
    expect(normalizeIfName(long)).toBe(short);
    expect(normalizeIfName(short)).toBe(short);
  });

  it("長い形は大文字小文字を問わず短い形にする", () => {
    expect(normalizeIfName("gigabitethernet0/1")).toBe("Gi0/1");
    expect(normalizeIfName("port-channel1")).toBe("Po1");
  });

  it("短い形は書かれた表記を保つ", () => {
    expect(normalizeIfName("GI0/1")).toBe("GI0/1");
    expect(normalizeIfName("eth0")).toBe("eth0");
  });

  it("名前と番号の間の空白を許す", () => {
    expect(normalizeIfName("GigabitEthernet 0/1")).toBe("Gi0/1");
    expect(normalizeIfName("  Gi 0/1 ")).toBe("Gi0/1");
  });

  it("サブインターフェースの番号はそのまま残す", () => {
    expect(normalizeIfName("GigabitEthernet0/1.100")).toBe("Gi0/1.100");
  });

  it("略称表にない名前はそのまま", () => {
    expect(normalizeIfName("eth0")).toBe("eth0");
    expect(normalizeIfName("port1")).toBe("port1");
    expect(normalizeIfName("wan")).toBe("wan");
    expect(normalizeIfName("Gig0/1")).toBe("Gig0/1");
  });
});

describe("expandIfName", () => {
  it("短い形を長い形にする", () => {
    expect(expandIfName("Gi0/1")).toBe("GigabitEthernet0/1");
    expect(expandIfName("Te1/0/1")).toBe("TenGigabitEthernet1/0/1");
    expect(expandIfName("GigabitEthernet0/1")).toBe("GigabitEthernet0/1");
    expect(expandIfName("Po1")).toBe("Port-channel1");
    expect(expandIfName("eth0")).toBe("eth0");
  });
});

describe("ifNameEquals", () => {
  it("長い形・短い形・大文字小文字の違いを同一視する", () => {
    expect(ifNameEquals("GigabitEthernet0/1", "gi0/1")).toBe(true);
    expect(ifNameEquals("ETH0", "eth0")).toBe(true);
    expect(ifNameEquals("Ethernet1/1", "eth1/1")).toBe(true);
    expect(ifNameEquals("Gi0/1", "Gi0/2")).toBe(false);
  });
});
