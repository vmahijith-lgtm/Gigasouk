import path from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** next/core-web-vitals includes react-hooks/rules-of-hooks (hook-order bugs like React #310). */
export default [
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      // Signed/external URLs and galleries — migrating everything to next/image is separate work.
      "@next/next/no-img-element": "off",
      "@next/next/no-page-custom-font": "off",
    },
  },
];
