# Replay scripts

Turn a VALORANT `.vrf` replay into the minimap bundle the app loads
(`minimap.v1.json.gz`, schema in `src/lib/replayBundle.ts`).

The code is here. The data is not: replays, exports, the Python environment and
the vrfkit binary live in a folder outside the repo and never go into git.

## One-time setup

1. A data folder (`VAL_REPLAY_HOME`) holding:
   - `bin\vrfkit.exe` — a release from https://github.com/valorant-valytic/vrfkit/releases (check its SHA-256)
   - `.venv` — `python -m venv .venv`, then `pip install -r scripts\replay\requirements.txt`
   - `raw\`, `exports\`, `cache\` — created as needed
2. A clone of vrfkit **at the tag matching the binary**, for its `tools\` scripts.
3. In the repo's `.env.local`:

   ```
   VAL_REPLAY_HOME=D:\path\to\replay-data
   VAL_REPLAY_ME=<your PUUID>                    # several accounts: separate them with commas
   # optional
   VAL_REPLAY_VRFKIT=D:\path\to\vrfkit          # default: "vrfkit" next to VAL_REPLAY_HOME
   VAL_REPLAY_VRFKIT_REF=v13.06.0 (256c30b)     # default: the clone's short commit
   ```

## Every saved replay

```
npm run replay:ingest -- --all
```

Converts every replay in `%LOCALAPPDATA%\VALORANT\Saved\Demos` that has no
bundle yet, newest first (about 10 s each). The game's files are read in place
and never changed. Run it again after playing: only the new matches are done.

A replay that cannot be converted is reported and skipped, and a note
(`ingest-failed.txt`) keeps the next run from trying it again. Typical reasons:
a game build vrfkit does not support yet, a match none of the `VAL_REPLAY_ME`
accounts played in. After a vrfkit update, `--retry-failed` tries those again.
`--force` redoes everything, `--limit N` stops after N, `--keep-exports` keeps
each match's full ~70 MB export (deleted otherwise).

Then, in the app: **Match Library -> Link replay folder**, and pick
`<VAL_REPLAY_HOME>\exports`. Every bundle whose match is in the library is
attached, and the card gets a "Map" badge. A replay converted again with a
different result replaces the stored bundle. The folder stays linked (Chrome and
Edge only), so later a visit to the library attaches whatever is new.

## One match

```
npm run replay:ingest -- <match-id>
```

The match id is the replay's file name in `%LOCALAPPDATA%\VALORANT\Saved\Demos`.
The script copies the replay, validates and exports it with vrfkit, reduces it,
and runs Gate 2, keeping the full export for inspection. The resulting
`exports\<first 8 of id>-derived\minimap.v1.json.gz` is picked up by the linked
folder, or can be attached by hand on the match's VOD review page ("Attach
replay data").

Both commands start `scripts\replay\ingest.py` with the Python environment in
`VAL_REPLAY_HOME`.

## The pieces

| Script | Does |
|---|---|
| `ingest.py` | The whole pipeline, for one match or for every saved replay |
| `vrf_to_minimap.py` | vrfkit export → bundle. Deterministic: the same export gives the same bytes |
| `gate1_check.py` | Checks an export against known numbers (two reference matches only) |
| `gate2_check.py` | Checks a bundle, optionally against a cached Henrik match |
| `fetch_henrik.py` | Caches a Henrik v2 match for that cross-check |
| `_env.py` | Reads the settings above |

A new game patch needs a vrfkit release that supports it. Until then `validate`
reports transform failures and `ingest.py` skips that replay.

A bundle is kept only if Gate 2 passes. One that fails is renamed
`minimap.v1.json.gz.rejected`, which the app does not pick up.

Design, schema and verification results are in the vault:
`Projects/Valorant Performance Hub/VAL-Master-Replay-Engine/`.
