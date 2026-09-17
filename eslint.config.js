import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'dist-server/**', '.cache/**', '.npm-cache/**', '.tools/**', 'test-results/**', 'playwright-report/**'] },
  { files: ['public/lease-tracker.scriptable.js'], languageOptions: { globals: Object.fromEntries(['FileManager', 'Keychain', 'Alert', 'Request', 'Color', 'Font', 'ListWidget', 'Script', 'config'].map(name => [name, 'readonly'])) } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { '@typescript-eslint/no-explicit-any': 'error', '@typescript-eslint/consistent-type-imports': 'error' } },
);
