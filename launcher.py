"""Installs what the app needs (first run only), then starts it. Used by 'Start Panel Finder.bat'."""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REQ = ROOT / "requirements.txt"
STAMP = Path(sys.prefix) / "panel-finder-requirements.sha1"


def ensure_requirements():
    want = hashlib.sha1(REQ.read_bytes()).hexdigest()
    if STAMP.exists() and STAMP.read_text().strip() == want:
        return
    print("Installing the parts it needs (only happens once, takes a minute or two)...\n")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
                           "--upgrade", "-r", str(REQ)])
    STAMP.write_text(want)
    print()


if __name__ == "__main__":
    ensure_requirements()
    sys.path.insert(0, str(ROOT))
    import app  # noqa: E402

    sys.exit(app.main())
