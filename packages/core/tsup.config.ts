import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node18',
    splitting: false,
    minify: false,
  },
  {
    entry: ['src/cli.ts'],
    format: ['cjs', 'esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node18',
    splitting: false,
    minify: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
  }
]);
