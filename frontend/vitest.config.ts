import { defineConfig } from 'vitest/config';

// Pure logic is unit-tested in a Node environment (no DOM needed):
// authLogic.ts has zero browser dependencies. WebAuthn / React live
// elsewhere and are not part of the vitest surface.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
