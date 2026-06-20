import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    conditions: ['browser']
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // ponytail: run runtime specs in Vitest directly; wrapper subprocesses were unnecessary and NixOS-host brittle.
    include: [
      'src/**/*.test.ts',
      'src/**/*.vitest.ts',
      'tests/runtime/**/*.behavior.vitest.ts',
      'tests/runtime/**/*.runtime.vitest.ts'
    ]
  }
})
