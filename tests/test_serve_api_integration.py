import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest
import urllib.request

REAL_RUN_DIR = Path(
    "/home/jirving/projects/lol/.tmp/"
    "training-clean-2025-weights-matrix-seriesid-elig-band-0p3-0p4/20260117_151849"
)


def can_bind_localhost() -> bool:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        sock.close()
        return True
    except PermissionError:
        return False


def get_free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_health(port: int, timeout_s: float = 8.0) -> bool:
    deadline = time.time() + timeout_s
    url = f"http://127.0.0.1:{port}/health"
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload.get("status") == "ok":
                return True
        except Exception:
            time.sleep(0.2)
    return False


def post_pick(port: int) -> dict:
    url = f"http://127.0.0.1:{port}/draft/pick"
    payload = {
        "slot": {"side": "blue", "type": "ban", "num": 1},
        "draft": [],
        "fearlessLockout": [],
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=2) as resp:
        return json.loads(resp.read().decode("utf-8"))


@pytest.mark.integration
def test_api_health_and_pick_integration():
    force_run = os.environ.get("RUN_INTEGRATION") == "1"
    if not force_run and not can_bind_localhost():
        pytest.skip("Localhost sockets not permitted in this environment.")
    assert REAL_RUN_DIR.exists(), "Expected training run directory to exist."

    port = get_free_port()
    process = subprocess.Popen(
        [
            sys.executable,
            "scripts/serve_api.py",
            "--port",
            str(port),
            "--run-dir",
            str(REAL_RUN_DIR),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    try:
        assert wait_for_health(port), "API health check did not become ready."
        response = post_pick(port)
        assert response.get("champion"), "API did not return a champion."
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
