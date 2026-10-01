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
   VAL_REPLAY_ME=<your PUUID>
   # optional
   VAL_REPLAY_VRFKIT=D:\path\to\vrfkit          # default: "vrfkit" next to VAL_REPLAY_HOME
   VAL_REPLAY_VRFKIT_REF=v13.06.0 (256c30b)     # default: the clone's short commit
   ```

## One match

```
<VAL_REPLAY_HOME>\.venv\Scripts\python scripts\replay\ingest.py <match-id>
```

The match id is the replay's file name in `%LOCALAPPDATA%\VALORANT\Saved\Demos`.
The script copies the replay, validates and exports it with vrfkit, reduces it,
and runs Gate 2. Then attach the resulting
`exports\<first 8 of id>-derived\minimap.v1.json.gz` on the match's VOD review
page ("Attach replay data").

## The pieces

| Script | Does |
|---|---|
| `ingest.py` | The whole pipeline for one match |
| `vrf_to_minimap.py` | vrfkit export → bundle. Deterministic: the same export gives the same bytes |
| `gate1_check.py` | Checks an export against known numbers (two reference matches only) |
| `gate2_check.py` | Checks a bundle, optionally against a cached Henrik match |
| `fetch_henrik.py` | Caches a Henrik v2 match for that cross-check |
| `_env.py` | Reads the settings above |

A new game patch needs a vrfkit release that supports it. Until then `validate`
reports transform failures and `ingest.py` stops there.

Design, schema and verification results are in the vault:
`Projects/Valorant Performance Hub/VAL-Master-Replay-Engine/`.
