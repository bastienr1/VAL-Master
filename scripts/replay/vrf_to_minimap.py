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
import math
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb

import _env

SCHEMA = 1
REDUCER_VERSION = "0.6.0"
# 0.2.0: effects also hold the ability actors vrfkit's keyword filter leaves out (Sova's bolts,
#        Raze's grenades, KAY/O's knife, Fade's prowlers...), with `kind` "other".
# 0.3.0: effects may carry `points` (a wall's shape, point by point, timed) and `track` (a
#        projectile's or a pawn's movement), both as [t, x, y] rows.
# 0.4.0: `kits`: by player, each ability's charges over time and their ultimate points.
# 0.5.0: a projectile on a precalculated path (Curveball, Flashbulb) has no movement to track:
#        its `track` is where it was thrown from and where the game says it went off.
# 0.6.0: `blinds`: by player, the [start, end] of every flash and nearsight that hit them.

# Leaf prefixes of the actors an ability puts in the world; `Ability_` controllers and `Gun_` weapons
# are not among them.
ABILITY_ACTOR_PREFIXES = ("projectile_", "gameobject_", "zone_", "patch_", "pawn_")
# The calls a wall's manager makes as the wall forms, one point each.
WALL_POINT_FIELDS = ("MulticastAddAnchor.Translation", "MulticastAddSmokeScreenPoint.Translation",
                     "MulticastAddTunnelPoint.Translation")
# Spacing of the kept samples of a projectile's or a pawn's movement.
TRACK_MS = 100
MAPS_URL = "https://valorant-api.com/v1/maps"

# Comp_AbilityStatisticsReplicator Slot values. Not documented anywhere; derived by lining casts
# up with characterUltimateUsed events (9) and with the Ability_4 / Ability_Q / Ability_E class
# path segment of the actor each cast spawns. gate2_check.py re-measures the agreement.
SLOT_KEYS = {3: "C", 4: "Q", 5: "E", 9: "X"}

