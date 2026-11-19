// CLI(SPEC 11 章)のビルド。src/cli/main.ts と、依存する部品(yaml・elkjs など)と組み込みのモデルを、
// Node.js で動く 1 ファイル dist-cli/constella.mjs にまとめる(`npm run build:cli`)。

import { defineConfig } from "vite";

export default defineConfig({
  // 画面用の public フォルダは使わない(画面用の設定 vite.config.ts は、--config で選ばないので読まない)
  publicDir: false,
  build: {
    ssr: "src/cli/main.ts",
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    rolldownOptions: {
      output: {
        format: "es",
        entryFileNames: "constella.mjs",
        // 直接実行できるように(npm の bin)
        banner: "#!/usr/bin/env node",
      },
    },
  },
  // 依存する部品も 1 ファイルに入れる(Node.js のほかに何も入れなくても動くように)
  ssr: { noExternal: true },
});
