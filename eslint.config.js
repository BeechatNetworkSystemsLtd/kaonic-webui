import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    rules: {
      // Features talk to the hub through `@/api` only, never to a concrete
      // implementation. This keeps the transport swappable.
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/api/mock/*', '@/api/http*'], message: 'Import from "@/api" instead.' }] },
      ],
    },
  },
  { files: ['src/api/**'], rules: { 'no-restricted-imports': 'off' } },
);