# Which key each ability controller is on. The folder and the `_4_` / `_Q_` / `_E_` in a class name
# do not say (Raze's Boom Bot is `Ability_E` and on C). From the casts that line up with each
# controller's charges going down, over the 68 replays of 2026-11-08, checked against the game.
ABILITY_KEYS = {
    "Aggrobot_C_ExplodeyPatch": "C", "Q_Aggrobot_SeekerNade": "Q", "E_Aggrobot_DiscTurret": "E",
    "BountyHunter_4_WolfHoundBendable": "C", "Q_BountyHunter_TetherDivebomb": "Q", "E_BountyHunter_ReconDivebomb": "E",
    "Breach_4_FusionBlast": "C", "Breach_Q_Flash": "Q", "Breach_E_Fissure": "E",
    "Cable_E_CableJam": "C", "Cable_Q_SoundSensor": "Q", "Cable_4_NetToss": "E",
    "Cashew_4_Spider_LockOn": "C", "Cashew_Q_ShellShockGrenade": "Q", "Cashew_E_Airstrike": "E",
    "Clay_E_Boomba": "C", "Clay_Q_Satchel": "Q", "Clay_4_ClusterGrenade": "E",
    "Deadeye_4_Trap": "C", "Deadeye_Q_Pistol": "Q", "Deadeye_E_Teleporter_Tethers": "E",
    "Grenadier_Q_BasicSemtex": "C", "Grenadier_C_Flash": "Q", "E_Grenadier_EMPKnife": "E",
    "Guide_4_Heal": "C", "Guide_Q_PossessableScout": "Q", "Guide_E_HawkFlash": "E",
    "Gumshoe_4_TripWire": "C", "Gumshoe_E_TripWire": "C", "Gumshoe_4_CageTrap": "Q", "Gumshoe_Q_CageTrap": "Q",
    "Gumshoe_E_Camera": "E", "Gumshoe_Q_Camera": "E",
    "Hunter_E_DeployDrone": "C", "Hunter_4_BoltExplosive": "Q", "Hunter_Q_RevealBolt_Signature": "E",
    "Iris_Thumper": "C", "Iris_Harmonize": "Q", "Iris_E_MT_Smoke_Production": "E",
    "Killjoy_4_RemoteBees_MultiDetonate": "C", "Killjoy_Q_Alarmbot": "Q", "Killjoy_E_Turret": "E",
    "Mage_4_SplashGrenade": "C", "Mage_Q_Wall": "Q", "Mage_E_WorldSmoke": "E",
    "Nox_BarbedWire": "C", "Nox_FlashTrap": "E",
    "Pandemic_Q_AcidGrenade": "C", "Pandemic_4_SmokeGrenade": "Q", "Pandemic_E_SmokeScreen": "E",
    "Paprika_4_PullBlast": "C", "Paprika_Q_RedirectFlash": "Q", "Paprika_E_RedirectPull": "E",
    "Phoenix_Q_FireballWall_Production": "C", "Phoenix_4_Molotov_Production": "Q", "Phoenix_E_FlareCurve_Production": "E",
    "Pine_4_UsableTP": "C", "Pine_Q_SeizeTrap": "Q", "Pine_E_RadEater": "E",
    "Rift_4_BlackHole": "C", "Rift_Q_FlashBurst": "Q", "Rift_E_TransformRift_Smoke": "E",
    "Sarge_E_SpeedStim": "C", "Sarge_Q_Molotov_Production": "Q", "Sarge_4_MapTargetSmoke_Production": "E",
    "Sequoia_4_Wave": "C", "Sequoia_Q_FragileMissilePrototypeEquipped": "Q", "Sequoia_E_WreckingBall": "E",
    "Smonk_BFArmor_Reactive": "C", "Q_Smonk_DebuffKnife": "Q", "Smonk_E_MapTargetSmokeV2": "E",
    "Sprinter_4_Tunnel_Production": "C", "Sprinter_Q_GroundStrike_Production": "Q", "Sprinter_E_Sprint_Production": "E",
    "Stealth_4_Decoy": "C", "Stealth_Q_BounceFlash": "Q", "Stealth_E_Teleport": "E",
    "Terra_C_TimeSlowGrenade": "C", "Terra_Q_DoubleDash": "Q", "Terra_E_RewindTime": "E",
    "Thorne_E_Wall_Fortifying": "C", "Thorne_4_SlowField_Production": "Q", "Thorne_Q_Heal_Production_New": "E",
    # Soul orbs: one resource for Devour (Q) and Dismiss (E).
    "Vampire_4_NearsightAoE": "C", "Vampire_Q_Heal": "QE",
    "Wraith_E_ShortTeleport": "C", "Wraith_Q_NearsightMissile": "Q", "Wraith_4_Smoke": "E",
    "Wushu_4_Smoke": "C", "Wushu_Q_CycloneBoost": "Q", "Wushu_E_Dash": "E", "Wushu_E_Dash_Production": "E",
}
# Ultimate points, by the agent's codename, for a player who never used theirs in the match: the
# most any player of that agent held in those replays. Otherwise the points they had when it reset.
ULT_POINTS = {
    "aggrobot": 8, "bountyhunter": 8, "breach": 8, "cable": 7, "cashew": 9, "clay": 8, "deadeye": 8, "grenadier": 8,
    "guide": 8, "gumshoe": 7, "hunter": 8, "iris": 8, "killjoy": 9, "mage": 7, "nox": 8, "pandemic": 9, "paprika": 8,
    "phoenix": 7, "pine": 7, "rift": 7, "sarge": 8, "sequoia": 7, "smonk": 8, "sprinter": 8, "stealth": 8, "terra": 8,
    "thorne": 7, "vampire": 7, "wraith": 7, "wushu": 8,
}

