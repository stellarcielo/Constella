// 確認ダイアログ。選択肢を 3 つ以上出せるよう、OS の標準ダイアログではなくアプリ内に描く。
// Esc と背景のクリックはキャンセル。主ボタン(primary)に最初からフォーカスを置く。

import { type ReactNode, useId } from "react";
import { createPortal } from "react-dom";
import "./ConfirmDialog.css";

export interface DialogAction<T extends string> {
  value: T;
  label: string;
  primary?: boolean;
  /** データを消すなど、取り消しにくい操作 */
  danger?: boolean;
}

export interface ConfirmDialogProps<T extends string> {
  title: string;
  children: ReactNode;
  actions: DialogAction<T>[];
  /** キャンセルボタンの文字。null ならボタンを出さない(Esc と背景のクリックではキャンセルになる) */
  cancelLabel?: string | null;
  onAction(value: T): void;
  onCancel(): void;
}

export function ConfirmDialog<T extends string>({
  title,
  children,
  actions,
  cancelLabel = "キャンセル",
  onAction,
  onCancel,
}: ConfirmDialogProps<T>) {
  const titleId = useId();
  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <div className="dialog-body">{children}</div>
        <div className="dialog-actions">
          {cancelLabel !== null && (
            <button type="button" className="dialog-button" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          {actions.map((action) => (
            <button
              key={action.value}
              type="button"
              className={["dialog-button", action.primary && "primary", action.danger && "danger"]
                .filter(Boolean)
                .join(" ")}
              // 開いたらすぐ Enter で主ボタンを押せるようにする
              autoFocus={action.primary}
              onClick={() => onAction(action.value)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
