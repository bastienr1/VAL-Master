/**
 * `npm run replay:ingest -- <match-id>` or `npm run replay:ingest -- --all`
 *
 * A thin launcher for `scripts/replay/ingest.py`. The replay pipeline is Python
 * (duckdb, plus vrfkit's own tools) and runs from the virtual environment in
 * the replay data folder, which lives outside the repo. This finds that
 * environment from `VAL_REPLAY_HOME` so the command is the same on any machine
 * and nobody has to type a path into it.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireEnv } from './env'

const home = requireEnv(
  'VAL_REPLAY_HOME',
  'Set it in .env.local to the replay data folder (see scripts/replay/README.md).',
)
const python = join(home, '.venv', 'Scripts', 'python.exe')
if (!existsSync(python)) {
  console.error(`No Python environment at ${python}. See "One-time setup" in scripts/replay/README.md.`)
  process.exit(1)
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Give a match id, or --all for every saved replay that has no bundle yet.')
  process.exit(1)
}

const run = spawnSync(python, [join('scripts', 'replay', 'ingest.py'), ...args], { stdio: 'inherit' })
process.exit(run.status ?? 1)
