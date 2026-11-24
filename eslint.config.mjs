import antfu from '@antfu/eslint-config';
import nextPlugin from '@next/eslint-plugin-next';
import jestDom from 'eslint-plugin-jest-dom';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import playwright from 'eslint-plugin-playwright';
import testingLibrary from 'eslint-plugin-testing-library';

export default antfu({
  react: true,
  typescript: true,

  lessOpinionated: true,
  isInEditor: false,

  stylistic: {
    semi: true,
  },

  formatters: {
    css: true,
  },

  ignores: [
    // The Go server: only its scripts/ are JavaScript.
    'apps/server/!(scripts)/**',
    'apps/client/dist/**',
    'packages/db/seed/*.json',
    'packages/locales/**',
    '**/.turbo/**',
  ],
}, jsxA11y.flatConfigs.recommended, {
  plugins: {
    '@next/next': nextPlugin,
  },
  rules: {
    ...nextPlugin.configs.recommended.rules,
    ...nextPlugin.configs['core-web-vitals'].rules,
    // The SPA has no pages/ directory for this rule to read.
    '@next/next/no-html-link-for-pages': 'off',
  },
}, {
  files: [
    '**/*.test.ts?(x)',
  ],
  ...testingLibrary.configs['flat/react'],
  ...jestDom.configs['flat/recommended'],
}, {
  // Seed scripts report progress on the console, like scripts/ elsewhere.
  files: ['packages/db/seed/**', 'apps/e2e/seeds/**'],
  rules: { 'no-console': 'off' },
}, {
  files: [
    '**/*.spec.ts',
    '**/*.e2e.ts',
  ],
  ...playwright.configs['flat/recommended'],
}, {
  rules: {
    'import/order': 'off', // Avoid conflicts with antfu's perfectionist preset
    'sort-imports': 'off', // Avoid conflicts with antfu's perfectionist preset
    'style/brace-style': ['error', '1tbs'], // Use the default brace style
    'ts/consistent-type-definitions': ['error', 'type'], // Use `type` instead of `interface`
    'react/prefer-destructuring-assignment': 'off', // Vscode doesn't support automatically destructuring, it's a pain to add a new variable
    'node/prefer-global/process': 'off', // Allow using `process.env`
    'test/padding-around-all': 'error', // Add padding in test files
    'test/prefer-lowercase-title': 'off', // Allow using uppercase titles in test titles
    // The strictness step-up in @eslint-react v5 fires on patterns that are
    // currently safe in this codebase. Downgrade to warning until we revisit.
    'react/static-components': 'warn',
    'react/unsupported-syntax': 'warn',
    'antfu/no-top-level-await': 'off',
  },
});
