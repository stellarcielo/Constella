// インスペクタの入力欄。Enter か入力欄から離れたときに確定し、Esc で元に戻す。
// 1 文字ごとには反映しない(フェーズ2の Undo で 1 回の変更が 1 ステップになるように)。
// Enter と Esc ではフォーカスも外し、続けて delete キーや C などのキー操作がキャンバスに効くようにする。

import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

/** 日本語入力の変換を確定する Enter では、入力欄の値を確定しない */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229;
}

/** props の値が変わったら、編集中の値を新しい値に合わせる */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setDraft(value);
  }
  return [draft, setDraft] as const;
}

/**
 * 確定は入力欄から離れたとき(blur)の 1 か所で行う。
 * Enter はフォーカスを外すだけ(blur で確定)、Esc は元に戻してから確定せずにフォーカスを外す。
 */
function useCommitKeys(revert: () => void) {
  const cancelled = useRef(false);
  const onBlurCommit = (commit: () => void) => () => {
    if (cancelled.current) cancelled.current = false;
    else commit();
  };
  const finish = (e: KeyboardEvent<HTMLElement>) => {
    e.preventDefault();
    e.currentTarget.blur();
  };
  const cancel = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    cancelled.current = true;
    revert();
    e.currentTarget.blur();
  };
  return { onBlurCommit, finish, cancel };
}

interface CommitProps {
  value: string;
  onCommit(value: string): void;
  /** 確定できない値なら理由を返す。理由がある間はその下に表示し、確定せずに元に戻す */
  validate?(value: string): string | undefined;
  /** 読み上げ用の名前 */
  label: string;
  placeholder?: string;
  monospace?: boolean;
}

export function CommitInput({
  value,
  onCommit,
  validate,
  label,
  placeholder,
  monospace,
}: CommitProps) {
  const [draft, setDraft] = useDraft(value);
  const keys = useCommitKeys(() => setDraft(value));
  const next = draft.trim();
  const error = next !== value ? validate?.(next) : undefined;

  const commit = () => {
    if (next === value || error) setDraft(value);
    else onCommit(next);
  };

  return (
    <>
      <input
        className={`field-input${monospace ? " mono" : ""}`}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={keys.onBlurCommit(commit)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !composing(e)) keys.finish(e);
          else if (e.key === "Escape") keys.cancel(e);
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </>
  );
}

/** 複数行の入力欄。Enter は改行、⌘Enter(Ctrl+Enter)か入力欄から離れたときに確定する */
export function CommitTextarea({
  value,
  onCommit,
  label,
  placeholder,
  monospace,
  rows = 3,
}: CommitProps & { rows?: number }) {
  const [draft, setDraft] = useDraft(value);
  const keys = useCommitKeys(() => setDraft(value));
  const commit = () => {
    const next = draft.trim();
    if (next === value) setDraft(value);
    else onCommit(next);
  };
  return (
    <textarea
      className={`field-input${monospace ? " mono" : ""}`}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      rows={rows}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={keys.onBlurCommit(commit)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !composing(e)) keys.finish(e);
        else if (e.key === "Escape") keys.cancel(e);
      }}
    />
  );
}
