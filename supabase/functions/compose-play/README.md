# compose-play

Supabase Edge Function behind the Plays composer (`docs/plays-designer.md` §5).
It turns a written brief into a play document (`PlayDoc`, `src/lib/playDoc.ts`)
by calling Claude (`claude-opus-5-5`) with structured outputs. The browser calls
it through `src/lib/composePlay.ts`, which runs the result through `parsePlayDoc`.

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
  callouts: string[]             // the map's callout names; non-empty, first 80 used
  previous?: PlayDoc | null      // the current play when recomposing
}
```

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
    "callouts": ["A Main", "A Site", "A Heaven", "A Tree", "A Lobby", "Mid Catwalk", "Attacker Side Spawn", "Defender Side Spawn"]
  }'
```
