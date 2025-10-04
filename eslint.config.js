import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactPlugin from "eslint-plugin-react";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: ["dist", "node_modules", "playwright-report", "test-results", "public", "pages", "data", "scripts"]
  },
  {
    files: ["**/*.{ts,tsx}"]
  },
  js.configs.recommended,
  {
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.es2021
      }
    },
    plugins: {
      "@typescript-eslint": tseslint,
      react: reactPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      ...prettier.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off"
    },
    settings: {
      react: {
        version: "detect"
      }
    }
  }
];
