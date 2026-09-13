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
      //
      // `patterns`, not `paths`: `paths` only matches the exact specifiers
      // listed, so a review found `next-intl/middleware`, `next-intl/config`
      // and the extractor subpaths sailing straight through unblocked, and
      // `use-intl` — the package next-intl re-exports and that actually
      // exports the translator/formatter primitives — was never covered at
      // all. `group` globs (`next-intl`, `next-intl/*`, `use-intl`,
      // `use-intl/*`) catch every subpath of both packages, present and
      // future, not just the five call sites this codebase happens to use
      // today.
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["next-intl", "next-intl/*"],
            message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js.",
          },
          {
            group: ["use-intl", "use-intl/*"],
            message: "UI-chrome-only (KAN-9) — use-intl underlies next-intl and exports the same translator/formatter primitives; it is restricted for the same reason. See the next-intl override in eslint.config.js.",
          },
        ],
      }],
    },
  },
  {
    // Allow-list for the rule above. Bracket-escaped because ESLint's file
    // matcher treats `[locale]` as a character class otherwise, matching
    // single characters instead of the literal directory name.
    //
    // `src/components/guest/chrome/**`, not the whole `src/components/
    // guest/**` tree: a review found that allow-listing the entire guest
    // directory also allow-listed every future non-chrome file under it —
    // exactly where KAN-14's essay entry and KAN-16/18's grading and
    // preview components are going to live — so a component that
    // interpolates graded essay feedback through next-intl would lint
    // clean. `chrome/` is only the shell/step-indicator/locale-switcher
    // components that render labels, not essay content; `flow-steps.ts`
    // (step ids/labels metadata, no next-intl import) deliberately stays
    // one level up, outside the allow-list, since future non-chrome guest
    // screens need to import it too without inheriting next-intl access.
    files: [
      "next.config.ts",
      "src/middleware.ts",
      "src/i18n/**",
      "src/components/IntlProvider.tsx",
      "src/components/guest/chrome/**",
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
