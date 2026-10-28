// テキスト上の位置の変換。

/**
 * YAML ライブラリのエラーメッセージを 1 行にする。
 * 末尾の「at line 6, column 1:」は、問題の位置(range)と重複するので取り除く
 */
export function yamlErrorMessage(message: string): string {
  return `YAML の構文エラー: ${message.split("\n")[0].replace(/ at line \d+, column \d+:?$/, "")}`;
}

/** 文字オフセットを「何行目・何列目」(どちらも 1 始まり)に変える */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, offset));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}
