"""Turn a Henrik record of a free-for-all Deathmatch into a VAL Master minimap bundle (schema 1).

Usage (from the repo root):
    python scripts/replay/henrik_dm_to_minimap.py --match <match-id> [--me <puuid or name#tag>]
        [--region ap] [--raw <cached Henrik json>] [--out-dir <dir>]

Deathmatch leaves no .vrf replay, so vrf_to_minimap.py has nothing to reduce. What Henrik's
v2 match record does carry is, for every kill in the lobby, the position and view direction of
every living player at that instant (`kills[].player_locations_on_kill`). This script builds
the bundle from those samples alone.

Inputs
    --match    the match id
    --me       whose bundle it is (ALLY, `isMe`); everyone else is ENEMY. A PUUID, several
               comma-separated, or a Riot ID `name#tag`. Default: VAL_REPLAY_ME (PUUIDs, as
               for vrf_to_minimap.py); the first one that played this match is used.
    --raw      a saved Henrik response (`GET /valorant/v2/match/<id>`, payload under `data`).
               Without it the match is fetched with VITE_HENRIK_API_KEY from .env.local (never
               printed) and cached as <VAL_REPLAY_HOME>/cache/henrik-v2-<id>.json, the file
               fetch_henrik.py writes; an existing cache is reused.
    --region   only checked against the record's region; the v2 match endpoint does not need it.

Outputs (both in --out-dir when it is given)
    <VAL_REPLAY_HOME>/exports/<first 8 of the id>-derived/minimap.v1.json.gz
        the bundle, serialised and gzipped as vrf_to_minimap.py does
    <VAL_REPLAY_HOME>/exports/<first 8 of the id>-library-row.json
        the match as a flat row of the app's `matches` table (Deathmatch has no rounds: the
        round fields, acs, kpr and dpr are 0; score is "<place>/<players>"; result is W for
        first place, ties at the top included; headshot_pct is a percentage, as henrik.ts writes it)

Map data (uuid, mapUrl) comes from valorant-api.com/v1/maps through the cache vrf_to_minimap.py
keeps (<VAL_REPLAY_HOME>/cache/valorant-api-maps.json), the agent role from
valorant-api.com/v1/agents (not cached).

What the bundle holds
    One round spanning the match: buyStartMs 0, barrierMs when the Deathmatch timer starts
    (kill_time_in_match - kill_time_in_round, constant within a match), endMs = durationMs,
    winner ALLY when the owner has the most kills. Kills with their weapon (cls / name / cat as
    the replay bundles have them for the guns, `Henrik_<Name>` otherwise). Tracks at 10 Hz on
    a grid of whole 100 ms, built life by life:
      - a life's known points are the player's samples at kill events, then the point where they
        died (with their last known view); between two known points the position moves in a
        straight line and the view turns along the shorter arc;
      - after a death the body lies where it fell (alive 0) for 2.7 s, or until the player's next
        sample if that comes sooner, then the track is silent until the next life is first seen;
      - after the last known point of a life that does not end in a death the player stands
        still for 3 s (or until the match ends), then the track goes silent and the app treats
        the player as gone.
    No casts, effects, spike, pawns, kits, vitals or blinds: Henrik has none of it for this mode.

Limits of the data
    - A player is seen only when someone in the lobby dies (here about every 1.3 s). Between two
      kills the route is a straight line, through walls if need be; the real path, strafes and
      peeks are not in the data. A long quiet spell is a long straight line.
    - A player is not seen between respawning and the first kill after it, so each life starts
      late, and nobody is on the map between the timer starting and the first kill.
    - The victim of a kill is not among its sampled players; the death point is Henrik's
      `victim_death_location`. A life with no sample before its death is only its death point,
      facing its killer.
    - No weapon in hand (track `weapon` is null), no health, no utility.
    - `teamName` is null: in Deathmatch every player is their own team.
    - Henrik's per-player stats can differ from its kill events by one (a kill or death it
      counted but did not list); the bundle follows the events, the library row the stats.
"""
import argparse
import gzip
import json
import math
import re
import statistics
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import _env

