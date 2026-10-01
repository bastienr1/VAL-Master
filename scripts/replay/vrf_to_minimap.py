"""Reduce a vrfkit export to the VAL Master minimap bundle (schema 1).

Usage:
    python vrf_to_minimap.py <export-dir> [--me <puuid>] [--derived <dir>] [--out <dir>]

Machine settings (your PUUID, the vrfkit clone, the cache folder) come from `.env.local`;
see `_env.py` and the README next to this file.

Inputs
    <export-dir>   written by `vrfkit export ... --checkpoints`
    <derived-dir>  spike_carrier.parquet and active_effects.parquet from vrfkit's tools/
                   (default: <export-dir>-derived). Both are optional; their sections stay empty.

Outputs (in --out, default <derived-dir>)
    minimap.v1.json.gz   the bundle the browser loads
    bundle-report.txt    counts and warnings

Positions stay in world units (cm). The map transform is applied by the UI.
Nothing about agents, weapons or maps is hardcoded here: agent ids come from the replay's
playerLoadouts, weapon names from vrfkit's equippable table, map data from valorant-api.com.
"""
import argparse
import bisect
import gzip
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

import _env

SCHEMA = 1
REDUCER_VERSION = "0.1.0"
MAPS_URL = "https://valorant-api.com/v1/maps"

# Comp_AbilityStatisticsReplicator Slot values. Not documented anywhere; derived by lining casts
# up with characterUltimateUsed events (9) and with the Ability_4 / Ability_Q / Ability_E class
# path segment of the actor each cast spawns. gate2_check.py re-measures the agreement.
SLOT_KEYS = {3: "C", 4: "Q", 5: "E", 9: "X"}

CAST_FIELD = re.compile(r"^AbilityCastsThisRound\[(\d+)\]\.([A-Za-z]+)_\d+_[0-9A-F]{32}$")


def unpack_int(raw):
    """Unreal SerializeIntPacked: 7 value bits per byte, low bit set when another byte follows."""
    value = 0
    for i, byte in enumerate(raw or b""):
        value |= (byte >> 1) << (7 * i)
        if not byte & 1:
            break
    return value


def parse_vec(text):
    if not text:
        return None
    return [float(part) for part in text.strip("()").split(",")]


class Timeline:
    """Step function: value at t is the value of the last change at or before t."""

    def __init__(self, changes):
        changes = sorted(changes, key=lambda c: c[0])
        self.times = [c[0] for c in changes]
        self.values = [c[1] for c in changes]

    def at(self, t, default=None):
        i = bisect.bisect_right(self.times, t) - 1
        return self.values[i] if i >= 0 else default


def load_maps(cache_path):
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))
    request = urllib.request.Request(MAPS_URL, headers={"User-Agent": "val-master-replay-engine"})
    maps = json.load(urllib.request.urlopen(request, timeout=30))["data"]
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(maps), encoding="utf-8")
    return maps


