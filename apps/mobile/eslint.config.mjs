import js from '@eslint/js'
import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import prettier from 'eslint-plugin-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// Aligned with apps/frontend/eslint.config.mjs — same React/TypeScript stack, so
// the same lean, modern rule set applies (no legacy prop-types rules). Formatting
// stays mobile-specific via .prettierrc.js (single quotes, no semicolons).
export default [
  {
    ignores: [
      '**/eslint.config.mjs',
      '**/.prettierrc.js',
      '**/babel.config.js',
      '**/metro.config.js',
      '**/jest.setup.js',
      '**/jsconfig.js',
      'node_modules/*',
      'android/*',
      'ios/*',
      '**/dist/*',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      prettier,
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
    },

    languageOptions: {
      parser: tsparser,
      globals: {
        ...globals.node,
        ...globals.jest,
        __DEV__: 'readonly',
      },

      ecmaVersion: 'latest',
      sourceType: 'module',

      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },

    settings: {
      react: {
        version: 'detect',
      },
    },

    rules: {
      // Prettier integration (reads .prettierrc.js)
      'prettier/prettier': 'error',

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],

      // React rules
      'react/react-in-jsx-scope': 'off',
      'react/jsx-boolean-value': 'off',
      'react/jsx-props-no-spreading': 'off',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'off',

      // General rules
      'no-nested-ternary': 'off',
      'no-unused-vars': 'off', // handled by @typescript-eslint/no-unused-vars
      'no-redeclare': 'off', // handled by TypeScript
      'no-undef': 'off', // handled by TypeScript compiler
    },
  },
]
