"""Gate 1: does a vrfkit export match what the vault notes already established?

Usage: python gate1_check.py <export-dir>

Reference numbers come from the vault notes (vrf_events.py output):
  Lotus    -> 2026-10-01-VAL-Master-VRF-Replay-Extraction-Lotus (counts, scoreboard, timeline)
  Fracture -> 2026-10-01-Replay-Engine-Findings-Report (counts only)
Map transforms are the valorant-api.com constants quoted in the Findings Report, section 4.
"""
import json
import sys

import duckdb

import _env

ME_SUBJECT = _env.me()

LOTUS_SCOREBOARD = {  # net id -> (kills excluding self-deaths, deaths)
    0x38E: (22, 19), 0x2C6: (18, 19), 0x328: (17, 18), 0x538: (16, 19), 0x262: (12, 17),
    0x3F8: (22, 16), 0x4D8: (20, 18), 0x602: (18, 17), 0x59A: (17, 17), 0x478: (13, 17),
}
LOTUS_MY_TIMELINE = [  # (mm:ss.s, kind, opponent net id or None)
    ("01:10.8", "D", 0x602), ("02:16.9", "D", 0x602), ("04:07.6", "K", 0x3F8), ("04:24.0", "K", 0x4D8),
    ("05:47.2", "K", 0x4D8), ("05:49.1", "K", 0x3F8), ("07:32.1", "K", 0x602), ("08:37.9", "K", 0x4D8),
    ("08:58.2", "K", 0x478), ("09:03.6", "D", 0x3F8), ("10:22.3", "K", 0x3F8), ("12:58.9", "D", 0x3F8),
    ("13:14.6", "X", None), ("15:01.3", "K", 0x59A), ("15:45.5", "D", 0x59A), ("15:59.8", "D", 0x4D8),
    ("18:19.8", "D", 0x59A), ("19:55.4", "K", 0x59A), ("19:59.7", "K", 0x602), ("20:02.7", "D", 0x4D8),
    ("22:15.2", "D", 0x3F8), ("23:08.5", "K", 0x602), ("23:57.1", "D", 0x59A), ("25:10.8", "K", 0x4D8),
    ("25:15.9", "D", 0x59A), ("26:22.1", "K", 0x4D8), ("27:07.5", "D", 0x602), ("27:12.7", "D", 0x3F8),
    ("28:38.3", "D", 0x602), ("31:50.2", "K", 0x478), ("33:06.8", "K", 0x602), ("35:08.1", "K", 0x4D8),
    ("35:17.2", "D", 0x3F8), ("36:55.4", "D", 0x4D8), ("38:19.6", "K", 0x59A), ("38:22.3", "D", 0x4D8),
    ("38:37.3", "X", None),
]

REFS = {
    "00931947-d697-48fb-99e6-2f73620e41ab": {
        "name": "Lotus", "deaths": 177, "rounds": 24, "level": "/Game/Maps/Jam/Jam",
        "transform": (7.2e-05, -7.2e-05, 0.454789, 0.917752),
        "my_net_id": 0x2C6, "my_kills": 18,
        "scoreboard": LOTUS_SCOREBOARD, "my_timeline": LOTUS_MY_TIMELINE,
    },
    "0f3f6aa8-aa67-4a94-9298-864bd43b2106": {
        "name": "Fracture", "deaths": 159, "rounds": 21, "level": "/Game/Maps/Canyon/Canyon",
        "transform": (7.8e-05, -7.8e-05, 0.556952, 1.155886),
    },
}

out = sys.argv[1]
con = duckdb.connect()
ev = f"'{out}/events.parquet'"
mv = f"'{out}/movement.parquet'"
manifest = json.load(open(f"{out}/manifest.json", encoding="utf-8"))
ref = REFS[manifest["friendly_name"]]
print(f"match {manifest['friendly_name']} ({ref['name']}), build {manifest['replay_build']}")

results = []


def check(name, ok, detail):
    results.append(ok)
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


def to_ms(mmss):
    m, s = mmss.split(":")
    return int(m) * 60000 + round(float(s) * 1000)


# 1. Event counts
counts = dict(con.execute(f'select "group", count(*) from {ev} group by 1').fetchall())
print("event groups:", dict(sorted(counts.items())))
check(f"{ref['deaths']} characterDeath rows", counts.get("characterDeath") == ref["deaths"],
      counts.get("characterDeath"))
check(f"{ref['rounds']} roundStarted rows", counts.get("roundStarted") == ref["rounds"],
      counts.get("roundStarted"))

# 2. Kill log
deaths = con.execute(
    f"select time1, word0, word1 from {ev} where \"group\" = 'characterDeath' order by time1"
).fetchall()
kills, died = {}, {}
for _, killer, victim in deaths:
    died[victim] = died.get(victim, 0) + 1
    if killer != victim:
        kills[killer] = kills.get(killer, 0) + 1
board = {nid: (kills.get(nid, 0), died.get(nid, 0)) for nid in set(kills) | set(died)}
check("kill log names exactly 10 net ids", len(board) == 10, len(board))

# 3. Manifest players and identity
players = manifest["players"]
subjects = {p["subject"]: p for p in players}
manifest_bodies = {p["character_net_guid"] for p in players}
check("manifest.players has 10 entries", len(players) == 10, len(players))
check("my PUUID is in manifest.players", ME_SUBJECT in subjects, ME_SUBJECT in subjects)
check("manifest bodies equal kill-log net ids", manifest_bodies == set(board),
      f"manifest={len(manifest_bodies)} kill-log={len(board)}")
