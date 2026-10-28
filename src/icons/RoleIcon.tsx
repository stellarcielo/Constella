// role ごとのアイコン。図形は core/icons.ts(SVG の書き出しと共有)。色は currentColor を使う。

import { ROLE_ICON_SVG, ROLE_ICON_VIEWBOX, type Role } from "../core";

export function RoleIcon({ role, size = 32 }: { role: Role; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${ROLE_ICON_VIEWBOX} ${ROLE_ICON_VIEWBOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // アプリに組み込みの決まった図形だけを入れる(外から来た文字は入らない)
      dangerouslySetInnerHTML={{ __html: ROLE_ICON_SVG[role] }}
    />
  );
}
