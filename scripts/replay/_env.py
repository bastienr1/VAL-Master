"""Machine settings shared by the replay scripts.

Nothing about this PC or this player is committed: the scripts read three
settings from the real environment or from the repo's `.env.local` / `.env`,
the same files and the same precedence as `scripts/env.ts`.

    VAL_REPLAY_HOME    data folder: bin\\vrfkit.exe, .venv, raw\\, exports\\, cache\\
    VAL_REPLAY_ME      your PUUID (decides ALLY / ENEMY in a bundle)
    VAL_REPLAY_VRFKIT  the vrfkit clone (optional; default: "vrfkit" next to VAL_REPLAY_HOME)
"""
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def _file_env():
    values = {}
    for name in (".env.local", ".env"):  # later files win, as in scripts/env.ts
        try:
            lines = (REPO_ROOT / name).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values[key.strip()] = value
    return values


_FILE_ENV = _file_env()


def setting(name, hint=None):
    """A real environment variable wins over one from a file. Exits with the hint when it is required and missing."""
    value = os.environ.get(name) or _FILE_ENV.get(name)
    if not value and hint:
        sys.exit(f"Missing {name}. {hint}")
    return value


def home():
    return Path(setting("VAL_REPLAY_HOME", "Set it in .env.local to the replay data folder, e.g. D:\\Claude\\VAL-Master-Replays."))


def me():
    return setting("VAL_REPLAY_ME", "Set it in .env.local to your PUUID (profiles.riot_puuid in Supabase).")


def vrfkit_tools():
    clone = setting("VAL_REPLAY_VRFKIT")
    return (Path(clone) if clone else home().parent / "vrfkit") / "tools"


def cache_dir():
    return home() / "cache"
