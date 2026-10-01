"""Gate 2: is the minimap bundle correct and small?

Usage: python gate2_check.py <minimap.v1.json.gz> [--henrik <henrik-v2-match.json>]

Reads only what the browser will read (the bundle), plus valorant-api.com map data for the
spawn test and, when given, a cached Henrik v2 match as an independent source.
"""
import argparse
import bisect
import gzip
import json
import math
import statistics
import sys
from pathlib import Path

import _env

MAPS_CACHE = _env.cache_dir() / "valorant-api-maps.json"  # written by vrf_to_minimap.py
EXPECT = {  # from the vault notes
    "00931947-d697-48fb-99e6-2f73620e41ab": {"rounds": 24, "kills": 177, "score": (13, 11)},
    "0f3f6aa8-aa67-4a94-9298-864bd43b2106": {"rounds": 21, "kills": 159},
}

ap = argparse.ArgumentParser()
ap.add_argument("bundle", type=Path)
ap.add_argument("--henrik", type=Path)
args = ap.parse_args()

size = args.bundle.stat().st_size
bundle = json.loads(gzip.decompress(args.bundle.read_bytes()))
match, players, rounds, kills = bundle["match"], bundle["players"], bundle["rounds"], bundle["kills"]
tracks = bundle["tracks"]["byPlayer"]
expect = EXPECT.get(match["matchId"], {})
team = {p["subject"]: p["team"] for p in players}
me = next(p["subject"] for p in players if p["isMe"])
results = []


def check(name, ok, detail):
    results.append(bool(ok))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


def info(name, detail):
    print(f"[info] {name}: {detail}")


times = {s: [row[0] for row in rows] for s, rows in tracks.items()}


def sample(subject, t):
    """Last track sample at or before t."""
    i = bisect.bisect_right(times[subject], t) - 1
    return tracks[subject][i] if i >= 0 else None


def dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)


def pct(values, q):
    values = sorted(values)
    return values[min(len(values) - 1, int(q * len(values)))]


print(f"bundle {args.bundle.name}: {match['matchId']} {match['mapUrl']} {match['build']}")

# ---- size and counts ---------------------------------------------------------------------
check("file size under 3 MB gzipped", size < 3_000_000, f"{size:,} bytes")
check("10 players", len(players) == 10, len(players))
if "rounds" in expect:
    check(f"{expect['rounds']} rounds", len(rounds) == expect["rounds"], len(rounds))
    check(f"{expect['kills']} kills", len(kills) == expect["kills"], len(kills))
ally = sum(r["winner"] == "ALLY" for r in rounds)
if "score" in expect:
    check(f"score {expect['score'][0]}-{expect['score'][1]}", (ally, len(rounds) - ally) == expect["score"],
          f"{ally}-{len(rounds) - ally}")
check("every round has a barrier time, an end time, a winner and a side",
      all(r["barrierMs"] and r["endMs"] and r["winner"] and r["side"] for r in rounds),
      f"{sum(bool(r['barrierMs'] and r['endMs'] and r['winner'] and r['side']) for r in rounds)}/{len(rounds)}")
buy = [r["barrierMs"] - r["buyStartMs"] for r in rounds if r["barrierMs"]]
info("buy phase length per round (s)", " ".join(f"{b / 1000:.1f}" for b in buy))
check("5 allies and 5 enemies", sorted(team.values()).count("ALLY") == 5, sorted(team.values()))
check("every kill names a killer and a victim from the roster",
      all(k["killer"] in team and k["victim"] in team for k in kills), len(kills))
unknown_slots = sorted({c["slot"] for c in bundle["casts"] if c["slot"].startswith("?")})
check("every cast slot is mapped", not unknown_slots, unknown_slots or
      {s: sum(c["slot"] == s for c in bundle["casts"]) for s in "CQEX"})

# ---- spawn test ----------------------------------------------------------------------------
game_map = next(m for m in json.loads(MAPS_CACHE.read_text(encoding="utf-8")) if m["mapUrl"] == match["mapUrl"])
spawn = {c["superRegionName"].split()[0].lower(): c["location"] for c in game_map["callouts"] or []
         if c["regionName"] == "Spawn"}
r1 = rounds[0]
# The checklist asked for "barrierMs - 5000". By then players stand at the barriers, and on Summit
# an attacker at the barrier is as close to the defender spawn as to their own (the test failed
# there with correct data). Three seconds after the round starts everyone is still in spawn.
t_spawn = r1["buyStartMs"] + 3000
side_of = {"ALLY": r1["side"], "ENEMY": "defender" if r1["side"] == "attacker" else "attacker"}
own, other, inside = [], [], 0
for p in players:
    row = sample(p["subject"], t_spawn)
    my_side = side_of[p["team"]]
    their_side = "defender" if my_side == "attacker" else "attacker"
    own.append(dist(row[1], row[2], spawn[my_side]["x"], spawn[my_side]["y"]))
    other.append(dist(row[1], row[2], spawn[their_side]["x"], spawn[their_side]["y"]))
    u = row[2] * game_map["xMultiplier"] + game_map["xScalarToAdd"]
    v = row[1] * game_map["yMultiplier"] + game_map["yScalarToAdd"]
    inside += 0 <= u <= 1 and 0 <= v <= 1
