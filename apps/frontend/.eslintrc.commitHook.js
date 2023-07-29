module.exports = {
  extends: ["airbnb", "airbnb-typescript", "airbnb/hooks", "prettier"],
  plugins: ["prettier"],
  rules: {
    "prettier/prettier": "error",
    "no-unused-vars": "error",
    "no-console": "off",
    "func-names": "off",
    "no-process-exit": "off",
    "object-shorthand": "off",
    "class-methods-use-this": "off",
    "import/prefer-default-export": "off",
    "import/no-default-export": "error",
    "no-void": "off",
    "react/jsx-curly-brace-presence": "warn",
  },
  parserOptions: {
    project: "./tsconfig.eslint.json",
  },
};