my_body = subjects.get(ME_SUBJECT, {}).get("character_net_guid")

# 4. Checks against the Lotus note (vrf_events.py itself is not on this PC)
if "scoreboard" in ref:
    mismatch = {hex(n): (board.get(n), r) for n, r in ref["scoreboard"].items() if board.get(n) != r}
    check("scoreboard K/D per net id equals the note", not mismatch,
          "all 10 equal" if not mismatch else mismatch)
    check(f"my subject's character_net_guid is {hex(ref['my_net_id'])}", my_body == ref["my_net_id"],
          hex(my_body) if my_body is not None else None)
    check(f"that body has {ref['my_kills']} kills", kills.get(my_body) == ref["my_kills"], kills.get(my_body))
if "my_timeline" in ref:
    mine = []
    for t, killer, victim in deaths:
        if killer == my_body and victim == my_body:
            mine.append((t, "X", None))
        elif killer == my_body:
            mine.append((t, "K", victim))
        elif victim == my_body:
            mine.append((t, "D", killer))
    worst, bad = 0, []
    if len(mine) == len(ref["my_timeline"]):
        for (t, kind, opp), (rt, rkind, ropp) in zip(mine, ref["my_timeline"]):
            delta = abs(t - to_ms(rt))
            worst = max(worst, delta)
            if kind != rkind or opp != ropp or delta > 100:
                bad.append((t, kind, opp, rt, rkind, ropp))
    check("my kill/death timeline equals the note row by row (order, opponent, time within 0.1 s)",
          len(mine) == len(ref["my_timeline"]) and not bad,
          f"{len(mine)} rows vs {len(ref['my_timeline'])} in note, worst time delta {worst} ms"
          if not bad else f"{len(mine)} rows, first mismatches: {bad[:3]}")

# 5. Movement coverage
# The checklist first asked for "10 distinct character_net_guid". That was wrong: movement.parquet
# also carries agent-controlled pawns (cameras, drones, Clove's post-death form). The real
# requirement is that every player body has movement, and that nothing unexplained moves.
mv_guids = {r[0] for r in con.execute(f"select distinct character_net_guid from {mv}").fetchall()}
check("all 10 player bodies have movement rows", manifest_bodies <= mv_guids,
      f"{len(manifest_bodies & mv_guids)}/10 present, {len(mv_guids)} movers in total")
others = con.execute(f"""
    with o as (select character_net_guid as g, count(*) as n from {mv}
               where character_net_guid not in ({', '.join(str(b) for b in manifest_bodies)}) group by 1),
         a as (select actor_net_guid as g, any_value(coalesce(archetype_path, class_path)) as kind
               from '{out}/actors.parquet' where event = 'open' group by 1)
    select coalesce(a.kind, '(no actor row)'), count(*), sum(o.n)
    from o left join a using (g) group by 1 order by 3 desc""").fetchall()
check("every non-player mover resolves to a named actor class",
      all(kind != "(no actor row)" for kind, _, _ in others),
      f"{sum(c for _, c, _ in others)} non-player movers in {len(others)} classes")
for kind, n_actors, n_rows in others:
    print(f"       {n_actors:>3} actors  {n_rows:>7} rows  {kind}")

# 6. Map and minimap transform (Gate 2 preview)
level = manifest["level_names_and_times"][0]["name"]
check(f"level is {ref['level']}", level == ref["level"], level)
XM, YM, XA, YA = ref["transform"]
live = "not (pos_x < -49000 and pos_z < -49000)"
inside, total, parked = con.execute(f"""
    with m as (select pos_y * {XM} + {XA} as u, pos_x * {YM} + {YA} as v, {live} as live from {mv})
    select count(*) filter (where live and u between 0 and 1 and v between 0 and 1),
           count(*) filter (where live), count(*) filter (where not live)
    from m""").fetchone()
box = con.execute(f"""
    select min(pos_y * {XM} + {XA}), max(pos_y * {XM} + {XA}),
           min(pos_x * {YM} + {YA}), max(pos_x * {YM} + {YA})
    from {mv} where {live}""").fetchone()
check("at least 99.9% of live positions land inside the minimap image", inside / total >= 0.999,
      f"{inside}/{total} ({100 * inside / total:.4f}%), {parked} parked rows dropped, "
      f"u {box[0]:.3f}..{box[1]:.3f}, v {box[2]:.3f}..{box[3]:.3f}")

print()
print("subject -> body, class, movement rows, time range, K/D")
rows = {g: (n, t0, t1) for g, n, t0, t1 in con.execute(
    f"select character_net_guid, count(*), min(time_ms), max(time_ms) from {mv} group by 1").fetchall()}
arch = dict(con.execute(f"""
    select actor_net_guid, any_value(coalesce(archetype_path, class_path))
    from '{out}/actors.parquet' where event = 'open' group by 1""").fetchall())
for p in sorted(players, key=lambda p: p["character_net_guid"]):
    g = p["character_net_guid"]
    n, t0, t1 = rows.get(g, (0, None, None))
    me = "  <- me" if p["subject"] == ME_SUBJECT else ""
    print(f"  {p['subject'][:8]}  {hex(g)}  {str(arch.get(g)):<28} rows={n:>7}  "
          f"{t0}..{t1} ms  K/D={board.get(g)}{me}")

print()
print(f"GATE 1 ({ref['name']}): {sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
