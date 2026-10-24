import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const installer = join(root, 'install.sh')
const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

const LEGACY_BLOCK = [
  '# telegram plugin begin (managed by scripts/install-copy.sh)',
  '- insert:',
  '    - id: telegram',
  "      name: 'dsh-telegram'",
  '# telegram plugin end (managed by scripts/install-copy.sh)',
].join('\n')

/** A fake `dsh` that records its argv and emulates `plugin add/remove` on the profile manifest. */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'telegram-install-'))
  homes.push(home)
  const calls = join(home, 'calls.log')
  const fake = join(home, 'fake-dsh')
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + '\\n')
const manifest = ${JSON.stringify(join(home, 'profiles'))} + '/' + args[2] + '/package.json'
const value = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : { dependencies: {} }
if (args[3] === 'add') value.dependencies['dsh-telegram'] = args[4]
if (args[3] === 'remove') delete value.dependencies[args[4]]
fs.mkdirSync(require('node:path').dirname(manifest), { recursive: true })
fs.writeFileSync(manifest, JSON.stringify(value))
`)
  chmodSync(fake, 0o755)
  // An empty app folder keeps the Desktop app installed on the test machine out of detection.
  const env = { ...process.env, DSH_HOME: home, DSH_TELEGRAM_DSH: fake, DSH_TELEGRAM_APP_DIRS: home }
  const run = (...args: string[]) => execFileSync('bash', [installer, ...args], { env, encoding: 'utf8' })
  const recorded = (): string[][] => existsSync(calls)
    ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : []
  return { home, env, run, recorded }
}

// install.sh targets Linux / macOS; Windows uses DSH's own command (see README).
describe.skipIf(process.platform === 'win32')('install.sh', () => {
  it('installs the checkout through dsh plugin add and removes it through dsh plugin remove', () => {
    const { run, recorded } = fixture()
    run()
    expect(recorded()).toEqual([['plugin', '--profile', 'web', 'add', `file:${root.replace(/\/$/, '')}`]])
    // pnpm would report the same `file:` spec as up to date, so a reinstall replaces the copy.
    run()
    expect(recorded().slice(1)).toEqual([
      ['plugin', '--profile', 'web', 'remove', 'dsh-telegram'],
      ['plugin', '--profile', 'web', 'add', `file:${root.replace(/\/$/, '')}`],
    ])
    run('uninstall')
    expect(recorded().at(-1)).toEqual(['plugin', '--profile', 'web', 'remove', 'dsh-telegram'])
    run('uninstall')
    expect(recorded()).toHaveLength(4)
  })

  it('removes a 0.2.x copy installation while keeping unrelated profile settings', () => {
    const { home, run } = fixture()
    const profile = join(home, 'profiles/custom')
    mkdirSync(join(profile, 'node_modules/dsh-telegram/lib'), { recursive: true })
    writeFileSync(join(profile, 'package.json'), '{"private":true,"dependencies":{}}')
    const custom = '- id: tools\n  config:\n    mode: native\n'
    writeFileSync(join(profile, 'cordis.patch.yml'), `${custom}\n${LEGACY_BLOCK}\n`)
    run('install', 'custom')
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').trim()).toBe(custom.trim())
    expect(existsSync(join(profile, 'node_modules/dsh-telegram'))).toBe(false)
  })

  it('leaves a valid patch file when the legacy block was its only content', () => {
    const { home, run } = fixture()
    const profile = join(home, 'profiles/web')
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'cordis.patch.yml'), `${LEGACY_BLOCK}\n`)
    run('uninstall')
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').trim()).toBe('[]')
  })

  it('rejects invalid actions and profile names before running dsh', () => {
    const { env, recorded } = fixture()
    for (const args of [['upgrade'], ['install', '../web'], ['install', 'node_modules'], ['install', 'web', 'extra']]) {
      const result = spawnSync('bash', [installer, ...args], { env, encoding: 'utf8' })
      expect(result.status).toBe(2)
    }
    expect(recorded()).toEqual([])
  })

  /** A Desktop sandbox: fake dsh, pgrep, osascript, open and uname on a PATH without Node.js or pnpm. */
  function desktopFixture(platform: string) {
    const { home } = fixture()
    const bin = join(home, 'bin')
    mkdirSync(bin)
    const calls = join(home, 'desktop-calls.log')
    const quit = join(home, 'quit')
    const script = (name: string, body: string) => {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`)
      chmodSync(join(bin, name), 0o755)
    }
    script('fake-dsh', `echo "$@" >> '${calls}'`)
    // Running until the fake osascript asks the app to quit, unless STUCK keeps it open.
    script('pgrep', `[ -n "$RUNNING" ] && { [ -n "$STUCK" ] || [ ! -e '${quit}' ]; }`)
    script('osascript', `touch '${quit}'`)
    script('open', `echo "open $@" >> '${calls}'`)
    script('uname', `echo ${platform}`)
    script('sleep', 'exit 0')
    const env = {
      HOME: home, DSH_HOME: home, PATH: `${bin}:/usr/bin:/bin`, DSH_TELEGRAM_DSH: join(bin, 'fake-dsh'), DSH_TELEGRAM_APP_DIRS: home,
    }
    const install = (extra: Record<string, string> = {}) =>
      spawnSync('/bin/bash', [installer, 'install', 'desktop'], { env: { ...env, ...extra }, encoding: 'utf8' })
    const recorded = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : []
    return { install, recorded }
  }

  it('manages the desktop profile without Node.js', () => {
    const { install, recorded } = desktopFixture('Linux')
    const result = install()
    expect(result.status).toBe(0)
    expect(recorded()).toEqual([`plugin --profile desktop add file:${root.replace(/\/$/, '')}`])
    expect(result.stdout).toContain('open DeepSeek Harness Desktop')
  })

  it('quits a running Desktop on macOS and reopens it after installing', () => {
    const { install, recorded } = desktopFixture('Darwin')
    const result = install({ RUNNING: '1' })
    expect(result.status).toBe(0)
    expect(recorded()).toEqual([`plugin --profile desktop add file:${root.replace(/\/$/, '')}`, 'open -a DeepSeek Harness'])
  })

  it('refuses while Desktop keeps running', () => {
    for (const [platform, stuck] of [['Linux', ''], ['Darwin', '1']]) {
      const { install, recorded } = desktopFixture(platform!)
      expect(install({ RUNNING: '1', STUCK: stuck! }).status).toBe(1)
      expect(recorded()).toEqual([])
    }
  })

  it('finds both Desktop and the command-line profile when no profile is named', () => {
    const { home, recorded } = fixture()
    const app = join(home, 'DeepSeek Harness.app/Contents/Resources/runtime/cli/bin')
    mkdirSync(app, { recursive: true })
    writeFileSync(join(app, 'dsh'), '#!/bin/sh\n')
    chmodSync(join(app, 'dsh'), 0o755)
    mkdirSync(join(home, 'profiles/web'), { recursive: true })
    const bin = join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'pgrep'), 0o755)
    execFileSync('bash', [installer], { env: { ...process.env, DSH_HOME: home, DSH_TELEGRAM_DSH: join(home, 'fake-dsh'), DSH_TELEGRAM_APP_DIRS: home, PATH: `${bin}:${process.env.PATH}` } })
    expect(recorded().map(call => call.slice(0, 4))).toEqual([
      ['plugin', '--profile', 'desktop', 'add'],
      ['plugin', '--profile', 'web', 'add'],
    ])
  })

  it('drops the settings row the Plugins page saved when uninstalling', () => {
    const { home, run } = fixture()
    const profile = join(home, 'profiles/web')
    run()
    const custom = '- id: web\n  name: "@deepseek-ai/dsh-web"\n  config:\n    searchProvider: x\n'
    const settings = '- id: telegram\n  name: dsh-telegram\n  config:\n    token: "1:secret"\n    allowedUserIds:\n      - 1\n'
    writeFileSync(join(profile, 'cordis.patch.yml'), `${custom}${settings}`)
    run('uninstall')
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')).toBe(custom)
    writeFileSync(join(profile, 'cordis.patch.yml'), settings)
    run('uninstall')
    expect(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').trim()).toBe('[]')
  })

  it('installs the GitHub repository when piped through stdin', () => {
    const { env, recorded } = fixture()
    const result = spawnSync('bash', ['-s', '--', 'install'], { env, input: readFileSync(installer), encoding: 'utf8', cwd: tmpdir() })
    expect(result.status).toBe(0)
    expect(recorded()).toEqual([['plugin', '--profile', 'web', 'add', 'github:IgnatAi401/dsh-telegram']])
  })
})
