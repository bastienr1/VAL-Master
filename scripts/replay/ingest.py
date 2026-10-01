"""Turn replays into minimap bundles: validate, export, derive, reduce, check.

Usage (from the repo root; `npm run replay:ingest -- <args>` does the same):
    <VAL_REPLAY_HOME>\\.venv\\Scripts\\python scripts\\replay\\ingest.py <match-id>
    <VAL_REPLAY_HOME>\\.venv\\Scripts\\python scripts\\replay\\ingest.py --all [--limit N] [--retry-failed] [--force] [--keep-exports]

One match: copies the replay into the data folder and keeps the full export next to the bundle.

--all: every replay the game has saved (%LOCALAPPDATA%\\VALORANT\\Saved\\Demos), newest first.
A replay that already has a bundle is skipped, so running it again only does the new ones. The
game's own files are read in place and never modified. The ~70 MB export of each match is deleted
once its bundle is written (keep it with --keep-exports). A replay that cannot be converted (a
game build vrfkit does not support, a mode without two teams of five, a match you were not in)
is reported and skipped; the others still run.

Either way the result is <VAL_REPLAY_HOME>\\exports\\<first 8 of the id>-derived\\minimap.v1.json.gz.
A bundle is kept only if Gate 2 passes. Nothing is written outside VAL_REPLAY_HOME.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import _env

HERE = Path(__file__).parent
BUNDLE_NAME = "minimap.v1.json.gz"
STEP_TIMEOUT_S = 600


class StepFailed(Exception):
    def __init__(self, step, detail):
        super().__init__(f"{step}: {detail}")
        self.step = step
        self.detail = detail


def run(name, command, log=None):
    try:
        result = subprocess.run([str(part) for part in command], capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=STEP_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        raise StepFailed(name, f"no result after {STEP_TIMEOUT_S} s") from None
    if log:
        log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        lines = [line.strip() for line in (result.stderr + result.stdout).splitlines() if line.strip()]
        raise StepFailed(name, lines[-1][:200] if lines else f"exit {result.returncode}")
    return result.stdout


def vrfkit_ref(tools):
    """What decoded the replay, for the bundle's `parser.vrfkit`: a setting, else the clone's commit."""
    ref = _env.setting("VAL_REPLAY_VRFKIT_REF")
    if ref:
        return ref
    clone = tools.parent
    found = subprocess.run(
        ["git", "-c", f"safe.directory={clone.as_posix()}", "-C", str(clone), "rev-parse", "--short", "HEAD"],
        capture_output=True, text=True)
    return found.stdout.strip() or None


def saved_replays():
    return Path(os.environ["LOCALAPPDATA"]) / "VALORANT" / "Saved" / "Demos"


def bundle_path(home, match_id):
    return home / "exports" / f"{match_id[:8]}-derived" / BUNDLE_NAME


def ingest(match_id, replay, keep_export):
    """Runs every step for one replay. Returns the last line of the Gate 2 output."""
    short = match_id[:8]
    home = _env.home()
    tools = _env.vrfkit_tools()
    exe = home / "bin" / "vrfkit.exe"
    export = home / "exports" / short
    derived = home / "exports" / f"{short}-derived"
    bundle = derived / BUNDLE_NAME
    python = sys.executable
    derived.mkdir(parents=True, exist_ok=True)

    try:
        run("validate", [exe, "validate", replay], log=home / "exports" / f"{short}-validate.txt")
        run("export", [exe, "export", replay, "--out", export, "--checkpoints"],
            log=home / "exports" / f"{short}-export.txt")
        # vrfkit's own extractors add the spike carrier and the utility layer. Either can fail on a
        # replay it has not seen the like of; the bundle is still worth having without that layer.
        notes = []
        for name, script, output in (
                ("spike carrier", "extract_spike_carrier.py", derived / "spike_carrier.parquet"),
                ("active effects", "extract_active_effects.py", derived / "active_effects.parquet")):
            output.unlink(missing_ok=True)
            try:
                run(name, [python, tools / script, "--export", export, "--out", output])
            except StepFailed:
                output.unlink(missing_ok=True)
                notes.append(f"no {name} data")
        reduce = [python, HERE / "vrf_to_minimap.py", export]
        ref = vrfkit_ref(tools)
        if ref:
            reduce += ["--vrfkit-ref", ref]
        run("reduce", reduce)

        # Henrik is the independent check. An old match answers 404; Gate 2 then runs without it.
        henrik = _env.cache_dir() / f"henrik-v2-{match_id}.json"
        subprocess.run([python, str(HERE / "fetch_henrik.py"), match_id], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=STEP_TIMEOUT_S)
        gate = [python, HERE / "gate2_check.py", bundle]
        if henrik.exists():
            gate += ["--henrik", henrik]
        checked = subprocess.run([str(part) for part in gate], capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=STEP_TIMEOUT_S)
        (home / "exports" / f"{short}-gate2.txt").write_text(checked.stdout + checked.stderr, encoding="utf-8")
        lines = [line for line in checked.stdout.splitlines() if line.strip()]
        verdict = lines[-1] if lines else "no output"
        if checked.returncode != 0:
            failed = [line for line in lines if line.startswith("[FAIL]")]
            raise StepFailed("gate 2", failed[0][:200] if failed else verdict[:200])
        if not henrik.exists():
            notes.append("no Henrik data")
        bundle.with_name(BUNDLE_NAME + ".rejected").unlink(missing_ok=True)  # from an earlier failed attempt
        return verdict + (f" ({', '.join(notes)})" if notes else "")
    except StepFailed:
        # A bundle that did not pass must not be picked up and attached.
        if bundle.exists():
            bundle.replace(bundle.with_name(BUNDLE_NAME + ".rejected"))
        raise
    finally:
        if not keep_export:
            shutil.rmtree(export, ignore_errors=True)


def one(match_id):
    home = _env.home()
    raw = home / "raw" / f"{match_id}.vrf"
    if not raw.exists():
        saved = saved_replays() / f"{match_id}.vrf"
        if not saved.exists():
            sys.exit(f"No replay for {match_id}: looked in {raw.parent} and {saved.parent}")
        raw.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(saved, raw)  # the game's own copy is never touched
    try:
        verdict = ingest(match_id, raw, keep_export=True)
    except StepFailed as failure:
        sys.exit(f"{failure.step} failed: {failure.detail}")
    print(verdict)
    print(f"Bundle ready: {bundle_path(home, match_id)}")


def failure_note(home, match_id):
    """Left beside a replay that could not be converted, so the next --all does not try it again."""
    return home / "exports" / f"{match_id[:8]}-derived" / "ingest-failed.txt"


def every(limit, force, retry_failed, keep_exports):
    home = _env.home()
    replays = sorted(saved_replays().glob("*.vrf"), key=lambda p: p.stat().st_mtime, reverse=True)
    prefixes = {}
    for replay in replays:
        prefixes.setdefault(replay.stem[:8], []).append(replay.stem)
    clashes = {p: ids for p, ids in prefixes.items() if len(ids) > 1}
    if clashes:
        sys.exit(f"Two replays share the same first 8 characters, which name the output folder: {clashes}")

    done = [r for r in replays if bundle_path(home, r.stem).exists() and not force]
    known_failures = [r for r in replays if r not in done and failure_note(home, r.stem).exists()
                      and not (force or retry_failed)]
    todo = [r for r in replays if r not in done and r not in known_failures]
    if limit:
        todo = todo[:limit]
    print(f"{len(replays)} replays in {saved_replays()}: {len(done)} already have a bundle, "
          f"{len(known_failures)} failed before (--retry-failed tries them again), {len(todo)} to convert")

    converted, failed = [], []
    for index, replay in enumerate(todo, 1):
        started = time.monotonic()
        label = f"[{index}/{len(todo)}] {replay.stem[:8]}"
        note = failure_note(home, replay.stem)
        try:
            verdict = ingest(replay.stem, replay, keep_exports)
            note.unlink(missing_ok=True)
            converted.append(replay.stem)
            print(f"{label}  ok      {time.monotonic() - started:4.0f} s  {verdict}", flush=True)
        except StepFailed as failure:
            note.write_text(f"{failure}\nvrfkit {vrfkit_ref(_env.vrfkit_tools())}\n", encoding="utf-8")
            failed.append((replay.stem, failure))
            print(f"{label}  SKIPPED {time.monotonic() - started:4.0f} s  {failure}", flush=True)

    print()
    print(f"Converted {len(converted)}, skipped {len(failed)}, already done {len(done)}, "
          f"failed before {len(known_failures)}.")
    if failed:
        print("Skipped replays (no bundle, so nothing to attach):")
        for match_id, failure in failed:
            print(f"  {match_id}  {failure}")
    print(f"Bundles are in {home / 'exports'}. Link that folder in VAL Master (Match Library) to attach them.")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("match_id", nargs="?", help="one match: the replay's file name without .vrf")
    ap.add_argument("--all", action="store_true", help="every saved replay that has no bundle yet")
    ap.add_argument("--limit", type=int, help="with --all: stop after this many conversions")
    ap.add_argument("--force", action="store_true", help="with --all: redo replays that already have a bundle")
    ap.add_argument("--retry-failed", action="store_true",
                    help="with --all: try again the replays that failed before (after a vrfkit update)")
    ap.add_argument("--keep-exports", action="store_true", help="with --all: keep each match's full export")
    args = ap.parse_args()
    if args.all == bool(args.match_id):
        ap.error("give a match id, or --all")
    if args.all:
        every(args.limit, args.force, args.retry_failed, args.keep_exports)
    else:
        one(args.match_id)


if __name__ == "__main__":
    main()
