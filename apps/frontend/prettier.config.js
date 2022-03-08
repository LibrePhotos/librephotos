"use strict";

module.exports = {
  printWidth: 120,
  tabWidth: 2,
  singleQuote: false,
  trailingComma: "es5",
  arrowParens: "always",
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
