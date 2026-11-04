// IP アドレスとサブネット(IPv4・IPv6)。クラスタのネットワーク(SPEC 4.6・フェーズ4-5)で、
// IF の IP がサブネットに入るかを確かめるのに使う。

/** IP アドレス。bytes は 4 バイト(IPv4)か 16 バイト(IPv6) */
export interface IpAddress {
  version: 4 | 6;
  bytes: number[];
}

/** サブネット(「10.10.0.0/24」)。prefix は、先頭から何ビットが同じならサブネットに入るか */
export interface Subnet extends IpAddress {
  prefix: number;
}

function parseIpv4(text: string): number[] | undefined {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : undefined;
}

function parseIpv6(text: string): number[] | undefined {
  let value = text;
  // 末尾が IPv4 の形(::ffff:192.0.2.1)なら、16 ビットの組 2 つに直す
  if (value.includes(".")) {
    const at = value.lastIndexOf(":");
    const v4 = parseIpv4(value.slice(at + 1));
    if (at < 0 || !v4) return undefined;
    const hex = (high: number, low: number) => ((high << 8) | low).toString(16);
    value = `${value.slice(0, at + 1)}${hex(v4[0], v4[1])}:${hex(v4[2], v4[3])}`;
  }
  // :: は、0 の組 1 つ以上の省略
  const halves = value.split("::");
  if (halves.length > 2) return undefined;
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const zeros = 8 - head.length - tail.length;
  if (halves.length === 2 ? zeros < 1 : zeros !== 0) return undefined;
  const words = [...head, ...new Array<string>(halves.length === 2 ? zeros : 0).fill("0"), ...tail];
  if (!words.every((word) => /^[0-9a-f]{1,4}$/i.test(word))) return undefined;
  return words.flatMap((word) => {
    const n = parseInt(word, 16);
    return [n >> 8, n & 0xff];
  });
}

/**
 * IP アドレスを読む(「192.0.2.1/24」「2001:db8::1/64」)。`/` の後ろ(プレフィックス長)と、
 * IPv6 のゾーン(`%eth0`)は見ない。読めなければ undefined
 */
export function parseIpAddress(text: string): IpAddress | undefined {
  const address = text.trim().split("/")[0].replace(/%.*$/, "");
  if (address.includes(":")) {
    const bytes = parseIpv6(address);
    return bytes && { version: 6, bytes };
  }
  const bytes = parseIpv4(address);
  return bytes && { version: 4, bytes };
}

/**
 * サブネットを読む(「10.10.0.0/24」「fd00:10::/64」)。プレフィックス長が無い・範囲の外なら undefined。
 * ホスト部が 0 でなくても(10.10.0.5/24)、そのサブネットとして読む
 */
export function parseSubnet(text: string): Subnet | undefined {
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(text.trim());
  const address = m ? parseIpAddress(m[1]) : undefined;
  if (!m || !address) return undefined;
  const prefix = Number(m[2]);
  return prefix <= address.bytes.length * 8 ? { ...address, prefix } : undefined;
}

/** IP がサブネットに入るか(IPv4 と IPv6 は、互いに入らない) */
export function subnetContains(subnet: Subnet, address: IpAddress): boolean {
  if (subnet.version !== address.version) return false;
  for (let bit = 0; bit < subnet.prefix; bit += 8) {
    const mask = (0xff << (8 - Math.min(8, subnet.prefix - bit))) & 0xff;
    if ((subnet.bytes[bit / 8] & mask) !== (address.bytes[bit / 8] & mask)) return false;
  }
  return true;
}

/** IP アドレスの書き方。IPv6 は、0 が続くいちばん長いところ(2 組以上)を :: にまとめる(RFC 5952) */
export function formatIpAddress(address: IpAddress): string {
  if (address.version === 4) return address.bytes.join(".");
  const words = [0, 2, 4, 6, 8, 10, 12, 14].map(
    (i) => (address.bytes[i] << 8) | address.bytes[i + 1],
  );
  let best = { at: -1, length: 0 };
  for (let i = 0; i < 8;) {
    let j = i;
    while (j < 8 && words[j] === 0) j++;
    if (j - i > best.length) best = { at: i, length: j - i };
    i = j === i ? i + 1 : j;
  }
  const hex = (list: number[]) => list.map((w) => w.toString(16)).join(":");
  if (best.length < 2) return hex(words);
  return `${hex(words.slice(0, best.at))}::${hex(words.slice(best.at + best.length))}`;
}

/** IP(「10.10.0.1/24」)の入るサブネット(「10.10.0.0/24」)。読めなければ undefined */
export function networkOf(cidr: string): string | undefined {
  const subnet = parseSubnet(cidr);
  if (!subnet) return undefined;
  const bytes = subnet.bytes.map((byte, i) => {
    const bits = Math.max(0, Math.min(8, subnet.prefix - i * 8));
    return byte & ((0xff << (8 - bits)) & 0xff);
  });
  return `${formatIpAddress({ version: subnet.version, bytes })}/${subnet.prefix}`;
}
