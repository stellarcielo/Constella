// アプリのデータ用フォルダ(SPEC 5.2)。ユーザーモデルとアイコンの画像を置く Constella フォルダを、
// Tauri の dataDir と同じ場所に求める(CLI から、アプリと同じユーザーモデルを読むため。SPEC 11 章)。
// Node.js の機能は使わず、OS・ホームフォルダ・環境変数は呼ぶ側から渡す。

export interface DataDirEnv {
  /** Node.js の process.platform と同じ値(darwin・win32・linux など) */
  platform: string;
  /** ホームフォルダ */
  home: string;
  /** 環境変数 */
  vars: Readonly<Record<string, string | undefined>>;
}

/**
 * Constella フォルダ。macOS は ~/Library/Application Support/Constella、
 * Windows は %APPDATA%\Constella、そのほかは $XDG_DATA_HOME/Constella(無ければ ~/.local/share/Constella)
 */
export function constellaDataDir({ platform, home, vars }: DataDirEnv): string {
  if (platform === "win32") {
    const base = vars.APPDATA || joinPath("\\", home, "AppData", "Roaming");
    return joinPath("\\", base, "Constella");
  }
  if (platform === "darwin")
    return joinPath("/", home, "Library", "Application Support", "Constella");
  // XDG の決まりどおり、絶対パスでなければ使わない
  const xdg = vars.XDG_DATA_HOME;
  const base = xdg && xdg.startsWith("/") ? xdg : joinPath("/", home, ".local", "share");
  return joinPath("/", base, "Constella");
}

/** フォルダの区切り sep でつなぐ(前の部分の末尾の区切りは 1 つにまとめる) */
function joinPath(sep: string, ...parts: string[]): string {
  return parts.reduce((path, part) =>
    path.endsWith(sep) || path.endsWith("/") ? path + part : path + sep + part,
  );
}
