import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: resolve(import.meta.dirname, 'tsconfig.build.json'),
      entryRoot: resolve(import.meta.dirname, 'src'),
      // One declaration file: no relative imports, so `nodenext` consumers resolve it too.
      bundleTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: { index: resolve(import.meta.dirname, 'src/index.ts') },
      formats: ['es', 'cjs'],
      fileName: (format, entryAlias) => `${entryAlias}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    minify: false,
    sourcemap: true,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  },
})
