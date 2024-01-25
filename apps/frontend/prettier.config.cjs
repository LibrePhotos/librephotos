"use strict";

module.exports = {
  printWidth: 120,
  tabWidth: 2,
  singleQuote: false,
  trailingComma: "es5",
  arrowParens: "avoid",
  plugins: [require.resolve("@trivago/prettier-plugin-sort-imports")],
  importOrder: ["wdyr", "<THIRD_PARTY_MODULES>", "^[./]"],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  overrides: [
    {
      files: "*.{json,css,scss}",
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
    {
      files: "*.json",
      options: {
        printWidth: 999999,
      },
    },
  ],
};
