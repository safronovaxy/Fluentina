import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// Shared so every layering block below can include them. ESLint flat config
// REPLACES a rule's options when a later block supplies its own — it does not
// merge them — so a block that lists only its own patterns silently drops
// these. That is exactly what the KAN-9/KAN-10 merge did: the i18n
// restriction survived only in lib/db, the one directory that will never
// import it, while the directory KAN-14 and KAN-16 will build in lost it.
const ADAPTER_LAYERING_GROUPS = [
  {
    group: ["@/lib/db", "@/lib/db/**"],
    message:
      "Adapters import lib/domain, never lib/db directly — SQL and the database client only exist inside lib/db. See CONTRIBUTING.md.",
  },
  {
    group: ["pg", "drizzle-orm", "drizzle-orm/**"],
    message:
      "Adapters never import the driver or the query builder directly — SQL and the database client only exist inside lib/db. See CONTRIBUTING.md.",
  },
  {
    group: ["@/test", "@/test/**"],
    message:
      "src/test is test-only fixture code and must never be imported from production code. See CONTRIBUTING.md.",
  },
];

const I18N_RESTRICTED_GROUPS = [
  {
    group: ["next-intl", "next-intl/*"],
    message: "UI-chrome-only (KAN-9) — see the next-intl override in eslint.config.js.",
  },
  {
    group: ["use-intl", "use-intl/*"],
    message: "UI-chrome-only (KAN-9) — use-intl underlies next-intl and exports the same translator/formatter primitives; it is restricted for the same reason. See the next-intl override in eslint.config.js.",
  },
];

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
      "no-restricted-imports": ["error", { patterns: I18N_RESTRICTED_GROUPS }],
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
  // --- KAN-10 layering boundary --------------------------------------------
  // src/lib/db is the only place SQL and the database client exist; src/lib/domain
  // holds business rules; src/lib/contracts holds types and Zod schemas and
  // depends on neither. Adapters (everything else) import domain, never db.
  // src/test holds test-only fixtures (raw TRUNCATE, etc.) that must never
  // reach a production module graph either. The convention is worthless
  // without these — see CONTRIBUTING.md.
  //
  // The driver (`pg`) and the query builder (`drizzle-orm`) are restricted
  // here too, not just `@/lib/db` itself: `@/lib/db` blocks the repository
  // module, but nothing stopped a route or a domain module from importing
  // `pg`/`drizzle-orm` directly, reading `DATABASE_URL`, and issuing any
  // query with no `Actor` involved — lint would stay green on exactly the
  // kind of unscoped query this story exists to prevent.
  //
  // Known gap: no-restricted-imports matches the literal import specifier,
  // not the resolved file path, so a relative import (`../../lib/db/client`
  // instead of `@/lib/db/client`) would slip past this. Every import in this
  // codebase already goes through the `@/` alias by convention (see any
  // existing file under src/), so that gap is a real but low-probability
  // hole, not a closed one — a stricter check would need
  // eslint-plugin-import's `no-restricted-paths`, which isn't installed.
  {
    files: ["src/lib/contracts/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...I18N_RESTRICTED_GROUPS,
            {
              group: ["@/lib/db", "@/lib/db/**", "@/lib/domain", "@/lib/domain/**"],
              message:
                "lib/contracts holds types and Zod schemas only and imports nothing of ours — see CONTRIBUTING.md.",
            },
            {
              group: ["pg", "drizzle-orm", "drizzle-orm/**"],
              message:
                "lib/contracts holds types and Zod schemas only — the driver and the query builder belong to lib/db alone. See CONTRIBUTING.md.",
            },
            {
              group: ["@/test", "@/test/**"],
              message:
                "src/test is test-only fixture code and must never be imported from production code. See CONTRIBUTING.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...I18N_RESTRICTED_GROUPS,
            {
              group: ["@/lib/db/client"],
              message:
                "domain imports lib/db repositories, never the raw client — importing the client bypasses the ownership boundary. See CONTRIBUTING.md.",
            },
            {
              group: ["pg", "drizzle-orm", "drizzle-orm/**"],
              message:
                "domain calls lib/db repositories, never the driver or the query builder directly — that bypasses the ownership boundary the same way importing the client does. See CONTRIBUTING.md.",
            },
            {
              group: ["@/test", "@/test/**"],
              message:
                "src/test is test-only fixture code and must never be imported from production code. See CONTRIBUTING.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Test files are exempt. The point of these rules is that PRODUCTION code
    // cannot reach the driver, the data layer or the test fixtures; a test
    // importing a test fixture is the intended use, not a violation. Without
    // this, KAN-9's component tests fail lint for importing the shared render
    // helper — which only surfaced when the two branches met, since neither
    // had both the rule and the helper.
    ignores: [
      "src/lib/db/**",
      "src/lib/domain/**",
      "src/lib/contracts/**",
      "src/test/**",
      "src/**/*.test.{ts,tsx}",
      "src/**/*.typecheck.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...I18N_RESTRICTED_GROUPS,
            {
              group: ["@/lib/db", "@/lib/db/**"],
              message:
                "Adapters import lib/domain, never lib/db directly — SQL and the database client only exist inside lib/db. See CONTRIBUTING.md.",
            },
            {
              group: ["pg", "drizzle-orm", "drizzle-orm/**"],
              message:
                "Adapters never import the driver or the query builder directly — SQL and the database client only exist inside lib/db. See CONTRIBUTING.md.",
            },
            {
              group: ["@/test", "@/test/**"],
              message:
                "src/test is test-only fixture code and must never be imported from production code. See CONTRIBUTING.md.",
            },
          ],
        },
      ],
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
    ],
    rules: {
      // Restates the layering groups deliberately. This block MUST stay last:
      // flat config replaces a rule's options rather than merging them, so
      // whichever block matches last decides everything. Turning the rule
      // fully "off" here would also switch off the database and driver
      // restrictions for these paths — "allowed to translate" is not "allowed
      // to reach the database".
      //
      // Being early rather than last is exactly how the KAN-9/KAN-10 merge
      // lost the i18n restriction everywhere except lib/db: the layering
      // blocks below overwrote this one.
      "no-restricted-imports": ["error", { patterns: ADAPTER_LAYERING_GROUPS }],
    },
  },
  {
    // Test fixtures and test files are exempt from all of it: they exist to
    // reach the database, and none of them ships.
    files: ["src/test/**", "src/**/*.test.{ts,tsx}", "src/**/*.typecheck.{ts,tsx}"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
