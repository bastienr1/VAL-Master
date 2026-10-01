"""Fetch a match from the Henrik v2 endpoint and cache it for cross-checks.

Usage: python fetch_henrik.py <match-id>

Reads VITE_HENRIK_API_KEY from the repo's .env.local, as the app does. The key is never printed.
The response is cached in <VAL_REPLAY_HOME>/cache so a match is fetched once.
"""
import json
import sys
import urllib.error
import urllib.request

import _env

CACHE = _env.cache_dir()


def api_key():
    return _env.setting("VITE_HENRIK_API_KEY", "Expected in .env.local alongside the app config.")


def main():
    match_id = sys.argv[1]
    target = CACHE / f"henrik-v2-{match_id}.json"
    if not target.exists():
        request = urllib.request.Request(
            f"https://api.henrikdev.xyz/valorant/v2/match/{match_id}",
            headers={"Authorization": api_key(), "User-Agent": "val-master-replay-engine"})
        try:
            body = urllib.request.urlopen(request, timeout=60).read()
        except urllib.error.HTTPError as error:
            sys.exit(f"Henrik API error {error.code}: {error.read()[:300]!r}")
        CACHE.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    data = json.loads(target.read_text(encoding="utf-8"))["data"]
    print("cached at", target)
    print("top-level keys:", sorted(data))
    meta = data["metadata"]
    print("metadata:", {k: meta.get(k) for k in ("map", "game_version", "game_length", "game_start", "rounds_played", "mode")})
    print("players:", [(p["name"], p["character"], p["team"], p["puuid"][:13]) for p in data["players"]["all_players"]])
    print("teams:", {k: {kk: v.get(kk) for kk in ("has_won", "rounds_won", "rounds_lost")} for k, v in data["teams"].items()})
    print("kills:", len(data.get("kills", [])))
    if data.get("kills"):
        print("kill[0]:", json.dumps({k: v for k, v in data["kills"][0].items() if k != "player_locations_on_kill"})[:900])
        print("kill[0] locations sample:", json.dumps(data["kills"][0].get("player_locations_on_kill", [])[:2])[:500])
    r0 = data["rounds"][0]
    print("round[0] keys:", sorted(r0))
    print("round[0] plant/defuse:", json.dumps(r0.get("plant_events"))[:400], json.dumps(r0.get("defuse_events"))[:200])


if __name__ == "__main__":
    main()
