import jest from 'eslint-plugin-jest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { fixupConfigRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import babelParser from '@typescript-eslint/parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  ...fixupConfigRules(compat.extends('@react-native')),
  {
    settings: {
      'import/resolver': {
        'babel-module': {},
      },
    },
    languageOptions: {
      parser: babelParser,
      globals: {
        ...jest.environments.globals.globals,
      },
    },
    ignores: ['.eslint.config.mjs'],
    rules: {
      semi: ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'react/require-default-props': ['error'],
      'react/default-props-match-prop-types': ['error'],
      'react/sort-prop-types': ['error'],

      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],
    },
  },
]