# A blind shorter than this is a flash barely caught at the edge of the screen.
BLIND_MIN_MS = 200
NEARSIGHT_SOURCES = {"Projectile_Wraith_Q_NearsightMissile_C", "GameObject_Vampire_4_NearsightAOE_Source_C"}
NEARSIGHT_STATS = {"EnemiesNearsighted", "AlliesNearsighted"}
NEARSIGHT_AFTER_MS = 4000
EFFECT_STAT = re.compile(r"^AbilityCastsThisRound\[(\d+)\]\.Effects\[(\d+)\]\.LocalizedStat_")
EFFECT_TARGET = re.compile(r"^AbilityCastsThisRound\[(\d+)\]\.Effects\[(\d+)\]\.AffectedTargetsArray\[(\d+)\]\.(AffectedPlayer|Value)_")

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
    ap.add_argument("--me", help="your PUUID (manifest subject); decides ALLY / ENEMY. Several, comma-separated, "
                                 "if you play on more than one account. Default: VAL_REPLAY_ME")
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
    live_position = "not (pos_x < -49000 and pos_z < -49000)"  # vrfkit's far-away slot for hidden actors

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
            "where group_path like '%PlayerState_C' and field_name = 'AssignedTeamState'").fetchall()
    }
    roster = sorted(manifest["players"], key=lambda p: p["character_net_guid"])
    subjects = [p["subject"] for p in roster]
    mine = [puuid.strip() for puuid in args.me.split(",") if puuid.strip()]
    args.me = next((puuid for puuid in mine if puuid in subjects), None)
    if args.me is None:
        sys.exit(f"none of your PUUIDs ({', '.join(p[:8] for p in mine)}) is among this replay's "
                 f"{len(subjects)} players: not your match, or another account (add it to VAL_REPLAY_ME)")

    # A player has one body per connection: someone who drops and comes back is given a new one,
    # and the manifest lists only the latest. Every body a player state ever spawned belongs to
    # that player, or the earlier body's kills and movement would have no owner.
    subject_of = {p["character_net_guid"]: p["subject"] for p in roster}
    state_subject = {p["actor_net_guid"]: p["subject"] for p in roster}
    for state, body in con.execute("""
            select actor_net_guid, value_i64 from fields
            where group_path like '%PlayerState_C' and field_name = 'SpawnedCharacter' and value_i64 > 0
            order by time_ms, packet_id""").fetchall():
        if state in state_subject:
            subject_of.setdefault(body, state_subject[state])
    bodies = sorted(subject_of)
    body_sql = ", ".join(str(b) for b in bodies)
    if len(bodies) > len(subjects):
        warnings.append(f"{len(bodies) - len(subjects)} player(s) reconnected with a new body; "
                        "their tracks and kills are joined under one player")
    team_of = {p["subject"]: team_of_state.get(p["actor_net_guid"]) for p in roster}

    # Things an agent controls (a camera, a drone, Gekko's Wingman) name their player as Instigator.
    instigator = dict(con.execute(f"""
        select actor_net_guid, min(value_i64) from fields
        where field_name = 'Instigator' and value_i64 in ({body_sql}) group by 1""").fetchall())

    def player_behind(guid):
        """The player for a body, or for something that player controls. Wingman plants the spike."""
        return subject_of.get(guid) or subject_of.get(instigator.get(guid))

    events = con.execute('select "group", time1, word0, word1 from events order by time1').fetchall()
    buy_starts = [t for group, t, *_ in events if group == "roundStarted"]
    switches = [t for group, t, *_ in events if group == "switchTeams"]
    plants_ev = [t for group, t, *_ in events if group == "spikePlanted"]
    defuses_ev = [t for group, t, *_ in events if group == "spikeDefused"]
    deaths = [(t, killer, victim) for group, t, killer, victim in events if group == "characterDeath"]

    if None in team_of.values():
        # Builds before 13.01 do not name AssignedTeamState. Each team starts round 1 in its own
        # spawn, so the two groups standing apart three seconds in are the two teams. (Killer and
        # victim being on opposite teams would also do, until one teammate dies to another's ability.)
        warnings.append("AssignedTeamState not in this export; teams derived from the round 1 spawn positions")
        probe = buy_starts[0] + 3000
        spots = {}
        for body, x, y in con.execute(f"""
                select character_net_guid, arg_min(pos_x, time_ms), arg_min(pos_y, time_ms) from movement
                where time_ms >= {probe} and time_ms < {probe + 5000} and {live_position}
                  and character_net_guid in ({body_sql})
                group by 1 order by 1""").fetchall():
            spots.setdefault(subject_of[body], (x, y))
        if args.me not in spots:
            sys.exit("cannot tell the teams apart: you were not in the match when round 1 started")
        # The player farthest from me is in the other spawn; everyone joins whichever of us two is nearer.
        other_side = max(spots, key=lambda s: (math.dist(spots[s], spots[args.me]), s))
        team_of = {s: 1 if math.dist(spots[s], spots[args.me]) <= math.dist(spots[s], spots[other_side]) else 2
                   for s in spots}
        # Someone who connected after round 1 began has no spawn position. Whoever they killed or
        # were killed by is on the other team; take the majority, since friendly fire exists.
        for late in sorted(set(subjects) - set(spots)):
            votes = {1: 0, 2: 0}
            for _, killer, victim in deaths:
                a, b = subject_of.get(killer), subject_of.get(victim)
                opponent = b if a == late else a if b == late else None
                if opponent in team_of and opponent != late:
                    votes[3 - team_of[opponent]] += 1
            if votes[1] == votes[2]:
                sys.exit(f"cannot tell which team {late[:8]} is on: not in the match at round 1, and no clear kills")
            team_of[late] = 1 if votes[1] > votes[2] else 2
    team_ids = sorted(set(team_of.values()))
    if len(team_ids) != 2:
        sys.exit(f"expected two teams, found {team_ids}")
    ally_team = team_of[args.me]
    enemy_team = next(t for t in team_ids if t != ally_team)
    label = {ally_team: "ALLY", enemy_team: "ENEMY"}

    # ---- rounds ---------------------------------------------------------------------------
    # The game's own phase timer. A reset to ~100 s is the barrier drop; ~45 s is a pistol-round
    # buy phase or a spike plant; ~7 s is the end-of-round phase. Builds before 13.01 name only
    # DisplayRemainingTime, which carries the same resets.
    timer_fields = {name for (name,) in con.execute("""
        select distinct field_name from fields where group_path like '%GameState_C'
          and field_name in ('StateRemainingTime', 'DisplayRemainingTime')""").fetchall()}
    timer_field = next((f for f in ("StateRemainingTime", "DisplayRemainingTime") if f in timer_fields), None)
    if timer_field is None:
        warnings.append("no round timer field in this export; barrier times are empty")
    resets = con.execute(f"""
        with timer as (
            select time_ms, value_f64 as v, lag(value_f64) over (order by time_ms, packet_id) as prev
            from fields where group_path like '%GameState_C' and field_name = '{timer_field}')
        select time_ms, v from timer where v > prev + 1 order by time_ms""").fetchall()

    results = {}
    for name, value_str in con.execute("""
            select field_name, value_str from fields
            where group_path like '%GameState_C' and field_name like 'RoundResults[%].%'
              and value_str is not null""").fetchall():
        index, member = re.match(r"RoundResults\[(\d+)\]\.(\w+)", name).groups()
        results.setdefault(int(index), {})[member] = value_str
    for index, t in con.execute("""
            select value_i64, time_ms from fields
            where group_path like '%GameState_C' and field_name like 'RoundResults[%].RoundNumber'""").fetchall():
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
            "player": player_behind(rpc.get("planter")),
        })
        if not loc:
            warnings.append(f"plant at {t} ms has no BombPlantedRPC location")
    spike_defuses = [{"t": t, "round": round_of(t), "player": player_behind(nearest(defuse_rpc, t))}
                     for t in defuses_ev]

    # Whoever plants is attacking. That anchors both ways of reading sides.
    planting_team = [(p["t"], team_of[p["player"]]) for p in spike_plants if p["player"]]
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
        "team": label[team_of[p["subject"]]],
        "teamName": names.get(label[team_of[p["subject"]]]),
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

    equip_changes = {s: [] for s in subjects}
    for t, body, guid in con.execute(f"""
            select time_ms, actor_net_guid, value_i64 from fields
            where group_path like '%AresInventory' and field_name = 'NewCurrentEquippable'
              and actor_net_guid in ({body_sql})
            order by time_ms, packet_id, actor_net_guid, value_i64""").fetchall():
        equip_changes[subject_of[body]].append((t, weapon_id(guid)))
    equipped = {s: Timeline(changes) for s, changes in equip_changes.items()}

    # ---- alive ----------------------------------------------------------------------------
    # Alive from every (re)spawn until the next death. AresInventory.RespawnNumber is written at
    # each round start and at each revive (Sage resurrection, Clove's Not Dead Yet).
    life_changes = {s: [(t, 1) for t in buy_starts] for s in subjects}
    for t, body in con.execute(f"""
            select time_ms, actor_net_guid from fields
            where group_path like '%AresInventory' and field_name = 'RespawnNumber'
              and actor_net_guid in ({body_sql})""").fetchall():
        life_changes[subject_of[body]].append((t, 1))
    for t, _, victim in deaths:
        if victim in subject_of:
            life_changes[subject_of[victim]].append((t, 0))
    alive = {s: Timeline(changes) for s, changes in life_changes.items()}

    # ---- tracks ---------------------------------------------------------------------------
    samples = con.execute(f"""
        select character_net_guid, time_ms, pos_x, pos_y, yaw from (
            select *, row_number() over (
                partition by character_net_guid, time_ms // {step}
                order by time_ms, packet_id, pos_x, pos_y, yaw) as rn
            from movement where {live_position})
        where rn = 1 order by character_net_guid, time_ms""").fetchall()
    by_player = {s: [] for s in subjects}
    pawn_samples = {}
    for guid, t, x, y, yaw in samples:
        subject = subject_of.get(guid)
        if subject:
            by_player[subject].append(
                [t, round(x), round(y), round(yaw) % 360, alive[subject].at(t, 1), equipped[subject].at(t)])
        else:
            pawn_samples.setdefault(guid, []).append([t, round(x), round(y), round(yaw) % 360])

    for rows in by_player.values():  # a reconnected player's bodies follow one another in time
        rows.sort(key=lambda row: row[0])

    # ---- pawns (cameras, drones, Clove's after-death form) ---------------------------------
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
    # Positions come from the last moment each player was on the map. Iso's ult takes the two
    # duellists to an arena far outside it (the same far-away slot hidden actors are parked in);
    # a kill there is drawn between where the two stood when they were taken.
    kill_positions = con.execute(f"""
        with k as (select time1 as t, word0 as killer, word1 as victim from events where "group" = 'characterDeath'),
             -- several movement rows can share a time_ms; keep one per body and instant so the
             -- as-of join below has a single answer
             mv as (select g, time_ms, pos_x, pos_y from (
                        select character_net_guid as g, time_ms, pos_x, pos_y, row_number() over (
                            partition by character_net_guid, time_ms
                            order by packet_id desc, pos_x, pos_y) as rn
                        from movement
                        where {live_position}
                          and (character_net_guid in (select word0 from events)
                               or character_net_guid in (select word1 from events)))
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
            # A kill by something a player controls (a turret, a bot) is that player's kill.
            "killer": player_behind(killer), "victim": subject_of.get(victim),
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

    # ---- kits -----------------------------------------------------------------------------
    # What each player has left: the game's own count of each ability's charges, by key, and their
    # ultimate points. Three components hold the count (Equipment Charge, Signature Ability Resource
    # for kill resets, Ammo for Headhunter), guns use the last: only `Ability_` controllers count.
    # A controller the table does not know is left out and named in the warnings.
    kits, unkeyed = {}, set()
    for guid, t, value in con.execute("""
            select actor_net_guid, time_ms, value_i64 from fields
            where field_name = 'AuthResourceAmount' and value_i64 is not null
            order by time_ms, packet_id""").fetchall():
        cls = (actor_class.get(guid) or "").removeprefix("Default__")
        if not cls.startswith("Ability_"):
            continue
        name = cls.removeprefix("Ability_").removesuffix("_C")
        keys = ABILITY_KEYS.get(name)
        if keys is None:
            if not name.startswith("Rift_Passive"):
                unkeyed.add(name)
            continue
        subject = subject_of.get(instigator.get(guid))
        if subject:
            for key in keys:
                kits.setdefault(subject, {}).setdefault(key, []).append([t, value])
    if unkeyed:
        warnings.append(f"ability controllers with no key: {', '.join(sorted(unkeyed))}")
    for state, t, value in con.execute("""
            select actor_net_guid, time_ms, value_i64 from fields
            where field_name = 'NumUltimatePoints' and value_i64 is not null
            order by time_ms, packet_id""").fetchall():
        subject = state_subject.get(state)
        if subject:
            kits.setdefault(subject, {}).setdefault("X", []).append([t, value])
    code_of = {}
    for body, subject in subject_of.items():
        code = (actor_class.get(body) or "").removeprefix("Default__").split("_")[0].lower()
        if code:
            code_of[subject] = code
    for subject, kit in kits.items():
        for key, rows in list(kit.items()):
            rows.sort(key=lambda row: row[0])
            kit[key] = [row for i, row in enumerate(rows) if i == 0 or rows[i - 1][1] != row[1]]
        points = kit.get("X")
        if points:
            # The points held when a cast of the ultimate took them to zero.
            used = [c["t"] for c in casts if c["player"] == subject and c["slot"] == "X"]
            spent = [a[1] for a, b in zip(points, points[1:])
                     if b[1] == 0 and a[1] > 0 and any(abs(t - b[0]) <= 3000 for t in used)]
            cost = max(spent) if spent else ULT_POINTS.get(code_of.get(subject, ""))
            if cost:
                kit["cost"] = cost

    # ---- effects and carriers (from vrfkit's derived tables) --------------------------------
    effects, carriers = [], []
    taken = set()  # (actor guid, open ms) of every effect row already in
    effects_path = derived / "active_effects.parquet"
    if effects_path.exists():
        for guid, cls, kind, agent, x, y, start, end in con.execute(f"""
                select actor_net_guid, class_path, effect_type, agent, spawn_x, spawn_y, open_ms, close_ms
                from '{effects_path.as_posix()}' order by open_ms, actor_net_guid""").fetchall():
            taken.add((guid, start))
            effects.append({
                "start": start, "end": end, "kind": kind, "agent": agent or None,
                "cls": cls.rsplit(".", 1)[-1], "x": round(x), "y": round(y),
                "owner": subject_of.get(instigator.get(guid)), "_guid": guid,
            })
    else:
        warnings.append(f"{effects_path.name} not found; effects are empty")

    # vrfkit's extractor keeps only classes whose path names a smoke, a wall, a trap, fire...;
    # Sova's ExplosiveBolt and SonarBolt, Raze's grenades, KAY/O's knife match none of those words.
    # Every other actor an ability puts in the world (under /Game/Characters/<agent>/) is added
    # here, each open paired with the close after it, as the extractor pairs them.
    added = 0
    open_rows = {}
    for guid, t, event, path, x, y in con.execute("""
            select actor_net_guid, time_ms, event, class_path, spawn_x, spawn_y from actors
            where event in ('open', 'close') and class_path like '/Game/Characters/%'
            order by actor_net_guid, time_ms, packet_id""").fetchall():
        leaf = path.rsplit("/", 1)[-1].split(".", 1)[0]
        if not leaf.lower().startswith(ABILITY_ACTOR_PREFIXES):
            continue
        if event == "open":
            if guid in open_rows:  # reopened before closing: the first stays open-ended
                rest = open_rows.pop(guid)
                if (guid, rest[0]) not in taken:
                    effects.append(rest[1] | {"end": None})
                    added += 1
            if x is None or y is None:
                continue
            open_rows[guid] = (t, {
                "start": t, "end": None, "kind": "other", "agent": path.split("/")[3] or None,
                "cls": path.rsplit(".", 1)[-1], "x": round(x), "y": round(y),
                "owner": subject_of.get(instigator.get(guid)), "_guid": guid,
            })
        elif guid in open_rows:
            start, row = open_rows.pop(guid)
            if (guid, start) not in taken:
                effects.append(row | {"end": t})
                added += 1
    for guid, (start, row) in open_rows.items():
        if (guid, start) not in taken:
            effects.append(row)
            added += 1
    effects.sort(key=lambda e: (e["start"], e["cls"], e["x"], e["y"]))
    if added:
        warnings.append(f"{added} ability actor(s) added beyond vrfkit's active effects")

    # Shapes and paths, as [t, x, y] rows inside the effect's life:
    # - `points`: what a wall is built of, each point as the game adds it (Harbor's High Tide
    #   anchors, Viper's and Phoenix's screen points, Neon's tunnel points).
    # - `track`: where a projectile or a pawn went (its replicated movement), one sample per
    #   TRACK_MS at most, and the last one always.
    by_guid = {}
    for effect in effects:
        by_guid.setdefault(effect["_guid"], []).append(effect)

    def owning(guid, t):
        """The effect row of that actor alive at t."""
        for effect in by_guid.get(guid, ()):
            if effect["start"] <= t and (effect["end"] is None or t <= effect["end"]):
                return effect
        return None

    point_rows = 0
    for guid, t, value in con.execute(f"""
            select actor_net_guid, time_ms, value_str from fields
            where field_name in ({",".join(f"'{name}'" for name in WALL_POINT_FIELDS)}) and value_str is not null
            order by time_ms, packet_id""").fetchall():
        effect = owning(guid, t)
        vec = parse_vec(value)
        if effect is None or not vec:
            continue
        effect.setdefault("points", []).append([t, round(vec[0]), round(vec[1])])
        point_rows += 1

    moving = [g for g, rows in by_guid.items()
              if any(r["cls"].lower().startswith(("projectile_", "pawn_")) for r in rows)]
    track_rows = 0
    if moving:
        last = {}
        for guid, t, value in con.execute(f"""
                select actor_net_guid, time_ms, value_str from fields
                where field_name = 'ReplicatedMovement' and value_str is not null
                  and actor_net_guid in ({",".join(str(g) for g in moving)})
                order by time_ms, packet_id""").fetchall():
            effect = owning(guid, t)
            if effect is None:
                continue
            location = (json.loads(value).get("location") or {})
            if location.get("x") is None or location.get("y") is None:
                continue
            sample = [t, round(location["x"]), round(location["y"])]
            track = effect.setdefault("track", [])
            if track and t - track[-1][0] < TRACK_MS:
                last[id(effect)] = sample  # held back: kept only if it turns out to be the last
                continue
            track.append(sample)
            last.pop(id(effect), None)
            track_rows += 1
        for effect in effects:
            held = last.get(id(effect))
            if held and effect.get("track") and held[0] > effect["track"][-1][0]:
                effect["track"].append(held)
                track_rows += 1
    # Thrown on a precalculated path, the actor sends no movement; the game still says where it pops.
    for guid, t, value in con.execute("""
            select actor_net_guid, time_ms, value_str from fields
            where field_name = 'MulticastTriggerExplodeIndicator.IndicatorLocation' and value_str is not null
            order by time_ms, packet_id""").fetchall():
        effect = owning(guid, t)
        vec = parse_vec(value)
        if effect is None or not vec or not effect["cls"].lower().startswith("projectile_"):
            continue
        if len(effect.get("track", [])) < 2:
            effect["track"] = [[effect["start"], effect["x"], effect["y"]], [t, round(vec[0]), round(vec[1])]]
            track_rows += 2
    for effect in effects:
        del effect["_guid"]
    warnings.append(f"{point_rows} wall point(s), {track_rows} track sample(s) on effects")
    carrier_path = derived / "spike_carrier.parquet"
    if carrier_path.exists():
        for start, end, subject in con.execute(f"""
                select from_ms, to_ms, carrier_subject from '{carrier_path.as_posix()}'
                where carrier_subject is not null order by from_ms, to_ms""").fetchall():
            carriers.append({"from": start, "to": end, "player": subject})
    else:
        warnings.append(f"{carrier_path.name} not found; spike carriers are empty")

    # ---- blinds ---------------------------------------------------------------------------
    # Who was really blinded, as [start, end]: the game's own record on each body, plus nearsight
    # (Paranoia, Leer), which only the cast statistics name, each target with how long.
    blinds, running = {}, {}
    for guid, t, value in con.execute("""
            select actor_net_guid, time_ms, value_f64 from fields
            where field_name = 'LongestActiveBlindDuration' and value_f64 is not null
            order by time_ms, packet_id""").fetchall():
        subject = subject_of.get(guid)
        if subject is None:
            continue
        window = running.get(subject)
        if value > 0:
            end = t + round(value * 1000)
            if window:
                window[1] = max(window[1], end)
            else:
                running[subject] = window = [t, end]
                blinds.setdefault(subject, []).append(window)
        elif window:
            window[1] = t
            del running[subject]

    sources = {}
    for effect in effects:
        if effect["cls"] in NEARSIGHT_SOURCES and effect["owner"]:
            sources.setdefault(effect["owner"], []).append(effect["start"])
    stats, targets = {}, {}
    for t, body, name, v_int, v_float, v_str in con.execute(f"""
            select time_ms, actor_net_guid, field_name, value_i64, value_f64, value_str from fields
            where group_path like '%Comp_AbilityStatisticsReplicator_C'
              and field_name like 'AbilityCastsThisRound[%].Effects[%' and actor_net_guid in ({body_sql})
            order by time_ms, packet_id""").fetchall():
        matched = EFFECT_STAT.match(name)
        if matched:
            stats.setdefault((body, matched.group(1), matched.group(2)), []).append((t, v_str))
            continue
        matched = EFFECT_TARGET.match(name)
        if matched:
            row = targets.setdefault((t, body) + matched.groups()[:3], {})
            row[matched.group(4)] = v_int if matched.group(4) == "AffectedPlayer" else v_float
    last_seconds, seen_near = {}, set()
    for (t, body, cast, entry, slot), row in sorted(targets.items(), key=lambda item: item[0][0]):
        key = (body, cast, entry, slot)
        if "Value" in row:
            last_seconds[key] = row["Value"]
        if "AffectedPlayer" not in row:
            continue
        said = [name for at, name in stats.get((body, cast, entry), ()) if at <= t + 500]
        owner = subject_of.get(body)
        target = state_subject.get(row["AffectedPlayer"])
        if not said or said[-1] not in NEARSIGHT_STATS or not owner or not target:
            continue
        # The array is sent again when casts shift: only what a nearsight really just went off for.
        source = next((s for s in sources.get(owner, ()) if s <= t <= s + NEARSIGHT_AFTER_MS), None)
        if source is None or (target, source) in seen_near:
            continue
        seen_near.add((target, source))
        blinds.setdefault(target, []).append([t, t + round(last_seconds.get(key, 2.0) * 1000)])
    for subject, windows in list(blinds.items()):
        kept = sorted(w for w in windows if w[1] - w[0] >= BLIND_MIN_MS)
        if kept:
            blinds[subject] = kept
        else:
            del blinds[subject]

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
        "kits": kits,
        "blinds": blinds,
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
