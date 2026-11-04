import { describe, expect, it } from "vitest";
import { type IpAddress, parseIpAddress, parseSubnet, type Subnet, subnetContains } from "./ip";

describe("parseIpAddress", () => {
  it("IPv4。/ の後ろ(プレフィックス長)は見ない", () => {
    expect(parseIpAddress("192.0.2.1/30")).toEqual({ version: 4, bytes: [192, 0, 2, 1] });
    expect(parseIpAddress(" 10.0.0.255 ")).toEqual({ version: 4, bytes: [10, 0, 0, 255] });
  });

  it("IPv6。:: の省略、末尾の IPv4 の形、ゾーンも読む", () => {
    expect(parseIpAddress("2001:db8::1/64")?.bytes).toEqual([
      0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    expect(parseIpAddress("::")).toEqual({ version: 6, bytes: new Array<number>(16).fill(0) });
    expect(parseIpAddress("::ffff:192.0.2.1")?.bytes.slice(10)).toEqual([0xff, 0xff, 192, 0, 2, 1]);
    expect(parseIpAddress("fe80::1%eth0")?.bytes.slice(0, 2)).toEqual([0xfe, 0x80]);
    expect(parseIpAddress("1:2:3:4:5:6:7:8")?.bytes.slice(14)).toEqual([0, 8]);
    expect(parseIpAddress("1:2:3:4:5:6:7::")?.bytes.slice(12)).toEqual([0, 7, 0, 0]);
  });

  it("読めなければ undefined", () => {
    for (const text of [
      "",
      "dhcp",
      "192.0.2",
      "192.0.2.256",
      "192.0.2.1.5",
      "192.0.2.x",
      "a::b::c",
      "1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "::1:2:3:4:5:6:7:8",
      "12345::",
      "::ffff:192.0.2",
    ]) {
      expect(parseIpAddress(text), text).toBeUndefined();
    }
  });
});

describe("parseSubnet", () => {
  it("プレフィックス長まで読む。ホスト部が 0 でなくても読む", () => {
    expect(parseSubnet("10.10.0.0/24")).toEqual({ version: 4, bytes: [10, 10, 0, 0], prefix: 24 });
    expect(parseSubnet("10.10.0.5/24")?.prefix).toBe(24);
    expect(parseSubnet("fd00:10::/64")).toMatchObject({ version: 6, prefix: 64 });
    expect(parseSubnet("0.0.0.0/0")?.prefix).toBe(0);
  });

  it("プレフィックス長が無い・範囲の外、アドレスが読めなければ undefined", () => {
    for (const text of [
      "",
      "10.10.0.0",
      "10.10.0.0/",
      "/24",
      "10.10.0.0/33",
      "fd00::/129",
      "10.10.0/24",
      "10.10.0.0/24/1",
      "10.10.0.0 /24",
    ]) {
      expect(parseSubnet(text), text).toBeUndefined();
    }
  });
});

describe("subnetContains", () => {
  const subnet = (text: string): Subnet => {
    const result = parseSubnet(text);
    if (!result) throw new Error(text);
    return result;
  };
  const ip = (text: string): IpAddress => {
    const result = parseIpAddress(text);
    if (!result) throw new Error(text);
    return result;
  };

  it("先頭からプレフィックス長のビットが同じなら入る(バイトの途中で切れても)", () => {
    const cases: [string, string, boolean][] = [
      ["10.10.0.0/24", "10.10.0.11", true],
      ["10.10.0.0/24", "10.10.1.11", false],
      ["10.10.0.0/23", "10.10.1.200", true],
      ["10.10.0.0/23", "10.10.2.1", false],
      ["192.0.2.4/30", "192.0.2.7", true],
      ["192.0.2.4/30", "192.0.2.8", false],
      ["0.0.0.0/0", "203.0.113.1", true],
      ["fd00:10::/64", "fd00:10::11", true],
      ["fd00:10::/64", "fd00:11::11", false],
    ];
    for (const [net, address, inside] of cases) {
      expect(subnetContains(subnet(net), ip(address)), `${address} in ${net}`).toBe(inside);
    }
  });

  it("IPv4 と IPv6 は、互いに入らない", () => {
    expect(subnetContains(subnet("0.0.0.0/0"), ip("::1"))).toBe(false);
    expect(subnetContains(subnet("::/0"), ip("10.0.0.1"))).toBe(false);
  });
});
