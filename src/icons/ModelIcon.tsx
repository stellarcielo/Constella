// 機器・モデルのアイコン(SPEC 5.1・7.3)。モデルの icon があればそのアイコン(組み込みのほかのアイコンか、
// アイコンのフォルダの画像)、無い・見つからなければ role のアイコン。組み込みのアイコンの色は、囲む要素の
// role の色(currentColor)。画像は色を付けずにそのまま出す。

import { resolveIcon, type Role } from "../core";
import { useIcons } from "../store";
import { RoleIcon } from "./RoleIcon";

export function ModelIcon({ role, icon, size = 32 }: { role: Role; icon?: string; size?: number }) {
  const images = useIcons((s) => s.images);
  const ref = resolveIcon(role, icon, (file) => images.has(file));
  if (ref.kind === "builtin") return <RoleIcon role={ref.role} size={size} />;
  return (
    <img
      className="model-icon-image"
      src={images.get(ref.file)}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}
