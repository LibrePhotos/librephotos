module.exports = {
  env: {
    browser: true,
    node: true,
    jest: true,
  },
  extends: ["airbnb", "airbnb-typescript", "airbnb/hooks", "prettier"],
  plugins: ["prettier"],
  rules: {
    "no-param-reassign": "warn",
    "import/prefer-default-export": "off",
    "import/no-cycle": "warn",
    "react/prop-types": "warn",
    "react/jsx-props-no-spreading": "off", // some Mantine components need to use spread operator
    "react-hooks/exhaustive-deps": "off", // at this stage it is too risky to enable this
    "react/require-default-props": "warn",
  },
  parserOptions: {
    project: "./tsconfig.eslint.json",
  },
};
