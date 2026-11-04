import { defineConfig, type EnvironmentModuleNode, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// 開発中、画面の部品(.tsx)と CSS 以外のモジュールが変わったら、その場で差し替えずにページを読み直す。
// ストアとコマンドはモジュールを読み込んだときに 1 つずつ作り、メニューとショートカットは起動したときに
// それらへつなぐ。差し替えるとストアだけが作り直され、メニューなどは古いストアを使い続けてしまう。
// import.meta.glob のファイルの追加・削除も拾えるよう、ほかのプラグインのあと(post)で調べる。
function reloadOnNonComponentChange(): Plugin {
  return {
    name: "constella:reload-on-non-component-change",
    apply: "serve",
    enforce: "post",
    hotUpdate({ file, modules, timestamp }) {
      if (this.environment.name !== "client") return;
      // 部品と CSS だけなら(モジュールが無ければ)、Vite の差し替えに任せる
      if (modules.every((mod) => /\.(tsx|css)$/.test(mod.file ?? ""))) return;
      const invalidated = new Set<EnvironmentModuleNode>();
      for (const mod of modules) {
        this.environment.moduleGraph.invalidateModule(mod, invalidated, timestamp, true);
      }
      this.environment.logger.info(
        `page reload ${path.relative(this.environment.config.root, file)}`,
        { timestamp: true },
      );
      this.environment.hot.send({ type: "full-reload" });
      return [];
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), reloadOnNonComponentChange()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
