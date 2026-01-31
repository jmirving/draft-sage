"""Minimal Draft Sage API for pick/ban suggestions."""

from __future__ import annotations

import argparse
import json
import random
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Iterable


VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?$")


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def parse_version(text: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.match(text)
    if not match:
        return (0, 0, 0)
    major, minor, patch = match.groups()
    return (int(major), int(minor), int(patch or 0))


def find_latest_ddragon(workspace_root: Path) -> Path | None:
    base = workspace_root / "lol-ddragon-snapshot-cron" / "data" / "ddragon" / "extracted"
    if not base.exists():
        return None
    candidates = [path for path in base.iterdir() if path.is_dir() and VERSION_PATTERN.match(path.name)]
    if not candidates:
        return None
    latest = max(candidates, key=lambda path: parse_version(path.name))
    return latest


def load_champions(workspace_root: Path) -> list[dict[str, str]]:
    latest = find_latest_ddragon(workspace_root)
    if latest is not None:
        path = latest / latest.name / "data" / "en_US" / "champion.json"
        if path.exists():
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
            return sorted(
                [
                    {
                        "name": champ["name"],
                        "normalized": normalize(champ["name"]),
                    }
                    for champ in payload.get("data", {}).values()
                ],
                key=lambda row: row["name"],
            )
    fallback = workspace_root / "draft-sage" / "resources" / "champions.json"
    with fallback.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    return sorted(
        [
            {
                "name": champ["name"],
                "normalized": normalize(champ["name"]),
            }
            for champ in payload.get("data", {}).values()
        ],
        key=lambda row: row["name"],
    )


def build_unavailable(payload: dict) -> set[str]:
    taken = set(normalize(name) for name in payload.get("fearlessLockout", []) if name)
    for entry in payload.get("draft", []) or []:
        champion = entry.get("champion")
        if champion:
            taken.add(normalize(champion))
    return taken


def pick_champion(champions: list[dict[str, str]], unavailable: Iterable[str]) -> str | None:
    blocked = set(unavailable)
    available = [champion for champion in champions if champion["normalized"] not in blocked]
    if not available:
        return None
    return random.choice(available)["name"]


class DraftHandler(BaseHTTPRequestHandler):
    champions: list[dict[str, str]] = []

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/draft/pick":
            self._send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body.decode("utf-8")) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        unavailable = build_unavailable(payload)
        choice = pick_champion(self.champions, unavailable)
        if not choice:
            self._send_json(422, {"error": "No available champions"})
            return
        self._send_json(200, {"champion": choice})


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Draft Sage draft pick API.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()

    workspace_root = Path(__file__).resolve().parents[2]
    DraftHandler.champions = load_champions(workspace_root)

    server = HTTPServer((args.host, args.port), DraftHandler)
    print(f"Draft Sage API listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
