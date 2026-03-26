import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "bin/**",
      "server/**",
    ],
  },
  {
    rules: {
      // Allow Function constructor for the JIT compiler (compiler.ts uses new Function())
      "@typescript-eslint/no-implied-eval": "off",
      // Allow explicit any in specific cases where unknown is impractical
      "@typescript-eslint/no-explicit-any": "warn",
      // unused vars: allow underscore-prefixed params
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
