// IF 名の正規化(SPEC 4.4)。長い形と短い形を同一視し、保存時は短い形にそろえる。

/** [長い形, 短い形] */
const ABBREVIATIONS: readonly (readonly [string, string])[] = [
  ["Ethernet", "Eth"],
  ["FastEthernet", "Fa"],
  ["GigabitEthernet", "Gi"],
  ["TenGigabitEthernet", "Te"],
  ["TwentyFiveGigE", "Twe"],
  ["FortyGigabitEthernet", "Fo"],
  ["HundredGigE", "Hu"],
  ["Port-channel", "Po"],
  ["Vlan", "Vl"],
  ["Loopback", "Lo"],
  ["Serial", "Se"],
  ["Management", "Mgmt"],
];

// 長い形は大文字小文字を問わず短い形に置き換える。短い形は書かれた表記を保つ
// (Linux の `eth0` を `Eth0` に書き換えないため)。比較は ifNameKey で大文字小文字を無視する。
const LONG_TO_SHORT = new Map(ABBREVIATIONS.map(([long, short]) => [long.toLowerCase(), short]));
// 長い形への展開は、表どおりの表記の短い形だけを対象にする(`eth0` は展開しない)
const SHORT_TO_LONG = new Map(ABBREVIATIONS.map(([long, short]) => [short, long]));

/** 先頭の英字(と `-`)の部分、任意の空白、数字で始まる残り */
const IF_NAME_PATTERN = /^([A-Za-z][A-Za-z-]*?)\s*(\d.*)$/;

function split(name: string): { prefix: string; rest: string } | undefined {
  const m = IF_NAME_PATTERN.exec(name.trim());
  if (!m) return undefined;
  return { prefix: m[1], rest: m[2] };
}

/**
 * 略称表の長い形を短い形にし、名前と番号の間の空白を詰める。それ以外は前後の空白を除いてそのまま返す。
 * 例: `GigabitEthernet 0/1` → `Gi0/1`、`Gi 0/1` → `Gi0/1`、`eth0` → `eth0`
 */
export function normalizeIfName(name: string): string {
  const parts = split(name);
  if (!parts) return name.trim();
  const short = LONG_TO_SHORT.get(parts.prefix.toLowerCase());
  return (short ?? parts.prefix) + parts.rest;
}

/** 略称表の短い形を長い形にする(表示切り替え用)。 */
export function expandIfName(name: string): string {
  const normalized = normalizeIfName(name);
  const parts = split(normalized);
  const long = parts && SHORT_TO_LONG.get(parts.prefix);
  return parts && long ? long + parts.rest : normalized;
}

/** 同じ IF かどうかを比べるためのキー(大文字小文字を区別しない) */
export function ifNameKey(name: string): string {
  return normalizeIfName(name).toLowerCase();
}

export function ifNameEquals(a: string, b: string): boolean {
  return ifNameKey(a) === ifNameKey(b);
}
