// OS(実行環境)に関わる処理の窓口。Tauri 版とブラウザ版を差し替えられるようにする。

/** メニューバーから呼ぶ操作 */
export interface MenuCommands {
  newFile(): void;
  open(): void;
  /** Proxmox VE から取り込む(SPEC 4.7) */
  importProxmox(): void;
  save(): void;
  saveAs(): void;
  /** アプリの終了(未保存なら確認する) */
  quit(): void;
  /** 取り消す・やり直す(入力欄にフォーカスがあれば、その入力欄の取り消し) */
  undo(): void;
  redo(): void;
  /** 図を画像として書き出す */
  exportSvg(): void;
  exportPng(): void;
  /** 「最近使った項目を開く」で選んだファイルを開く */
  openRecent(path: string): void;
  /** 「最近使った項目を開く」の「メニューを消去」 */
  clearRecent(): void;
  /** 表示レイヤーを選ぶ(「表示」メニュー。フェーズ3-3) */
  showLayer(layer: MenuLayer): void;
  /** モデルの管理画面を開く(SPEC 5.5) */
  openModelManager(): void;
  /** 選んでいる機器でグループを作る・選んでいるグループを解除する(「編集」メニュー。SPEC 7.5) */
  group(): void;
  ungroup(): void;
}

/** 「表示」メニューで選べる表示レイヤー */
export type MenuLayer = "all" | "l1" | "l2" | "l3";

/** メニューの「最近使った項目を開く」に出すファイル */
export interface RecentFileItem {
  path: string;
  /** メニューに出す名前 */
  label: string;
}

/** 書き出す画像の形式 */
export type ImageFormat = "svg" | "png";

/** 選んで読み込むファイルの種類。トポロジの YAML か、Proxmox VE の書き出し(JSON。SPEC 4.7) */
export type OpenFileKind = "topology" | "proxmox";

export interface Platform {
  /** メニューバー(OS のもの)でショートカットを扱うか。扱わないならアプリ側のキー操作で受ける */
  readonly hasNativeMenu: boolean;
  /** ファイルを選んで読み込む(省略時はトポロジの YAML)。キャンセルなら null */
  openTextFile(kind?: OpenFileKind): Promise<{ path: string; text: string } | null>;
  /** パスを指定して読み込む(最近使った項目を開くとき) */
  readTextFile(path: string): Promise<string>;
  /** 保存先を選ぶ。キャンセルなら null */
  chooseSavePath(defaultName: string): Promise<string | null>;
  writeTextFile(path: string, text: string): Promise<void>;
  /** 画像の書き出し先を選ぶ。キャンセルなら null */
  chooseExportPath(defaultName: string, format: ImageFormat): Promise<string | null>;
  writeBinaryFile(path: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  /**
   * ユーザーモデル(SPEC 5.2)のフォルダの YAML ファイルを読む。フォルダが無ければ空。
   * file はフォルダの中のファイル名(`<id>.yaml`)
   */
  listUserModels(): Promise<{ file: string; text: string }[]>;
  writeUserModel(file: string, text: string): Promise<void>;
  removeUserModel(file: string): Promise<void>;
  /**
   * アイコンの画像(SPEC 5.2)のフォルダの .svg・.png を読む。フォルダが無ければ空。
   * file はフォルダの中のファイル名
   */
  listIcons(): Promise<{ file: string; data: Uint8Array<ArrayBuffer> }[]>;
  /** 取り込む画像(SVG・PNG)を選んで読む。name は元のファイル名。キャンセルなら null */
  chooseIconFile(): Promise<{ name: string; data: Uint8Array<ArrayBuffer> } | null>;
  writeIcon(file: string, data: Uint8Array<ArrayBuffer>): Promise<void>;
  removeIcon(file: string): Promise<void>;
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
  /** メニューの「最近使った項目を開く」の中身を入れ替える(新しく使った順) */
  setRecentFiles(files: RecentFileItem[]): Promise<void>;
}

/** パスの最後の部分(ファイル名) */
export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
