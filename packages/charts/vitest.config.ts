import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Node 25+ enables Web Storage by default; its `localStorage` global is
    // undefined without --localstorage-file and shadows jsdom's (vitest 4
    // never overrides existing globals). The long flag name is accepted from
    // Node 22.4 on (a no-op before 25); `--no-webstorage` is 25+ only.
    // Drop this once on vitest 5, which overrides the storage globals itself.
    execArgv: ['--no-experimental-webstorage'],
  },
});
