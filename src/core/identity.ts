// YAML を読み直した図に、前の図の識別子を引き継ぐ(エディタで書き換えたとき)。
// 識別子が変わらなければ、選択や画面の表示がそのまま続く。

import type { YamlBase } from "./parse";
import { endpointToString } from "./topology";
import type { Issue, Link, Topology } from "./types";

/**
 * 読み直した結果(parsed)に、前の図(prev)の識別子を引き継ぐ。parsed の図を書き換えて返す。
 * - デバイス: ID が同じなら同じもの
 * - リンク: 両端が同じなら同じもの(同じ両端のリンクが複数あれば、先頭から順に対応させる)
 */
export function adoptIdentity(
  prev: Topology,
  parsed: { topology: Topology; base: YamlBase; issues: Issue[] },
): { topology: Topology; base: YamlBase; issues: Issue[] } {
  const { topology } = parsed;
  for (const device of topology.devices.values()) {
    const before = prev.devices.get(device.id);
    if (before) device.uid = before.uid;
  }

  const pool = new Map<string, string[]>();
  for (const link of prev.links) {
    const ids = pool.get(linkKey(link));
    if (ids) ids.push(link.id);
    else pool.set(linkKey(link), [link.id]);
  }
  const ids = new Map<string, string>();
  for (const link of topology.links) {
    const carried = pool.get(linkKey(link))?.shift();
    if (carried !== undefined) {
      ids.set(link.id, carried);
      link.id = carried;
    }
  }

  const linkNodes = new Map(
    [...parsed.base.linkNodes].map(([id, node]) => [ids.get(id) ?? id, node] as const),
  );
  const issues = parsed.issues.map((issue) =>
    issue.target.kind === "link" && ids.has(issue.target.id)
      ? { ...issue, target: { ...issue.target, id: ids.get(issue.target.id) ?? issue.target.id } }
      : issue,
  );
  return {
    topology,
    base: { doc: parsed.base.doc, topology: structuredClone(topology), linkNodes },
    issues,
  };
}

function linkKey(link: Link): string {
  return [link.a, link.b].map((ep) => (ep ? endpointToString(ep) : "?")).join(" ");
}
