"""Run pytest with the canonical service and its exact pinned local validator source.

Set FACTORY_INTENT_SOURCE and FACTORY_AODL_SOURCE to existing local Git checkouts.
No network, package installation, inference, approvals outside fixtures, or GPU work.
"""
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

PIN = "68231658f0ec0338464c0916a2329b9587444312"
ROOT = Path(__file__).resolve().parents[1]


def main():
    try:
        intent = Path(os.environ["FACTORY_INTENT_SOURCE"]).resolve()
        aodl = Path(os.environ["FACTORY_AODL_SOURCE"]).resolve()
    except KeyError as error:
        print(f"Set {error.args[0]} to the existing local checkout", file=sys.stderr)
        return 2
    if not (intent / "src/z0int/intent_service.py").is_file():
        print("FACTORY_INTENT_SOURCE has no canonical intent_service.py", file=sys.stderr)
        return 2
    archive = subprocess.run(["git", "-C", str(aodl), "archive", PIN, "aodl_contract"], capture_output=True)
    if archive.returncode:
        print("FACTORY_AODL_SOURCE must contain pinned commit " + PIN, file=sys.stderr)
        return archive.returncode
    # Extract only dependency source to an owned, automatically removed directory.
    with tempfile.TemporaryDirectory(prefix=".canonical-test-", dir=ROOT) as temporary:
        with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
            tar.extractall(temporary, filter="data")
        env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(intent / "src"), temporary]))
        command = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests", *sys.argv[1:]]
        print("Canonical service:", intent, "\nValidator pin:", PIN, "\nPytest:", " ".join(command), flush=True)
        return subprocess.run(command, cwd=ROOT, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
