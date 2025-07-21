// Created by running "npm init @eslint/config".

import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


/** @type {import('eslint').Linter.Config[]} */
export default [
  {ignores: ["**/BAK/**", "**/TMP/**", "lib/**"]},
  {languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "prefer-const": "off",
      "no-constant-condition": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {argsIgnorePattern: "^_"},
      ],
    },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
        }
      ],
      "@typescript-eslint/naming-convention": [
        "warn",
        {
          selector: ["parameter", "parameterProperty"],
          modifiers: ["private"],
          format: null,
          leadingUnderscore: "require",
        },
      ],
    },
  },
];
