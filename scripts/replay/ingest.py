"""Run the whole local pipeline for one replay: copy, validate, export, derive, reduce, check.

Usage (from the repo root, with the data folder's Python):
    <VAL_REPLAY_HOME>\\.venv\\Scripts\\python scripts\\replay\\ingest.py <match-id>

Stops at the first failing step and writes nothing outside VAL_REPLAY_HOME. The result is
<VAL_REPLAY_HOME>\\exports\\<first 8 of the id>-derived\\minimap.v1.json.gz, which you attach
to the match on its VOD review page.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import _env

HERE = Path(__file__).parent


def run(name, command, log=None):
    result = subprocess.run([str(part) for part in command], capture_output=True, text=True, encoding="utf-8")
    if log:
        log.write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        sys.stderr.write(result.stdout[-2000:] + result.stderr[-2000:])
        sys.exit(f"{name} failed (exit {result.returncode})")
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


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    match_id = sys.argv[1]
    short = match_id[:8]
    home = _env.home()
    tools = _env.vrfkit_tools()
    exe = home / "bin" / "vrfkit.exe"
    raw = home / "raw" / f"{match_id}.vrf"
    export = home / "exports" / short
    derived = home / "exports" / f"{short}-derived"
    bundle = derived / "minimap.v1.json.gz"
    python = sys.executable

    if not raw.exists():
        saved = Path(os.environ["LOCALAPPDATA"]) / "VALORANT" / "Saved" / "Demos" / f"{match_id}.vrf"
        if not saved.exists():
            sys.exit(f"No replay for {match_id}: looked in {raw.parent} and {saved.parent}")
        raw.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(saved, raw)  # the game's own copy is never touched
    derived.mkdir(parents=True, exist_ok=True)

    run("validate", [exe, "validate", raw], log=home / "exports" / f"{short}-validate.txt")
    run("export", [exe, "export", raw, "--out", export, "--checkpoints"], log=home / "exports" / f"{short}-export.txt")
    run("spike carrier", [python, tools / "extract_spike_carrier.py", "--export", export,
                          "--out", derived / "spike_carrier.parquet"])
    run("active effects", [python, tools / "extract_active_effects.py", "--export", export,
                           "--out", derived / "active_effects.parquet"])
    reduce = [python, HERE / "vrf_to_minimap.py", export]
    ref = vrfkit_ref(tools)
    if ref:
        reduce += ["--vrfkit-ref", ref]
    print(run("reduce", reduce))

    # Henrik is the independent check. An old match answers 404; Gate 2 then runs without it.
    henrik = _env.cache_dir() / f"henrik-v2-{match_id}.json"
    fetched = subprocess.run([python, str(HERE / "fetch_henrik.py"), match_id], capture_output=True, text=True)
    gate = [python, HERE / "gate2_check.py", bundle]
    if henrik.exists():
        gate += ["--henrik", henrik]
    else:
        print(f"Henrik has no data for this match ({fetched.stderr.strip()[:120]}); Gate 2 runs without it")
    checked = subprocess.run([str(part) for part in gate], capture_output=True, text=True, encoding="utf-8")
    (home / "exports" / f"{short}-gate2.txt").write_text(checked.stdout, encoding="utf-8")
    print(checked.stdout + checked.stderr)
    if checked.returncode != 0:
        sys.exit("Gate 2 failed: do not attach this bundle until the FAIL lines above are understood")
    print(f"Bundle ready: {bundle}")


if __name__ == "__main__":
    main()
