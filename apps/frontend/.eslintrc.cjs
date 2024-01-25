module.exports = {
  env: {
    browser: true,
    node: true,
    jest: true,
  },
  extends: ["airbnb", "airbnb-typescript", "airbnb/hooks", "prettier"],
  plugins: ["prettier"],
  rules: {
    "import/prefer-default-export": "off",
    "import/no-cycle": "off",
    "react/jsx-props-no-spreading": "off", // some Mantine components need to use spread operator
    "react-hooks/exhaustive-deps": "off", // at this stage it is too risky to enable this
  },
  parserOptions: {
    project: "./tsconfig.eslint.json",
    tsconfigRootDir: __dirname,
  },
};
