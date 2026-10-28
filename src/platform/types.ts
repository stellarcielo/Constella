// OS(実行環境)に関わる処理の窓口。Tauri 版とブラウザ版を差し替えられるようにする。

/** メニューバーから呼ぶ操作 */
export interface MenuCommands {
  newFile(): void;
  open(): void;
  save(): void;
  saveAs(): void;
  /** アプリの終了(未保存なら確認する) */
  quit(): void;
  /** 取り消す・やり直す(入力欄にフォーカスがあれば、その入力欄の取り消し) */
  undo(): void;
  redo(): void;
}

export interface Platform {
  /** メニューバー(OS のもの)でショートカットを扱うか。扱わないならアプリ側のキー操作で受ける */
  readonly hasNativeMenu: boolean;
  /** ファイルを選んで読み込む。キャンセルなら null */
  openTextFile(): Promise<{ path: string; text: string } | null>;
  /** 保存先を選ぶ。キャンセルなら null */
  chooseSavePath(defaultName: string): Promise<string | null>;
  writeTextFile(path: string, text: string): Promise<void>;
  setTitle(title: string): void;
  /** システムのクリップボードの文字列 */
  readClipboardText(): Promise<string>;
  writeClipboardText(text: string): Promise<void>;
  /**
   * ウィンドウを閉じる(アプリを終了する)前に確認する。
   * isDirty が true のとき confirm を呼び、false が返ったら閉じない。登録を解除する関数を返す
   */
  guardClose(options: { isDirty(): boolean; confirm(): Promise<boolean> }): () => void;
  /** 確認なしでウィンドウを閉じる */
  closeWindow(): Promise<void>;
  setupMenu(commands: MenuCommands): Promise<void>;
}

/** パスの最後の部分(ファイル名) */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
