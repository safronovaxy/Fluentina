import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist", ".next"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // KAN-9: next-intl is a UI-chrome translation layer only. Essay
      // prompts, submitted essay text and AI grading output are German by
      // definition (NFR §8 Language) and must go through GradingProvider,
      // never through this catalogue — see src/i18n/request.ts. Restricting
      // the import repo-wide, then re-enabling it only where chrome i18n
      // actually lives (below), means a future grading/essay feature can't
      // start importing it by accident; widening the allow-list is a
      // decision someone has to make on purpose.
      "no-restricted-imports": ["error", {
        paths: [
          { name: "next-intl", message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js." },
          { name: "next-intl/server", message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js." },
          { name: "next-intl/navigation", message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js." },
          { name: "next-intl/routing", message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js." },
          { name: "next-intl/plugin", message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js." },
        ],
      }],
    },
  },
  {
    // Allow-list for the rule above. Bracket-escaped because ESLint's file
    // matcher treats `[locale]` as a character class otherwise, matching
    // single characters instead of the literal directory name.
    files: [
      "next.config.ts",
      "src/middleware.ts",
      "src/i18n/**",
      "src/components/IntlProvider.tsx",
      "src/components/guest/**",
      "src/app/\\[locale\\]/**",
      "src/test/**",
    ],
    rules: {
      "no-restricted-imports": "off",
    },
  },
  {
    files: ["**/*.{js,jsx}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
