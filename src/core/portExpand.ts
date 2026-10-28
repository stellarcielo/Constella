// ポート名の連番展開(SPEC 5.1)。`Gi1/{0-1}/{1-4}` → Gi1/0/1, Gi1/0/2, …, Gi1/1/4

export type ExpandResult = { ok: true; names: string[] } | { ok: false; error: string };

/** 1 つの名前から作れるポート数の上限(書き間違いで巨大な展開をしないため) */
const MAX_PORTS = 10000;

type Part = { literal: string } | { values: string[] };

export function expandPortName(pattern: string): ExpandResult {
  const parts: Part[] = [];
  let rest = pattern;
  while (rest !== "") {
    const open = rest.indexOf("{");
    const close = rest.indexOf("}");
    if (close >= 0 && (open < 0 || close < open)) {
      return { ok: false, error: `「${pattern}」に対応する { がない } があります` };
    }
    if (open < 0) {
      parts.push({ literal: rest });
      break;
    }
    if (close < 0) return { ok: false, error: `「${pattern}」の { が閉じていません` };
    if (open > 0) parts.push({ literal: rest.slice(0, open) });
    const range = parseRange(rest.slice(open + 1, close));
    if (typeof range === "string") return { ok: false, error: `「${pattern}」: ${range}` };
    parts.push({ values: range });
    rest = rest.slice(close + 1);
  }

  let names = [""];
  for (const part of parts) {
    if ("literal" in part) {
      names = names.map((n) => n + part.literal);
    } else {
      if (names.length * part.values.length > MAX_PORTS) {
        return { ok: false, error: `「${pattern}」は展開すると ${MAX_PORTS} 個を超えます` };
      }
      names = names.flatMap((n) => part.values.map((v) => n + v));
    }
  }
  return { ok: true, names };
}

/** `1-24` → ["1", …, "24"]。`01-24` のように 0 で始まるときは桁をそろえる。エラーなら理由を返す */
function parseRange(body: string): string[] | string {
  const m = /^(\d+)-(\d+)$/.exec(body);
  if (!m) return `{${body}} は {開始-終了} の形で書いてください(例: {1-24})`;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from > to) return `{${body}} は開始が終了より大きくなっています`;
  if (to - from + 1 > MAX_PORTS) return `{${body}} は範囲が大きすぎます`;
  const width = m[1].length > 1 && m[1].startsWith("0") ? m[1].length : 0;
  const values: string[] = [];
  for (let i = from; i <= to; i++) values.push(String(i).padStart(width, "0"));
  return values;
}