def load_equippables(tools_dir):
    sys.path.insert(0, str(tools_dir))
    try:
        from equippable_table import EQUIPPABLE_BY_PATH
    except ImportError:
        return {}
    finally:
        sys.path.pop(0)
    return EQUIPPABLE_BY_PATH


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", type=Path)
    ap.add_argument("--me", help="your PUUID (manifest subject); decides ALLY / ENEMY. Default: VAL_REPLAY_ME")
    ap.add_argument("--derived", type=Path)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--hz", type=int, default=10)
    ap.add_argument("--vrfkit-tools", type=Path, help="default: the tools/ folder of the vrfkit clone")
    ap.add_argument("--vrfkit-ref", default=None, help="vrfkit release / commit that wrote the export")
    ap.add_argument("--maps-cache", type=Path, help="default: <VAL_REPLAY_HOME>/cache/valorant-api-maps.json")
    args = ap.parse_args()
    args.me = args.me or _env.me()
    args.vrfkit_tools = args.vrfkit_tools or _env.vrfkit_tools()
    args.maps_cache = args.maps_cache or _env.cache_dir() / "valorant-api-maps.json"

    export = args.export
    derived = args.derived or export.with_name(export.name + "-derived")
    out_dir = args.out or derived
    out_dir.mkdir(parents=True, exist_ok=True)
    step = 1000 // args.hz
    warnings = []

    con = duckdb.connect()
    for table in ("fields", "movement", "actors", "events"):
        con.execute(f"create view {table} as select * from '{(export / (table + '.parquet')).as_posix()}'")
    manifest = json.loads((export / "manifest.json").read_text(encoding="utf-8"))

    # ---- match ----------------------------------------------------------------------------
    map_url = manifest["level_names_and_times"][0]["name"]
    game_map = next((m for m in load_maps(args.maps_cache) if m["mapUrl"] == map_url), None)
    if game_map is None:
        warnings.append(f"map {map_url} not found on valorant-api.com; mapUuid and plant sites are empty")
    recorded = datetime(1, 1, 1, tzinfo=timezone.utc) + timedelta(microseconds=manifest["timestamp_ticks"] // 10)
    match = {
        "matchId": manifest["friendly_name"],
        "mapUuid": game_map["uuid"] if game_map else None,
        "mapUrl": map_url,
        "build": manifest["replay_build"].split("+")[-1],
        "recordedAt": recorded.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "durationMs": manifest["duration_ms"],
    }

    # ---- players and teams ----------------------------------------------------------------
    agent_ids = {}
    for blob in manifest.get("game_specific_data", []):
        data = json.loads(blob) if isinstance(blob, str) else blob
        for loadout in data.get("playerLoadouts", []) if isinstance(data, dict) else []:
            agent_ids[loadout["subject"]] = loadout.get("characterId")

    team_of_state = {
        actor: unpack_int(raw)
        for actor, raw in con.execute(
            "select actor_net_guid, raw_bits from fields "
            "where group_path like '%BombPlayerState_C' and field_name = 'AssignedTeamState'").fetchall()
    }
    subject_of = {p["character_net_guid"]: p["subject"] for p in manifest["players"]}
    bodies = sorted(subject_of)
    body_sql = ", ".join(str(b) for b in bodies)
    team_of_body = {p["character_net_guid"]: team_of_state.get(p["actor_net_guid"]) for p in manifest["players"]}
    my_body = next((b for b, s in subject_of.items() if s == args.me), None)
    if my_body is None:
        sys.exit(f"--me {args.me} is not one of this replay's 10 players")

    events = con.execute('select "group", time1, word0, word1 from events order by time1').fetchall()
    buy_starts = [t for group, t, *_ in events if group == "roundStarted"]
    switches = [t for group, t, *_ in events if group == "switchTeams"]
    plants_ev = [t for group, t, *_ in events if group == "spikePlanted"]
    defuses_ev = [t for group, t, *_ in events if group == "spikeDefused"]
    deaths = [(t, killer, victim) for group, t, killer, victim in events if group == "characterDeath"]

    if None in team_of_body.values():
        # Builds before 13.01 do not name AssignedTeamState. Killer and victim are always on
        # opposite teams, so two-colour the kill graph instead.
        warnings.append("AssignedTeamState not in this export; teams derived from the kill graph")
        opponents = {b: set() for b in bodies}
        for _, killer, victim in deaths:
            if killer != victim and killer in opponents and victim in opponents:
                opponents[killer].add(victim)
                opponents[victim].add(killer)
        team_of_body, queue = {my_body: 1}, [my_body]
        while queue:
            body = queue.pop()
            for other in opponents[body]:
                if other not in team_of_body:
                    team_of_body[other] = 3 - team_of_body[body]
                    queue.append(other)
                elif team_of_body[other] == team_of_body[body]:
                    sys.exit(f"kill graph is not two-colourable at {body} / {other}")
        if len(team_of_body) != len(bodies):
            sys.exit(f"kill graph leaves players without a team: {sorted(set(bodies) - set(team_of_body))}")
    team_ids = sorted(set(team_of_body.values()))
    if len(team_ids) != 2:
        sys.exit(f"expected two teams, found {team_ids}")
    ally_team = team_of_body[my_body]
    enemy_team = next(t for t in team_ids if t != ally_team)
    label = {ally_team: "ALLY", enemy_team: "ENEMY"}

    # ---- rounds ---------------------------------------------------------------------------
    # The game's own phase timer. A reset to ~100 s is the barrier drop; ~45 s is a pistol-round
    # buy phase or a spike plant; ~7 s is the end-of-round phase. Builds before 13.01 name only
    # DisplayRemainingTime, which carries the same resets.
    timer_fields = {name for (name,) in con.execute("""
        select distinct field_name from fields where group_path like '%BombGameState_C'
          and field_name in ('StateRemainingTime', 'DisplayRemainingTime')""").fetchall()}
    timer_field = next((f for f in ("StateRemainingTime", "DisplayRemainingTime") if f in timer_fields), None)
    if timer_field is None:
        warnings.append("no round timer field in this export; barrier times are empty")
    resets = con.execute(f"""
        with timer as (
            select time_ms, value_f64 as v, lag(value_f64) over (order by time_ms, packet_id) as prev
            from fields where group_path like '%BombGameState_C' and field_name = '{timer_field}')
        select time_ms, v from timer where v > prev + 1 order by time_ms""").fetchall()

    results = {}
    for name, value_str in con.execute("""
            select field_name, value_str from fields
            where group_path like '%BombGameState_C' and field_name like 'RoundResults[%].%'
              and value_str is not null""").fetchall():
        index, member = re.match(r"RoundResults\[(\d+)\]\.(\w+)", name).groups()
        results.setdefault(int(index), {})[member] = value_str
    for index, t in con.execute("""
            select value_i64, time_ms from fields
            where group_path like '%BombGameState_C' and field_name like 'RoundResults[%].RoundNumber'""").fetchall():
        results.setdefault(index, {})["t"] = t

    role_changes = {team: [] for team in team_ids}
    for t, team, raw in con.execute("""
            select time_ms, actor_net_guid, raw_bits from fields
            where group_path like '%BaseTeamState' and field_name = 'TeamRole' order by time_ms""").fetchall():
        if team in role_changes:
            role_changes[team].append((t, raw[0]))
    role_at = {team: Timeline(changes) for team, changes in role_changes.items()}

    # ---- spike ----------------------------------------------------------------------------
    plant_rpc = {}
    for t, name, value_str, raw in con.execute("""
            select time_ms, field_name, value_str, raw_bits from fields
            where group_path like '%Comp_BombEvents_C_ClassNetCache' and field_name like 'BombPlantedRPC.%'
            """).fetchall():
        entry = plant_rpc.setdefault(t, {})
        if name.endswith(".PlantLocation"):
            entry["loc"] = parse_vec(value_str)
        elif name.endswith(".BombPlanter"):
            entry["planter"] = unpack_int(raw)
    defuse_rpc = {
        t: unpack_int(raw) for t, raw in con.execute("""
            select time_ms, raw_bits from fields
            where group_path like '%Comp_BombEvents_C_ClassNetCache'
              and field_name = 'BombDefusedRPC.DefusingCharacter'""").fetchall()
    }

    def nearest(mapping, t, tolerance=500):
        best = min(mapping, key=lambda k: abs(k - t), default=None)
        return mapping[best] if best is not None and abs(best - t) <= tolerance else None

    site_callouts = [c for c in (game_map or {}).get("callouts") or [] if c["regionName"] == "Site"]

    def site_of(x, y):
        if not site_callouts:
            return None
        nearest_site = min(site_callouts, key=lambda c: (c["location"]["x"] - x) ** 2 + (c["location"]["y"] - y) ** 2)
        return nearest_site["superRegionName"]

    def round_of(t):
        return max(bisect.bisect_right(buy_starts, t), 1)

    spike_plants = []
    for t in plants_ev:
        rpc = nearest(plant_rpc, t) or {}
        loc = rpc.get("loc")
        spike_plants.append({
            "t": t, "round": round_of(t),
            "site": site_of(loc[0], loc[1]) if loc else None,
            "x": round(loc[0]) if loc else None, "y": round(loc[1]) if loc else None,
            "player": subject_of.get(rpc.get("planter")),
        })
        if not loc:
            warnings.append(f"plant at {t} ms has no BombPlantedRPC location")
    spike_defuses = [{"t": t, "round": round_of(t), "player": subject_of.get(nearest(defuse_rpc, t))}
                     for t in defuses_ev]

    # Whoever plants is attacking. That anchors both ways of reading sides.
    body_of = {s: b for b, s in subject_of.items()}
    planting_team = [(p["t"], team_of_body[body_of[p["player"]]]) for p in spike_plants if p["player"]]
    if all(role_changes[team] for team in team_ids):
        # 13.01+: each team state replicates its role; the planter names the value for "attacker".
        attacker_votes = {role_at[team].at(t) for t, team in planting_team}
        if len(attacker_votes) == 1:
            attacker_role = attacker_votes.pop()
        else:
            attacker_role = 1
            warnings.append(f"attacker role value not derivable from plants ({sorted(attacker_votes)}); assumed 1")

        def role_name(team, t):
            value = role_at[team].at(t)
            if value is None:
                return None
            return "attacker" if value == attacker_role else "defender"
    else:
        # Older builds: sides are fixed between switchTeams events, and alternate across them.
        warnings.append("TeamRole not in this export; sides derived from planters and switchTeams events")
        attackers = {}
        for t, team in planting_team:
            segment = bisect.bisect_right(switches, t)
            if attackers.setdefault(segment, team) != team:
                warnings.append(f"both teams planted between two side switches (segment {segment})")

        def role_name(team, t):
            segment = bisect.bisect_right(switches, t)
            known = min(attackers, key=lambda s: abs(s - segment), default=None)
            if known is None:
                return None
            attacking = attackers[known] if (segment - known) % 2 == 0 else next(
                other for other in team_ids if other != attackers[known])
            return "attacker" if team == attacking else "defender"

    rounds = []
    for i, buy_start in enumerate(buy_starts):
        next_start = buy_starts[i + 1] if i + 1 < len(buy_starts) else manifest["duration_ms"] + 1
        # Above 60 s only the round timer qualifies (100 s; 12.02 shows one transient 145 s row).
        barrier = next((t for t, v in resets if buy_start <= t < next_start and v > 60), None)
        if barrier is None:
            warnings.append(f"round {i + 1}: no barrier-drop timer reset found")
        result = results.get(i, {})
        end = result.get("t")
        winner = None
        if result.get("WinningTeamRole") and end is not None:
            winner = next((label[team] for team in team_ids
                           if role_name(team, end) == result["WinningTeamRole"]), None)
        if winner is None:
            warnings.append(f"round {i + 1}: winner not resolved")
        rounds.append({
            "n": i + 1,
            "buyStartMs": buy_start,
            "barrierMs": barrier,
            "endMs": end,
            "side": role_name(ally_team, barrier if barrier is not None else buy_start + 1000),
            "winner": winner,
            "how": result.get("RoundResult"),
            "plant": next((p["t"] for p in spike_plants if p["round"] == i + 1), None),
            "defuse": next((d["t"] for d in spike_defuses if d["round"] == i + 1), None),
        })

    color = {}
    for rnd, result in zip(rounds, (results.get(i, {}) for i in range(len(rounds)))):
        if rnd["winner"] and result.get("WinningTeam"):
            color.setdefault(rnd["winner"], set()).add(result["WinningTeam"])
    for side, names in color.items():
        if len(names) != 1:
            warnings.append(f"{side} won rounds under more than one team name: {sorted(names)}")
    names = {side: sorted(n)[0] for side, n in color.items() if len(n) == 1}
    if len(names) == 1:  # a team that never won a round still has the other name
        (known_side, known_name), = names.items()
        other = {"Red": "Blue", "Blue": "Red"}.get(known_name)
        if other:
            names["ENEMY" if known_side == "ALLY" else "ALLY"] = other

    players = [{
        "subject": p["subject"],
        "agentId": agent_ids.get(p["subject"]),
        "team": label[team_of_body[p["character_net_guid"]]],
        "teamName": names.get(label[team_of_body[p["character_net_guid"]]]),
        "body": p["character_net_guid"],
        "isMe": p["subject"] == args.me,
    } for p in sorted(manifest["players"], key=lambda p: p["character_net_guid"])]

    # ---- weapons --------------------------------------------------------------------------
    equippables = load_equippables(args.vrfkit_tools)
    if not equippables:
        warnings.append(f"equippable_table.py not found in {args.vrfkit_tools}; weapons carry class names only")
    actor_class = dict(con.execute("""
        select actor_net_guid, min(coalesce(archetype_path, class_path))
        from actors where event = 'open' group by 1""").fetchall())
    weapons, weapon_index = [], {}

    def weapon_id(guid):
        path = actor_class.get(guid)
        if not path:
            return None
        if path not in weapon_index:
            name, category, _ = equippables.get(path, (None, None, None))
            weapon_index[path] = len(weapons)
            weapons.append({"cls": path.removeprefix("Default__"), "name": name, "cat": category})
        return weapon_index[path]

    equip_changes = {b: [] for b in bodies}
    for t, body, guid in con.execute(f"""
            select time_ms, actor_net_guid, value_i64 from fields
            where group_path like '%AresInventory' and field_name = 'NewCurrentEquippable'
              and actor_net_guid in ({body_sql})
            order by time_ms, packet_id, actor_net_guid, value_i64""").fetchall():
        equip_changes[body].append((t, weapon_id(guid)))
    equipped = {b: Timeline(changes) for b, changes in equip_changes.items()}

    # ---- alive ----------------------------------------------------------------------------
    # Alive from every (re)spawn until the next death. AresInventory.RespawnNumber is written at
    # each round start and at each revive (Sage resurrection, Clove's Not Dead Yet).
    life_changes = {b: [(t, 1) for t in buy_starts] for b in bodies}
    for t, body in con.execute(f"""
            select time_ms, actor_net_guid from fields
            where group_path like '%AresInventory' and field_name = 'RespawnNumber'
              and actor_net_guid in ({body_sql})""").fetchall():
        life_changes[body].append((t, 1))
    for t, _, victim in deaths:
        if victim in life_changes:
            life_changes[victim].append((t, 0))
    alive = {b: Timeline(changes) for b, changes in life_changes.items()}

    # ---- tracks ---------------------------------------------------------------------------
    live_position = "not (pos_x < -49000 and pos_z < -49000)"  # vrfkit's park slot for hidden actors
    samples = con.execute(f"""
        select character_net_guid, time_ms, pos_x, pos_y, yaw from (
            select *, row_number() over (
                partition by character_net_guid, time_ms // {step}
                order by time_ms, packet_id, pos_x, pos_y, yaw) as rn
            from movement where {live_position})
        where rn = 1 order by character_net_guid, time_ms""").fetchall()
    by_player = {subject_of[b]: [] for b in bodies}
    pawn_samples = {}
    for guid, t, x, y, yaw in samples:
        if guid in subject_of:
            by_player[subject_of[guid]].append(
                [t, round(x), round(y), round(yaw) % 360, alive[guid].at(t, 1), equipped[guid].at(t)])
        else:
            pawn_samples.setdefault(guid, []).append([t, round(x), round(y), round(yaw) % 360])

    # ---- pawns (cameras, drones, Clove's after-death form) ---------------------------------
    instigator = dict(con.execute(f"""
        select actor_net_guid, min(value_i64) from fields
        where field_name = 'Instigator' and value_i64 in ({body_sql}) group by 1""").fetchall())
    pawns = [{
        "cls": (actor_class.get(guid) or "unknown").removeprefix("Default__"),
        "owner": subject_of.get(instigator.get(guid)),
        "from": rows[0][0], "to": rows[-1][0],
        "samples": rows,
    } for guid, rows in sorted(pawn_samples.items(), key=lambda item: (item[1][0][0], item[0]))]

    # ---- kills ----------------------------------------------------------------------------
    killing_hits = con.execute("""
        with rpc as (
            select packet_id, actor_net_guid, time_ms, split_part(field_name, '.', 1) as rpc,
                   split_part(field_name, '.', 2) as member, value_i64, value_bool
            from fields where field_name like 'MulticastNotifyDamage\\_%' escape '\\')
        select min(time_ms),
               max(value_i64) filter (where member = 'Character'),
               max(value_i64) filter (where member = 'EquippableUsed'),
               max(value_i64) filter (where member = 'DamageCauser')
        from rpc group by packet_id, actor_net_guid, rpc
        having bool_or(member = 'bDamageKilledTarget' and value_bool)
        order by 1, 2, 3, 4""").fetchall()
    kill_positions = con.execute("""
        with k as (select time1 as t, word0 as killer, word1 as victim from events where "group" = 'characterDeath'),
             -- several movement rows can share a time_ms; keep one per body and instant so the
             -- as-of join below has a single answer
             mv as (select g, time_ms, pos_x, pos_y from (
                        select character_net_guid as g, time_ms, pos_x, pos_y, row_number() over (
                            partition by character_net_guid, time_ms
                            order by packet_id desc, pos_x, pos_y) as rn
                        from movement where character_net_guid in (select word0 from events) or
                                            character_net_guid in (select word1 from events))
                    where rn = 1)
        select k.t, k.killer, k.victim, a.pos_x, a.pos_y, b.pos_x, b.pos_y
        from k asof left join mv a on a.g = k.killer and a.time_ms <= k.t
               asof left join mv b on b.g = k.victim and b.time_ms <= k.t
        order by k.t, k.victim, k.killer""").fetchall()
    kills = []
    for t, killer, victim, kx, ky, vx, vy in kill_positions:
        hit = min((h for h in killing_hits if h[1] == victim and abs(h[0] - t) <= 300),
                  key=lambda h: abs(h[0] - t), default=None)
        weapon = None
        if hit and killer != victim:  # a self-death (Clove's ult running out) has no weapon
            # EquippableUsed is the gun or ability in hand; for a projectile or pawn it is empty,
            # so fall back to the actor that dealt the damage.
            weapon = weapon_id(hit[2]) if hit[2] in actor_class else weapon_id(hit[3])
        kills.append({
            "t": t, "round": round_of(t),
            "killer": subject_of.get(killer), "victim": subject_of.get(victim),
            "weapon": weapon,
            "kx": None if kx is None else round(kx), "ky": None if ky is None else round(ky),
            "vx": None if vx is None else round(vx), "vy": None if vy is None else round(vy),
        })

    # ---- casts ----------------------------------------------------------------------------
    # The array is delta-replicated: an update carries only the members that changed, and entries
    # shift when a cast is added. Replay the updates into per-index state, then dedupe.
    cast_state, casts, seen = {}, [], set()
    current, pending = None, {}

    def flush():
        if current is None or "CastTime" not in pending:
            return
        t, body, index = current
        state = cast_state.setdefault((body, index), {})
        state.update(pending)
        key = (body, round_of(t), state.get("Slot"), round(state["CastTime"] * 1000))
        if key in seen:
            return
        seen.add(key)
        loc = state.get("CastLocation")
        slot = state.get("Slot")
        casts.append({
            "t": t, "round": key[1], "player": subject_of[body],
            "slot": SLOT_KEYS.get(slot, f"?{slot}"),
            "x": round(loc[0]) if loc else None, "y": round(loc[1]) if loc else None,
        })

    for t, body, name, v_int, v_float, v_str in con.execute(f"""
            select time_ms, actor_net_guid, field_name, value_i64, value_f64, value_str from fields
            where group_path like '%Comp_AbilityStatisticsReplicator_C'
              and field_name like 'AbilityCastsThisRound[%].%' and actor_net_guid in ({body_sql})
            order by time_ms, packet_id, actor_net_guid, field_name""").fetchall():
        matched = CAST_FIELD.match(name)
        if not matched:
            continue
        index, member = int(matched.group(1)), matched.group(2)
        if (t, body, index) != current:
            flush()
            current, pending = (t, body, index), {}
        if member == "CastTime":
            pending[member] = v_float
        elif member == "Slot":
            pending[member] = v_int
        elif member == "CastLocation":
            pending[member] = parse_vec(v_str)
    flush()
    casts.sort(key=lambda c: c["t"])

    # ---- effects and carriers (from vrfkit's derived tables) --------------------------------
    effects, carriers = [], []
    effects_path = derived / "active_effects.parquet"
    if effects_path.exists():
        for guid, cls, kind, agent, x, y, start, end in con.execute(f"""
                select actor_net_guid, class_path, effect_type, agent, spawn_x, spawn_y, open_ms, close_ms
                from '{effects_path.as_posix()}' order by open_ms, actor_net_guid""").fetchall():
            effects.append({
                "start": start, "end": end, "kind": kind, "agent": agent or None,
                "cls": cls.rsplit(".", 1)[-1], "x": round(x), "y": round(y),
                "owner": subject_of.get(instigator.get(guid)),
            })
    else:
        warnings.append(f"{effects_path.name} not found; effects are empty")
    carrier_path = derived / "spike_carrier.parquet"
    if carrier_path.exists():
        for start, end, subject in con.execute(f"""
                select from_ms, to_ms, carrier_subject from '{carrier_path.as_posix()}'
                where carrier_subject is not null order by from_ms, to_ms""").fetchall():
            carriers.append({"from": start, "to": end, "player": subject})
    else:
        warnings.append(f"{carrier_path.name} not found; spike carriers are empty")

    # ---- write ----------------------------------------------------------------------------
    bundle = {
        "schema": SCHEMA,
        "parser": {"vrfkit": args.vrfkit_ref, "reducer": REDUCER_VERSION},
        "match": match,
        "players": players,
        "rounds": rounds,
        "weapons": weapons,
        "tracks": {"hz": args.hz, "fields": ["t", "x", "y", "yaw", "alive", "weapon"], "byPlayer": by_player},
        "kills": kills,
        "casts": casts,
        "effects": effects,
        "spike": {"carriers": carriers, "plants": spike_plants, "defuses": spike_defuses},
        "pawns": {"fields": ["t", "x", "y", "yaw"], "items": pawns},
    }
    raw = json.dumps(bundle, separators=(",", ":")).encode("utf-8")
    bundle_path = out_dir / f"minimap.v{SCHEMA}.json.gz"
    with open(bundle_path, "wb") as handle:
        with gzip.GzipFile(fileobj=handle, mode="wb", compresslevel=9, mtime=0) as zipped:
            zipped.write(raw)

    ally_wins = sum(r["winner"] == "ALLY" for r in rounds)
    report = [
        f"bundle        {bundle_path}",
        f"schema        {SCHEMA}  reducer {REDUCER_VERSION}  vrfkit {args.vrfkit_ref}",
        f"match         {match['matchId']}  {match['mapUrl']}  {match['build']}  {match['recordedAt']}",
        f"size          {len(raw):,} bytes json, {bundle_path.stat().st_size:,} bytes gzipped",
        f"players       {len(players)}",
        f"rounds        {len(rounds)}  (ALLY {ally_wins} - {len(rounds) - ally_wins} ENEMY)",
        f"track samples {sum(len(v) for v in by_player.values()):,} at {args.hz} Hz",
        f"kills         {len(kills)}  ({sum(k['weapon'] is not None for k in kills)} with a weapon)",
        f"casts         {len(casts)}",
        f"effects       {len(effects)}",
        f"plants        {len(spike_plants)}  defuses {len(spike_defuses)}  carrier intervals {len(carriers)}",
        f"pawns         {len(pawns)}  ({sum(len(p['samples']) for p in pawns):,} samples)",
        f"weapons       {len(weapons)} classes, {sum(w['name'] is not None for w in weapons)} named",
        f"warnings      {len(warnings)}",
        *[f"  - {w}" for w in warnings],
    ]
    (out_dir / "bundle-report.txt").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report))


if __name__ == "__main__":
    main()
