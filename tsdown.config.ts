/**
 * Bundles the browser half (src/client) into lib/browser/client.js in the format DSH's
 * client module system loads: a script that hands `window.__ModuleLoader__` a
 * `factory(require)` closure over a CommonJS body. This mirrors the essentials
 * of DSH's own `clientBundle` preset (packages/client/tsdown.client.ts), which
 * is not published: the shell's shared modules stay `require`d from its module
 * table, everything else is inlined, and any other `@deepseek-ai/*` value
 * import is a build error, since a plugin must reach other plugins only
 * through injected services and slots.
 */
import { defineConfig } from 'tsdown'

const ID = 'dsh-telegram'

/** The shell's shared module table (`PLATFORM_MODULES` in DSH's packages/client/web/src/platform.ts). */
const PLATFORM_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  tsconfig: 'tsconfig.client.json',
  // Its own directory: lib/client.js is the host's Telegram API client, and the host build runs first.
  outDir: 'lib/browser',
  clean: false,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: (specifier: string) => PLATFORM_MODULES.has(specifier),
    alwaysBundle: (specifier: string) => !PLATFORM_MODULES.has(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  plugins: [{
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (source.startsWith('@deepseek-ai/') && !PLATFORM_MODULES.has(source)) {
        throw new Error(`client bundle purity: "${source}" is not a shared shell module; reach other plugins through injected services or use \`import type\``)
      }
      return null
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
