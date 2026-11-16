import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig } from "eslint/config";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

export default defineConfig([
  {
    ignores: ["dist/**/*", ".next/**/*"],
  },
  ...compat.extends("next/core-web-vitals"),
  firebaseRulesPlugin.configs["flat/recommended"],
]);