SCHEMA = 1
REDUCER = "henrik-dm 1.0.0"
BUNDLE_NAME = "minimap.v1.json.gz"
HZ = 10
STEP_MS = 1000 // HZ
# The dead body lies where it fell this long, as a replay body reports for about 2.7 s after a death.
DEAD_TAIL_MS = 2700
# A last life is held this long past its last sample, then the track goes silent.
HOLD_MS = 3000
MAPS_URL = "https://valorant-api.com/v1/maps"
AGENTS_URL = "https://valorant-api.com/v1/agents?isPlayableCharacter=true"
HENRIK_URL = "https://api.henrikdev.xyz/valorant/v2/match/{}"
USER_AGENT = "val-master-replay-engine"
PUUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
AGENT_IN_URL = re.compile(r"/agents/([0-9a-f-]{36})/", re.I)

# Henrik's weapon name -> the weapon entry the replay bundles carry for that gun (vrfkit's
# equippable table, read off the bundles in VAL-Master-Replays/exports on 2026-11-13).
WEAPONS = {
    "Classic": ("BasePistol_C", "sidearm"),
    "Shorty": ("SawedOffShotgun_C", "sidearm"),
    "Frenzy": ("AutomaticPistol_C", "sidearm"),
    "Ghost": ("LugerPistol_C", "sidearm"),
    "Sheriff": ("RevolverPistol_C", "sidearm"),
    "Compact Pistol": ("CompactPistol_C", "sidearm"),
    "Stinger": ("Vector_C", "smg"),
    "Spectre": ("SubMachineGun_MP5_C", "smg"),
    "Bucky": ("PumpShotgun_C", "shotgun"),
    "Judge": ("AutomaticShotgun_C", "shotgun"),
    "Bulldog": ("AssaultRifle_Burst_C", "rifle"),
    "Guardian": ("DMR_C", "rifle"),
    "Phantom": ("AssaultRifle_ACR_C", "rifle"),
    "Vandal": ("AssaultRifle_AK_C", "rifle"),
    "Warden": ("BattleRifle_C", "rifle"),
    "Marshal": ("LeverSniperRifle_C", "sniper_rifle"),
    "Outlaw": ("DS_Gun_C", "sniper_rifle"),
    "Operator": ("BoltSniper_C", "sniper_rifle"),
    "Ares": ("LightMachineGun_C", "machine_gun"),
    "Odin": ("HeavyMachineGun_C", "machine_gun"),
    "Melee": ("Ability_Melee_Base_C", "melee"),
}


def fetch_json(url, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    return json.load(urllib.request.urlopen(request, timeout=60))


def load_henrik(match_id, raw_path):
    """The Henrik payload (`data`): from --raw, else the cache, else the API (then cached)."""
    if raw_path:
        return json.loads(Path(raw_path).read_text(encoding="utf-8"))["data"]
    cache = _env.cache_dir() / f"henrik-v2-{match_id}.json"
    if not cache.exists():
        key = _env.setting("VITE_HENRIK_API_KEY", "Expected in .env.local alongside the app config.")
        request = urllib.request.Request(HENRIK_URL.format(match_id),
                                         headers={"Authorization": key, "User-Agent": USER_AGENT})
        try:
            body = urllib.request.urlopen(request, timeout=60).read()
        except urllib.error.HTTPError as error:
            sys.exit(f"Henrik API error {error.code}: {error.read()[:300]!r}")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(body)
    return json.loads(cache.read_text(encoding="utf-8"))["data"]


def load_maps():
    """valorant-api maps, through the cache vrf_to_minimap.py keeps."""
    cache = _env.cache_dir() / "valorant-api-maps.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    maps = fetch_json(MAPS_URL)["data"]
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(maps), encoding="utf-8")
    return maps


def resolve_me(players, wanted):
    """The owner's PUUID: the first of `wanted` (PUUIDs or name#tag, comma-separated) in the match."""
    by_puuid = {p["puuid"]: p for p in players}
    for item in (part.strip() for part in wanted.split(",")):
        if not item:
            continue
        if PUUID.match(item):
            if item.lower() in by_puuid:
                return item.lower()
        elif "#" in item:
            name, tag = item.rsplit("#", 1)
            for p in players:
                if p["name"].casefold() == name.strip().casefold() and p["tag"].casefold() == tag.strip().casefold():
                    return p["puuid"]
    sys.exit(f"none of {wanted!r} played this match ({len(players)} players): pass --me")


