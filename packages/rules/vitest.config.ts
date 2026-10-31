import { defineConfig } from 'vitest/config';

// Paket murni (tanpa Nest/React): environment Node biasa.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    name: 'rules',
    root: import.meta.dirname,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
