import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const browserStub = fileURLToPath(new URL('./tests/fixtures/browser-stub.ts', import.meta.url))

export default defineConfig({
  // The published DSH client bundles point at source maps they do not ship; vite warns on each load.
  logLevel: 'error',
  resolve: {
    // The published ui-primitives bundle leaves its browser libraries to the DSH shell; the browser
    // half's tests use only its settings form model, so the rest resolve to an empty module.
    alias: [{
      find: /^(clsx|anser|diff|katex(\/.*)?|simple-icons|react-dom(\/.*)?|shiki(\/.*)?|@shikijs\/.*|mdast-util-.*|micromark-.*|@deepseek-ai\/dsh-util-.*)$/,
      replacement: browserStub,
    }],
  },
  test: {
    server: { deps: { inline: [/@deepseek-ai\/dsh-client-(ui-primitives|store)/] } },
  },
})
