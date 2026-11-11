// トランシーバ(SPEC 5.4)の入力欄。ポートに合うものを候補に出し、一覧に無い名前(製品の型番など)も書ける。

import { useId } from "react";
import { type PortType, transceiverOptions } from "../../core";
import { CommitInput } from "./fields";

export function TransceiverInput({
  value,
  ports,
  placeholder = "例: 10GBASE-SR",
  onCommit,
}: {
  value: string;
  /** 挿すポートの種別(分からない端は undefined)。候補を絞るのに使う */
  ports: readonly (PortType | undefined)[];
  placeholder?: string;
  onCommit(value: string): void;
}) {
  const listId = useId();
  return (
    <>
      <CommitInput
        label="トランシーバ"
        monospace
        list={listId}
        value={value}
        placeholder={placeholder}
        onCommit={onCommit}
      />
      <datalist id={listId}>
        {transceiverOptions(ports).map((t) => (
          <option key={t.name} value={t.name} />
        ))}
      </datalist>
    </>
  );
}
