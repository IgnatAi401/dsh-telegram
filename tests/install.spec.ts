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
  const env = { ...process.env, DSH_HOME: home, DSH_TELEGRAM_DSH: fake }
  const run = (...args: string[]) => execFileSync('bash', [installer, ...args], { env, encoding: 'utf8' })
  const recorded = (): string[][] => existsSync(calls)
    ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : []
  return { home, env, run, recorded }
}

describe('install.sh', () => {
  it('installs the checkout through dsh plugin add and removes it through dsh plugin remove', () => {
    const { run, recorded } = fixture()
    run()
    expect(recorded()).toEqual([['plugin', '--profile', 'web', 'add', `file:${root.replace(/\/$/, '')}`]])
    run('uninstall')
    expect(recorded().at(-1)).toEqual(['plugin', '--profile', 'web', 'remove', 'dsh-telegram'])
    run('uninstall')
    expect(recorded()).toHaveLength(2)
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

  it('installs the GitHub repository when piped through stdin', () => {
    const { env, recorded } = fixture()
    const result = spawnSync('bash', ['-s', '--', 'install'], { env, input: readFileSync(installer), encoding: 'utf8', cwd: tmpdir() })
    expect(result.status).toBe(0)
    expect(recorded()).toEqual([['plugin', '--profile', 'web', 'add', 'github:IgnatAy/dsh-telegram']])
  })
})
