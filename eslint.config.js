const js = require("@eslint/js");
const prettierConfig = require("eslint-config-prettier");
const cypressPlugin = require("eslint-plugin-cypress/flat");

module.exports = [
  js.configs.recommended,
  cypressPlugin.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      // .clear().type() is idiomatic Cypress — the chain is safe in practice
      "cypress/unsafe-to-chain-command": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      "cypress/reports/**",
      "cypress/screenshots/**",
      "cypress/videos/**",
      "cypress/downloads/**",
      "dist/**",
      // GSD Core runtime: installed per person by install-gsd.mjs and gitignored, not project code.
      ".{claude,cursor,codex,github}/gsd-core/**",
      ".{claude,cursor,codex,github}/gsd-migration-journal/**",
      ".{claude,cursor,codex,github}/{agents,commands,hooks}/gsd-*",
      ".{claude,cursor,codex,github}/hooks/lib/**",
      ".{claude,cursor,codex,github}/hooks/managed-hooks-registry.cjs",
      ".{claude,cursor,codex,github}/skills/gsd-*/**",
      ".{claude,cursor,codex,github}/scripts/**",
      ".gsd/**",
    ],
  },
];
