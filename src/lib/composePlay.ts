/**
 * Client for the `compose-play` Edge Function (docs/plays-designer.md §5):
 * sends a brief, gets a play document back, checked by `parsePlayDoc`.
 *
 * Every failure is thrown as an Error whose message is one sentence the page
 * can show as is. `ComposerNotConfiguredError` means the function answered
 * that ANTHROPIC_API_KEY is missing, so the page can say so differently.
 */

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { parsePlayDoc, PlayDocError, type PlayDoc } from './playDoc'
import type { PlaySide } from './types'

export interface ComposePlayInput {
  map: string
  side: PlaySide
  brief: string
  comp?: string[]
  /** Callout names for the map (`GameMap.callouts[].name`): the only places the composer may use. */
  callouts: string[]
  /** The current play when recomposing, so dragged positions and phase ids are kept. */
  previous?: PlayDoc | null
}

/** The sentence the function answers with when its secret is missing (HTTP 503). */
export const COMPOSER_NOT_CONFIGURED =
  'The composer is not set up: add ANTHROPIC_API_KEY to the Edge Function secrets.'

/** The composer's secret is missing; the message is `COMPOSER_NOT_CONFIGURED`. */
export class ComposerNotConfiguredError extends Error {
  constructor(message: string = COMPOSER_NOT_CONFIGURED) {
    super(message)
    this.name = 'ComposerNotConfiguredError'
  }
}

/** Any other compose failure; the message is meant for the user. */
export class ComposeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComposeError'
  }
}

/** The `error` sentence of a non-2xx answer, or null when the body has none. */
async function serverSentence(response: unknown): Promise<string | null> {
  if (!(response instanceof Response)) return null
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const error = (body as { error: unknown }).error
      if (typeof error === 'string' && error.trim()) return error.trim()
    }
  } catch {
    // Not JSON: the platform answered, not the function.
  }
  return null
}

async function toComposeError(error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as unknown
    const status = response instanceof Response ? response.status : 0
    const sentence = await serverSentence(response)
    // Only the function's own 503 means the secret is missing; a platform 503
    // (the function failed to boot) carries another body.
    if (status === 503 && sentence === COMPOSER_NOT_CONFIGURED) return new ComposerNotConfiguredError(sentence)
    if (sentence) return new ComposeError(sentence)
    if (status === 401) return new ComposeError('Sign in again to compose a play.')
    return new ComposeError(`The composer failed (HTTP ${status || 'error'}); try again.`)
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    return new ComposeError('Could not reach the composer; check your connection and try again.')
  }
  return new ComposeError('The composer failed; try again.')
}

/**
 * Composes a play from a brief. Resolves with the parsed play and the model
 * that wrote it; rejects with `ComposerNotConfiguredError` or `ComposeError`.
 */
export async function composePlay(input: ComposePlayInput): Promise<{ play: PlayDoc; model: string }> {
  const { data, error } = await supabase.functions.invoke<{ play?: unknown; model?: unknown }>('compose-play', {
    body: input,
  })
  if (error) {
    console.error('composePlay failed', error)
    throw await toComposeError(error)
  }
  if (!data || data.play === undefined) throw new ComposeError('The composer answered without a play; try again.')

  let play: PlayDoc
  try {
    play = parsePlayDoc(data.play)
  } catch (e) {
    if (e instanceof PlayDocError) throw new ComposeError(e.message)
    throw e
  }
  return { play, model: typeof data.model === 'string' ? data.model : '' }
}
