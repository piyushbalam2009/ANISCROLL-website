import { defineConfig } from "eslint/config";
import next from "eslint-config-next";
import firebaseRulesPlugin from "@firebase/eslint-plugin-security-rules";

export default defineConfig([
  {
    ignores: ["dist/**/*", ".next/**/*"],
  },
  ...next,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  firebaseRulesPlugin.configs["flat/recommended"],
]);