check("spawn test: 3 s into R1, every player is nearer their own spawn than the other",
      all(a < b for a, b in zip(own, other)),
      f"own spawn {min(own):.0f}-{max(own):.0f} cm, other spawn {min(other):.0f}-{max(other):.0f} cm")
check("spawn test: all 10 land inside the minimap image", inside == 10, f"{inside}/10")

# ---- kill-distance test ----------------------------------------------------------------------
gaps = []
for k in kills:
    row = sample(k["victim"], k["t"])
    gaps.append(dist(row[1], row[2], k["vx"], k["vy"]))
check("kill test: victim's last 10 Hz sample is within 150 cm of the kill position",
      max(gaps) <= 150, f"median {statistics.median(gaps):.0f} cm, max {max(gaps):.0f} cm, "
      f"{sum(g > 150 for g in gaps)} over 150")

# ---- alive ---------------------------------------------------------------------------------
all_alive = sum(all(sample(p["subject"], r["barrierMs"])[4] == 1 for p in players)
                for r in rounds if r["barrierMs"])
check("all 10 players are alive at every barrier drop", all_alive == len(rounds), f"{all_alive}/{len(rounds)} rounds")
# `alive` is a per-sample flag, so it only turns 0 on the first sample after the death. Probe one
# second after the round was decided: the body keeps emitting samples for ~2.7 s after a death.
wiped = []
for r in rounds:
    if r["how"] == "elimination":
        loser = "ENEMY" if r["winner"] == "ALLY" else "ALLY"
        wiped.append(sum(sample(p["subject"], r["endMs"] + 1000)[4] for p in players if p["team"] == loser) == 0)
check("in every elimination round the losing team has nobody alive 1 s after the end", all(wiped),
      f"{sum(wiped)}/{len(wiped)} elimination rounds")
if match["matchId"].startswith("00931947"):
    # From the Lotus note: Clove ult after the 12:58.9 death, expiry 13:14.6; Sage revive 15:55.6, death 15:59.8
    probes = [(785_000, 1, "R9 during Not Dead Yet"), (796_000, 0, "R9 after it expired"),
              (950_000, 0, "R11 dead before the revive"), (957_000, 1, "R11 after Sage's revive"),
              (961_000, 0, "R11 after the second death")]
    got = [(sample(me, t)[4], want, label) for t, want, label in probes]
    check("my revives on Lotus are tracked (Clove ult R9, Sage revive R11)",
          all(a == want for a, want, _ in got), ", ".join(f"{label}={a}" for a, _, label in got))

