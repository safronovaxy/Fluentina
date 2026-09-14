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
    ignores: ["src/lib/db/**", "src/lib/domain/**", "src/lib/contracts/**", "src/test/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
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
];
