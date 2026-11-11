// アイコンを選ぶ欄(SPEC 5.5)。role のアイコン(既定)、組み込みのほかのアイコン、取り込んだ画像から選ぶ。
// 「画像を取り込む…」で SVG・PNG をアイコンのフォルダにコピーして選ぶ。どのモデルも使っていない画像は消せる。
// モデルの管理画面と、追加・編集のダイアログで使う。

import type { ReactNode } from "react";
import { ROLES, type Role } from "../../core";
import { RoleIcon } from "../../icons/RoleIcon";
import { ROLE_LABELS } from "../../icons/roles";
import { useIcons, useTopology } from "../../store";
import { iconDescription, importIconImage, removeIconImage } from "./actions";
import "./IconPicker.css";

export function IconPicker({
  value,
  role,
  onChange,
}: {
  /** 今の icon(空なら role のアイコン) */
  value: string;
  role: Role;
  onChange(icon: string): void;
}) {
  const images = useIcons((s) => s.images);
  const catalog = useTopology((s) => s.catalog);
  // どれかのモデルが使っている画像は消せない
  const used = new Set([...catalog.values()].flatMap((m) => (m.icon ? [m.icon] : [])));
  const current = value === role ? "" : value;

  const choice = (icon: string, label: string, content: ReactNode, removable = false) => (
    <div key={icon || "(role)"} className="icon-choice-cell">
      <button
        type="button"
        className={`icon-choice${current === icon ? " selected" : ""}`}
        aria-pressed={current === icon}
        aria-label={label}
        title={label}
        onClick={() => onChange(icon)}
      >
        <span className={`role-icon role-${role}`}>{content}</span>
      </button>
      {removable && (
        <button
          type="button"
          className="icon-choice-remove"
          title={`画像「${icon}」を、アイコンのフォルダから削除する`}
          aria-label={`画像「${icon}」を削除`}
          onClick={() => void removeIconImage(icon)}
        >
          ×
        </button>
      )}
    </div>
  );

  return (
    <div className="icon-picker">
      <div className="icon-picker-grid">
        {choice("", `${ROLE_LABELS[role]}のアイコン(既定)`, <RoleIcon role={role} size={24} />)}
        {ROLES.filter((r) => r !== role).map((r) =>
          choice(r, `組み込み: ${ROLE_LABELS[r]}(${r})`, <RoleIcon role={r} size={24} />),
        )}
        {[...images].map(([file, url]) =>
          choice(
            file,
            `画像: ${file}`,
            <img className="model-icon-image" src={url} width={24} height={24} alt="" />,
            !used.has(file) && current !== file,
          ),
        )}
      </div>
      <div className="icon-picker-foot">
        <button
          type="button"
          className="dialog-button"
          onClick={() =>
            void importIconImage().then((file) => {
              if (file) onChange(file);
            })
          }
        >
          画像を取り込む…
        </button>
        <span className="icon-picker-current">{iconDescription(value, role, images)}</span>
      </div>
    </div>
  );
}