def snap(t):
    """The 100 ms grid time nearest to t (halves go up)."""
    return (t + STEP_MS // 2) // STEP_MS * STEP_MS


def turn(a, b, k):
    """From a to b degrees along the shorter arc, k of the way."""
    return (a + (((b - a + 540) % 360) - 180) * k) % 360


def row(t, x, y, yaw, alive):
    return [t, round(x), round(y), round(yaw) % 360, alive, None]


def build_track(samples, deaths, end_ms, notes):
    """Rows [t, x, y, yaw, alive, weapon] for one player.

    samples: (t, x, y, yaw_deg) at kill events, in time order.
    deaths:  (t, x, y, yaw_if_unseen_deg), in time order.
    """
    lives, i = [], 0
    for t_death, dx, dy, fallback_yaw in deaths:
        points = []
        while i < len(samples) and samples[i][0] <= t_death:
            if samples[i][0] == t_death:
                notes["samples at own death time, dropped"] += 1
            else:
                points.append(samples[i])
            i += 1
        if points:
            yaw = points[-1][3]
        else:
            yaw = fallback_yaw
            notes["lives seen only at their death"] += 1
        points.append((t_death, dx, dy, yaw))
        lives.append((points, True))
    if i < len(samples):
        lives.append((samples[i:], False))

    # Each life's known points on the grid; two in one slot keep the later.
    gridded = []
    for points, died in lives:
        slots = {}
        for t, x, y, yaw in points:
            g = snap(t)
            if g in slots:
                notes["known points sharing a 100 ms slot, earlier dropped"] += 1
            slots[g] = (x, y, yaw)
        gridded.append((sorted(slots.items()), died))

    rows = []
    for n, (known, died) in enumerate(gridded):
        if rows and known[0][0] <= rows[-1][0]:
            dropped = [k for k in known if k[0] <= rows[-1][0]]
            notes["known points overlapping the previous life, dropped"] += len(dropped)
            known = [k for k in known if k[0] > rows[-1][0]]
            if not known:
                continue
        for (g0, (x0, y0, a0)), (g1, (x1, y1, a1)) in zip(known, known[1:]):
            for g in range(g0, g1, STEP_MS):
                k = (g - g0) / (g1 - g0)
                rows.append(row(g, x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, turn(a0, a1, k), 1))
        g_last, (x, y, yaw) = known[-1]
        rows.append(row(g_last, x, y, yaw, 1))
        if died:
            following = next((later[0][0] for later, _ in gridded[n + 1:] if later), math.inf)
            for g in range(g_last + STEP_MS, g_last + DEAD_TAIL_MS + 1, STEP_MS):
                if g >= following or g > end_ms:
                    break
                rows.append(row(g, x, y, yaw, 0))
        else:
            for g in range(g_last + STEP_MS, min(end_ms, g_last + HOLD_MS) + 1, STEP_MS):
                rows.append(row(g, x, y, yaw, 1))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--match", required=True, help="the match id")
    ap.add_argument("--me", help="your PUUID or name#tag (comma-separated for several). Default: VAL_REPLAY_ME")
    ap.add_argument("--region", default="ap", help="checked against the record; the v2 endpoint does not need it")
    ap.add_argument("--raw", type=Path, help="a saved Henrik v2 match response; skips the API")
    ap.add_argument("--out-dir", type=Path, help="default: <VAL_REPLAY_HOME>/exports/<first 8 of the id>-derived")
    args = ap.parse_args()

    match_id = args.match.strip().lower()
    data = load_henrik(match_id, args.raw)
    meta = data["metadata"]
    players_raw = data["players"]["all_players"]
    kills_raw = sorted(data.get("kills") or [], key=lambda k: k["kill_time_in_match"])
    warnings = []

    if (meta.get("matchid") or meta.get("match_id") or "").lower() != match_id:
        sys.exit(f"the record is for match {meta.get('matchid') or meta.get('match_id')}, not {match_id}")
    mode = str(meta.get("mode") or "")
    if mode.lower() != "deathmatch":
        sys.exit(f"this match is {mode or 'of an unknown mode'}, not Deathmatch: use ingest.py with its replay")
    if meta.get("region") and args.region and meta["region"].lower() != args.region.lower():
        warnings.append(f"the record says region {meta['region']}, not {args.region}")
    if not kills_raw:
        sys.exit("the record has no kill events, so no positions")

    me = resolve_me(players_raw, args.me or _env.me())
    subjects = [p["puuid"] for p in players_raw]

    # ---- match ----------------------------------------------------------------------------
    map_field = meta.get("map")
    map_name = map_field.get("name") if isinstance(map_field, dict) else map_field
    map_uuid = map_field.get("id") if isinstance(map_field, dict) else None
    maps = load_maps()
    game_map = next((m for m in maps if map_uuid and m["uuid"].lower() == str(map_uuid).lower()), None) \
        or next((m for m in maps if m["displayName"] == map_name), None)
    if game_map is None:
        sys.exit(f"map {map_name!r} not found on valorant-api.com")
    length = meta.get("game_length") or 0
    duration_ms = int(length * 1000 if length < 100_000 else length)  # v2 gives seconds; some records ms
    last_kill = kills_raw[-1]["kill_time_in_match"]
    if duration_ms < last_kill:
        warnings.append(f"game_length {length} ends before the last kill at {last_kill} ms; durationMs = that kill")
        duration_ms = last_kill
    started = datetime.fromtimestamp(meta["game_start"], tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    match = {
        "matchId": match_id,
        "mapUuid": game_map["uuid"],
        "mapUrl": game_map["mapUrl"],
        "build": meta.get("game_version") or "",
        "recordedAt": started,
        "durationMs": duration_ms,
        "mode": "deathmatch",
    }

    # ---- players --------------------------------------------------------------------------
    def agent_uuid(p):
        found = AGENT_IN_URL.search(((p.get("assets") or {}).get("agent") or {}).get("small") or "")
        return found.group(1).lower() if found else None

    players = [{
        "subject": p["puuid"],
        "agentId": agent_uuid(p),
        "team": "ALLY" if p["puuid"] == me else "ENEMY",
        "teamName": None,
        "body": n,
        "isMe": p["puuid"] == me,
    } for n, p in enumerate(players_raw, 1)]

    # ---- round ----------------------------------------------------------------------------
    offsets = [k["kill_time_in_match"] - k["kill_time_in_round"] for k in kills_raw]
    barrier = int(statistics.median(offsets))
    if len(set(offsets)) > 1:
        warnings.append(f"timer start differs between kills ({min(offsets)}..{max(offsets)} ms); used the median")
    stat_kills = {p["puuid"]: p["stats"]["kills"] for p in players_raw}
    placement = 1 + sum(k > stat_kills[me] for s, k in stat_kills.items() if s != me)
    rounds = [{
        "n": 1, "buyStartMs": 0, "barrierMs": barrier, "endMs": duration_ms, "side": None,
        "winner": "ALLY" if placement == 1 else "ENEMY", "how": "deathmatch", "plant": None, "defuse": None,
    }]

    # ---- weapons and kills ----------------------------------------------------------------
    weapons, weapon_index = [], {}
    for k in kills_raw:
        name = k.get("damage_weapon_name")
        if name and name not in weapon_index:
            cls, cat = WEAPONS.get(name, (f"Henrik_{re.sub(r'[^0-9A-Za-z]+', '', name)}", None))
            if name not in WEAPONS:
                warnings.append(f"weapon {name!r} is not in the table; cls {cls}, cat null")
            weapon_index[name] = len(weapons)
            weapons.append({"cls": cls, "name": name, "cat": cat})

    kills, samples, deaths = [], {s: [] for s in subjects}, {s: [] for s in subjects}
    for k in kills_raw:
        t = k["kill_time_in_match"]
        located = {loc["player_puuid"]: loc for loc in k.get("player_locations_on_kill") or []}
        for subject, loc in located.items():
            if subject in samples and loc.get("location") and loc.get("view_radians") is not None:
                samples[subject].append((t, loc["location"]["x"], loc["location"]["y"],
                                         math.degrees(loc["view_radians"]) % 360))
        killer, victim = k.get("killer_puuid") or None, k.get("victim_puuid") or None
        kloc = (located.get(killer) or {}).get("location")
        vloc = k.get("victim_death_location")
        if victim in deaths and vloc:
            facing = 0.0
            if kloc and (kloc["x"], kloc["y"]) != (vloc["x"], vloc["y"]):
                facing = math.degrees(math.atan2(kloc["y"] - vloc["y"], kloc["x"] - vloc["x"])) % 360
            deaths[victim].append((t, vloc["x"], vloc["y"], facing))
        kills.append({
            "t": t, "round": 1, "killer": killer, "victim": victim,
            "weapon": weapon_index.get(k.get("damage_weapon_name")),
            "kx": kloc["x"] if kloc else None, "ky": kloc["y"] if kloc else None,
            "vx": vloc["x"] if vloc else None, "vy": vloc["y"] if vloc else None,
        })

    # ---- tracks ---------------------------------------------------------------------------
    notes = {key: 0 for key in ("samples at own death time, dropped", "lives seen only at their death",
                                "known points sharing a 100 ms slot, earlier dropped",
                                "known points overlapping the previous life, dropped")}
    by_player = {s: build_track(samples[s], deaths[s], duration_ms, notes) for s in subjects}
    warnings += [f"{count} {what}" for what, count in notes.items() if count]

    # ---- write ----------------------------------------------------------------------------
    bundle = {
        "schema": SCHEMA,
        "parser": {"vrfkit": None, "reducer": REDUCER},
        "match": match,
        "players": players,
        "rounds": rounds,
        "weapons": weapons,
        "tracks": {"hz": HZ, "fields": ["t", "x", "y", "yaw", "alive", "weapon"], "byPlayer": by_player},
        "kills": kills,
        "casts": [],
        "effects": [],
        "spike": {"carriers": [], "plants": [], "defuses": []},
        "pawns": {"fields": ["t", "x", "y", "yaw"], "items": []},
    }
    home = _env.home()
    out_dir = args.out_dir or home / "exports" / f"{match_id[:8]}-derived"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
    bundle_path = out_dir / BUNDLE_NAME
    with open(bundle_path, "wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=9, mtime=0) as zipped:
            zipped.write(raw)

    # ---- library row ----------------------------------------------------------------------
    owner = next(p for p in players_raw if p["puuid"] == me)
    stats = owner["stats"]
    k_, d_, a_ = stats.get("kills", 0), stats.get("deaths", 0), stats.get("assists", 0)
    shots = sum(stats.get(key, 0) or 0 for key in ("headshots", "bodyshots", "legshots"))
    owner_agent = agent_uuid(owner)
    try:
        agents = fetch_json(AGENTS_URL)["data"]
        role = next(((a.get("role") or {}).get("displayName") for a in agents
                     if a["uuid"].lower() == (owner_agent or "")), None)
    except (urllib.error.URLError, OSError, ValueError) as error:
        role = None
        warnings.append(f"valorant-api agents unavailable ({error}); agent_role is null")
    library_row = {
        "match_id": match_id,
        "match_date": started,
        "map": game_map["displayName"],
        "map_id": game_map["uuid"],
        "agent": owner.get("character"),
        "agent_id": owner_agent,
        "agent_role": role,
        "mode": "Deathmatch",
        "result": "W" if placement == 1 else "L",
        "score": f"{placement}/{len(players_raw)}",
        "rounds_won": 0,
        "rounds_lost": 0,
        "rounds_played": 0,
        "kills": k_,
        "deaths": d_,
        "assists": a_,
        "kd": round(k_ / d_, 2) if d_ else k_,
        "kda": round((k_ + a_) / d_, 2) if d_ else k_ + a_,
        "acs": 0,
        "headshots": stats.get("headshots", 0),
        "bodyshots": stats.get("bodyshots", 0),
        "legshots": stats.get("legshots", 0),
        # A percentage, as src/lib/henrik.ts writes it.
        "headshot_pct": round(stats.get("headshots", 0) / shots * 100, 2) if shots else 0,
        "kpr": 0,
        "dpr": 0,
        "raw_score": stats.get("score", 0),
    }
    row_path = (args.out_dir or home / "exports") / f"{match_id[:8]}-library-row.json"
    row_path.write_text(json.dumps(library_row, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    report = [
        f"bundle        {bundle_path}",
        f"library row   {row_path}",
        f"schema        {SCHEMA}  reducer {REDUCER}",
        f"match         {match_id}  {game_map['displayName']} {match['mapUrl']}  {match['build']}  {started}",
        f"size          {len(raw):,} bytes json, {bundle_path.stat().st_size:,} bytes gzipped",
        f"players       {len(players)}  (owner {owner['name']}#{owner['tag']}, place {placement}/{len(players_raw)})",
        f"round         barrier {barrier} ms, end {duration_ms} ms, winner {rounds[0]['winner']}",
        f"track samples {sum(len(v) for v in by_player.values()):,} at {HZ} Hz "
        f"from {sum(len(v) for v in samples.values()):,} kill-event samples",
        f"kills         {len(kills)}  ({sum(k['weapon'] is not None for k in kills)} with a weapon)",
        f"weapons       {', '.join(w['name'] for w in weapons)}",
        f"warnings      {len(warnings)}",
        *[f"  - {w}" for w in warnings],
    ]
    print("\n".join(report))


if __name__ == "__main__":
    main()
