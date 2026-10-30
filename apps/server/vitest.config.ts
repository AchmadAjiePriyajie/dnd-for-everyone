import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Nest membutuhkan legacy decorators + emitDecoratorMetadata; esbuild bawaan Vite
// tidak memancarkan metadata, jadi transform memakai SWC (recipe Nest Vitest/SWC).
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    name: 'server',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
