// 作ったグループのラベル欄にカーソルを置く(SPEC 7.5)。グループを作ったときに頼み、
// そのグループのインスペクタが開いたときに 1 回だけ使う。

let pending: string | undefined;

export function requestGroupLabelFocus(uid: string): void {
  pending = uid;
}

/** このグループのラベル欄にカーソルを置くか */
export function wantsGroupLabelFocus(uid: string): boolean {
  return pending === uid;
}

export function clearGroupLabelFocus(): void {
  pending = undefined;
}
