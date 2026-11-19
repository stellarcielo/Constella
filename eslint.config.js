import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "dist-cli", "src-tauri/target", "src-tauri/gen", "coverage"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // src/core は React・Tauri に依存しない純粋な TypeScript に保つ
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*"],
              message: "src/core は React に依存しないこと",
            },
            { group: ["@tauri-apps/*"], message: "src/core は Tauri に依存しないこと" },
            {
              group: ["@xyflow/*", "zustand", "zustand/*"],
              message: "src/core は UI ライブラリに依存しないこと",
            },
            { group: ["node:*"], message: "src/core は Node.js に依存しないこと" },
          ],
        },
      ],
    },
  },
  {
    // 画面のコードは WebView で動くので、Node.js の機能は使わない(Node.js を使うのは CLI だけ)
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/core/**", "src/cli/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [{ group: ["node:*"], message: "Node.js の機能は src/cli の中だけで使うこと" }],
        },
      ],
    },
  },
  {
    // CLI(SPEC 11 章)は Node.js で動く
    files: ["src/cli/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
