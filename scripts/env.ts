/**
 * Minimal `.env` reader for the dev-machine scripts.
 *
 * Avoids a `dotenv` dependency for scripts that run a handful of times — the
 * same no-new-deps line that keeps `npm test` on Node's built-in runner. Lifted
 * out of `seedProStudy.ts` when the guide importer needed the same loader.
 */

import { readFileSync } from 'node:fs'

/** Later files win, so `.env` overrides `.env.local`. */
export function loadEnvFiles(files: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const file of files) {
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue // absent file is fine — the var may come from the real environment
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      if (quoted) value = value.slice(1, -1)
      env[key] = value
    }
  }
  return env
}

const fileEnv = loadEnvFiles(['.env.local', '.env'])

/** A real environment variable wins over one from a file. */
export function env(name: string): string | undefined {
  return process.env[name] ?? fileEnv[name]
}

/** Exits with a hint rather than failing deep inside a client constructor. */
export function requireEnv(name: string, hint: string): string {
  const value = env(name)
  if (!value) {
    console.error(`Missing ${name}. ${hint}`)
    process.exit(1)
  }
  return value
}