# ---- Henrik cross-check ------------------------------------------------------------------------
if args.henrik:
    henrik = json.loads(args.henrik.read_text(encoding="utf-8"))["data"]
    hk = sorted(henrik["kills"], key=lambda k: k["kill_time_in_match"])
    check("Henrik has the same number of kills", len(hk) == len(kills), f"{len(hk)} vs {len(kills)}")
    pairs = list(zip(kills, hk))
    same = sum(k["victim"] == h["victim_puuid"] and k["killer"] == h["killer_puuid"] for k, h in pairs)
    check("same killer and victim PUUID, kill by kill, in time order", same == len(pairs), f"{same}/{len(pairs)}")
    offsets = [h["kill_time_in_match"] - k["t"] for k, h in pairs if k["victim"] == h["victim_puuid"]]
    check("Henrik's match clock is the replay clock plus a constant (spread under 250 ms)",
          max(offsets) - min(offsets) < 250,
          f"offset {statistics.median(offsets):.0f} ms, spread {max(offsets) - min(offsets)} ms")
    d = [dist(k["vx"], k["vy"], h["victim_death_location"]["x"], h["victim_death_location"]["y"])
         for k, h in pairs if k["victim"] == h["victim_puuid"]]
    check("victim position within 50 cm of Henrik's victim_death_location (95% of kills)",
          pct(d, 0.95) <= 50, f"median {statistics.median(d):.1f} cm, p95 {pct(d, 0.95):.1f} cm, max {max(d):.1f} cm")
    track_d, yaw_d = [], []
    for k, h in pairs:
        for loc in h.get("player_locations_on_kill") or []:
            row = sample(loc["player_puuid"], k["t"])
            if row is None or row[4] == 0:
                continue
            track_d.append(dist(row[1], row[2], loc["location"]["x"], loc["location"]["y"]))
            yaw_d.append(abs((row[3] - math.degrees(loc["view_radians"]) + 180) % 360 - 180))
    check("10 Hz tracks within 100 cm of Henrik's player_locations_on_kill (95% of samples)",
          pct(track_d, 0.95) <= 100,
          f"{len(track_d)} samples, median {statistics.median(track_d):.1f} cm, p95 {pct(track_d, 0.95):.1f} cm")
    info("yaw vs Henrik view_radians", f"median difference {statistics.median(yaw_d):.1f} deg, "
         f"p95 {pct(yaw_d, 0.95):.1f} deg")
    # Compare weapon identity, not spelling: vrfkit's name table lags the game ("Compact Pistol" for
    # Bandit, no entry for Warden). Each Henrik gun must map to exactly one bundle class and back.
    weapon_cls = [w["cls"] for w in bundle["weapons"]]
    weapon_name = [w["name"] or w["cls"] for w in bundle["weapons"]]
    guns = [(weapon_cls[k["weapon"]] if k["weapon"] is not None else None, h["damage_weapon_name"])
            for k, h in pairs if h.get("damage_weapon_name")]
    by_cls, by_name = {}, {}
    for cls, name in guns:
        by_cls.setdefault(cls, set()).add(name)
        by_name.setdefault(name, set()).add(cls)
    clash = {c: sorted(n) for c, n in by_cls.items() if len(n) > 1}
    clash.update({n: sorted(map(str, c)) for n, c in by_name.items() if len(c) > 1})
    check("kill weapon: each Henrik gun maps to exactly one weapon class and back", not clash,
          f"{len(guns)} gun kills, {len(by_name)} guns" if not clash else clash)
    renamed = sorted({(weapon_name[weapon_cls.index(c)], n) for c, n in guns
                      if c is not None and weapon_name[weapon_cls.index(c)] != n})
    info("gun names where vrfkit's table differs from Henrik (bundle | Henrik)", renamed or "none")
    info("kills where Henrik names no gun", sorted({weapon_cls[k["weapon"]] for k, h in pairs
                                                    if not h.get("damage_weapon_name") and k["weapon"] is not None})[:10])

    hr = henrik["rounds"]
    colour = {"ALLY": next(p["teamName"] for p in players if p["team"] == "ALLY"),
              "ENEMY": next(p["teamName"] for p in players if p["team"] == "ENEMY")}
    same_winner = sum(colour[r["winner"]] == h["winning_team"] for r, h in zip(rounds, hr))
    check("round winners equal Henrik's", same_winner == len(rounds), f"{same_winner}/{len(rounds)}")
    info("round end types (bundle | Henrik)", sorted({(r["how"], h["end_type"]) for r, h in zip(rounds, hr)}))
    hplants = [(i + 1, h["plant_events"]) for i, h in enumerate(hr) if h["bomb_planted"]]
    bplants = {p["round"]: p for p in bundle["spike"]["plants"]}
    plant_ok = sum(n in bplants and bplants[n]["site"] == e["plant_site"]
                   and bplants[n]["player"] == (e["planted_by"] or {}).get("puuid") for n, e in hplants)
    check("plants: same rounds, site and planter as Henrik", plant_ok == len(hplants) == len(bplants),
          f"{plant_ok}/{len(hplants)} Henrik plants, {len(bplants)} in bundle")
    pd = [dist(bplants[n]["x"], bplants[n]["y"], e["plant_location"]["x"], e["plant_location"]["y"])
          for n, e in hplants if n in bplants]
    info("plant position vs Henrik", f"max {max(pd):.1f} cm" if pd else "no plants")

    # What a Henrik-only timeline could use: is kill_time_in_match - kill_time_in_round the barrier drop?
    offset = statistics.median(offsets)
    derived = {}
    for h in hk:
        derived.setdefault(h["round"] + 1, []).append(h["kill_time_in_match"] - h["kill_time_in_round"])
    err = [statistics.median(v) - offset - rounds[n - 1]["barrierMs"] for n, v in sorted(derived.items())]
    within = [max(v) - min(v) for v in derived.values()]
    info("Henrik (kill_time_in_match - kill_time_in_round) minus replay barrier, per round (ms)",
         " ".join(f"{e:.0f}" for e in err))
    check("Henrik's kill_time_in_round counts from the barrier drop (every round within 300 ms)",
          max(abs(e) for e in err) <= 300, f"max {max(abs(e) for e in err):.0f} ms over {len(err)} rounds; "
          f"values inside one round differ by up to {max(within)} ms")
    # What VAL Master does today: round start = first kill's match time
    first = {n: min(h["kill_time_in_match"] for h in hk if h["round"] + 1 == n) for n in derived}
    today = {n: (first[n] - first[1]) - (rounds[n - 1]["barrierMs"] - rounds[0]["barrierMs"]) for n in sorted(first)}
    info("error of today's first-kill round placement vs the replay barrier, per round (s)",
         " ".join(f"R{n}:{e / 1000:+.1f}" for n, e in today.items()))
    info("today's placement error", f"max late {max(today.values()) / 1000:.1f} s, "
         f"max early {min(today.values()) / 1000:.1f} s")

print()
print(f"GATE 2 ({match['mapUrl'].rsplit('/', 1)[-1]}): {sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
