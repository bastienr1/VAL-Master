# compose-play

Supabase Edge Function behind the Plays composer (`docs/plays-editor-v2.md` §5).
It turns a written brief into a version 2 play document (`PlayDoc`,
`src/lib/playDoc.ts`) by calling Claude (`claude-opus-5-5`) with structured
outputs. The browser calls it through `src/lib/composePlay.ts`, which runs the
result through `parsePlayDoc`; that is where element ids are assigned (the
output schema has no `id`).

## Deploy

The project has no Supabase CLI link, so deploy from the dashboard or the Supabase MCP:

- **Dashboard:** Edge Functions → Deploy a new function → name it `compose-play`,
  paste `index.ts`, keep **Verify JWT** on.
- **MCP:** `deploy_edge_function` with `name: "compose-play"`, `entrypoint_path: "index.ts"`,
  `verify_jwt: true` and the one file `index.ts`.

No import map is needed: dependencies are `npm:` specifiers pinned in the file
(`@anthropic-ai/sdk@1.3.0`, `@supabase/supabase-js@2`).

## Secret

Add `ANTHROPIC_API_KEY` under Edge Functions → Secrets (or MCP
`create_edge_function_secret`). Without it the function answers 503 with
`"The composer is not set up: add ANTHROPIC_API_KEY to the Edge Function secrets."`,
which the client turns into `ComposerNotConfiguredError`.
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided by the platform.

## Contract

`POST /functions/v1/compose-play` with `Authorization: Bearer <user access token>`.

Request body:

```ts
{
  map: string                    // display name, e.g. "Ascent"
  side: 'attack' | 'defense'
  brief: string                  // non-empty, under 6000 characters
  comp?: string[]                // up to 5 agent display names
  abilities?: {                  // the comp's abilities, at most 20 (abilitiesForComp, src/lib/composeAbilities.ts)
    agent: string
    slot: 'Grenade' | 'Ability1' | 'Ability2' | 'Ultimate'   // C, Q, E, X
    name: string                 // "Dark Cover"
    shape: UtilityKind           // smoke | flash | molly | recon | wall | trap | drone | stun | slow | ult | other
  }[]
  callouts: string[]             // the map's callout names; non-empty, first 80 used
  previous?: PlayDoc | null      // the current (v2) play when recomposing
}
```

`abilities` entries must be objects of four strings with a known `slot` and
`shape` (400 otherwise); entries with a blank `agent` or `name` are dropped.
The system prompt lists them under the comp as `Agent · C/Q/E/X · Name → shape`
and tells the model to use only those, by their slot and shape. Without the
list, the model is told to use each agent's real abilities and the nearest shape.

The `play` in a 200 is `PlayDoc` v2 minus element ids, with only the kinds the
composer draws:

```ts
{
  version: 2, summary: string, comp: string[], assumptions: string[],
  steps: {                       // 2 to 10; defaults Setup/Execute/Post-plant (attack), Setup/Hold/Retake (defense)
    id: string, name: string, caption: string,
    elements: (                  // a JSON Schema anyOf, told apart by `kind`
      | { kind: 'agent', agent, team: 'ally', at, moveTo?, via?, note, spike? }   // every comp agent once per step
      | { kind: 'ability', agent, slot, shape, at, from?, label }                // every ability thrown in the step
      | { kind: 'marker', type: 'spike' | 'enemy' | 'pin', at, label? }          // enemies are markers, never named agents
      | { kind: 'text', at, text }                                               // a call tied to a place, rarely
    )[]
  }[]
}
```

Positions (`at`, `moveTo`, `via[]`, `from`) are `{ callout?, toward?, t?, u?, v? }`
with callouts from the request's list. Pen strokes, arrows and colours are the
player's drawing and are never produced here.

Responses (every one carries `Access-Control-Allow-Origin: *`; `OPTIONS` answers the preflight):

| Status | Body | When |
|---|---|---|
| 200 | `{ play: PlayDoc, model: string }` | `model` is the model that answered (`response.model`; a server-side fallback can change it) |
| 400 | `{ error }` | bad input |
| 401 | `{ error }` | no signed-in user |
| 502 | `{ error }` | model or API failure: rate limit, timeout, refusal ("The composer declined this brief; rephrase it."), truncated output ("The play came back incomplete; try a shorter brief.") |
| 503 | `{ error }` | `ANTHROPIC_API_KEY` missing |

The model call: `client.beta.messages.create` with `model: "claude-opus-5-5"`,
`max_tokens: 16000`, `output_config: { effort: "medium", format: { type: "json_schema", schema } }`,
`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`. No `thinking`
(always on for this model), no `temperature`, no `tool_choice`. Raw errors go to
the function logs via `console.error`.

The call can take a minute or more; the SDK timeout is 140 s with one retry,
inside the Edge Function wall-clock limit.

## Example

```bash
curl -i "https://<project-ref>.supabase.co/functions/v1/compose-play" \
  -H "Authorization: Bearer <user access token>" \
  -H "apikey: <anon key>" \
  -H "Content-Type: application/json" \
  -d '{
    "map": "Ascent",
    "side": "attack",
    "brief": "Fast A: Omen smokes Heaven and Tree, Sova darts site, Jett entries through Main, Killjoy watches flank.",
    "comp": ["Jett", "Sova", "Omen", "Killjoy", "KAY/O"],
    "abilities": [
      { "agent": "Omen", "slot": "Ability2", "name": "Dark Cover", "shape": "smoke" },
      { "agent": "Sova", "slot": "Ability2", "name": "Recon Bolt", "shape": "recon" }
    ],
    "callouts": ["A Main", "A Site", "A Heaven", "A Tree", "A Lobby", "Mid Catwalk", "Attacker Side Spawn", "Defender Side Spawn"]
  }'
```
