"""Draft Sage API for pick/ban suggestions using a trained model."""

from __future__ import annotations

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional

import torch
import torch.nn as nn
from datetime import datetime, timezone


DRAFT_ORDER = [
    ("blue", "ban", 1),
    ("red", "ban", 1),
    ("blue", "ban", 2),
    ("red", "ban", 2),
    ("blue", "ban", 3),
    ("red", "ban", 3),
    ("blue", "pick", 1),
    ("red", "pick", 1),
    ("red", "pick", 2),
    ("blue", "pick", 2),
    ("blue", "pick", 3),
    ("red", "pick", 3),
    ("red", "ban", 4),
    ("blue", "ban", 4),
    ("red", "ban", 5),
    ("blue", "ban", 5),
    ("red", "pick", 4),
    ("blue", "pick", 4),
    ("blue", "pick", 5),
    ("red", "pick", 5),
]

MISSING_TIMESTAMP = 2**63 - 1


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def normalize_category(value: object) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def parse_date_to_ns(value: object) -> Optional[int]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        cleaned = text.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(cleaned)
    except ValueError:
        try:
            parsed = datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1_000_000_000)


class DraftMLP(nn.Module):
    """MLP for draft data using draft sequence plus patch embedding."""

    def __init__(self, feature_dims: dict, hidden_size: int = 256, output_size: int = 2):
        super().__init__()
        self.feature_dims = feature_dims

        self.champion_embedding = nn.Embedding(feature_dims["num_champions"], 16)
        self.patch_embedding = nn.Embedding(feature_dims["num_patches"], 4)
        self.action_embedding = nn.Embedding(feature_dims["num_actions"], 2)
        self.side_embedding = nn.Embedding(feature_dims["num_sides"], 2)
        self.event_embedding = nn.Embedding(feature_dims["num_events"], 4)
        self.league_embedding = nn.Embedding(feature_dims["num_leagues"], 4)
        self.team_embedding = nn.Embedding(feature_dims["num_teams"], 8)

        draft_input_size = feature_dims["draft_sequence"] * 16 + 4 + 2 + 2 + 4 + 4 + 8
        self.draft_encoder = nn.Sequential(
            nn.Linear(draft_input_size, hidden_size),
            nn.ReLU(),
            nn.Dropout(0.2),
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_size // 2, output_size),
        )

    def forward(self, features: dict[str, torch.Tensor]) -> torch.Tensor:
        draft_sequence = features["draft_sequence"]
        patch_index = features["patch_index"]
        action_type = features["action_type"]
        side = features["side"]
        event_index = features["event_index"]
        league_index = features["league_index"]
        team_index = features["team_index"]
        champion_priors = features.get("champion_priors")
        role_priors = features.get("role_priors")

        draft_embedded = self.champion_embedding(draft_sequence)
        draft_flat = draft_embedded.view(draft_embedded.size(0), -1)
        patch_embedded = self.patch_embedding(patch_index)
        action_embedded = self.action_embedding(action_type)
        side_embedded = self.side_embedding(side)
        event_embedded = self.event_embedding(event_index)
        league_embedded = self.league_embedding(league_index)
        team_embedded = self.team_embedding(team_index)
        combined = torch.cat(
            [
                draft_flat,
                patch_embedded,
                action_embedded,
                side_embedded,
                event_embedded,
                league_embedded,
                team_embedded,
            ],
            dim=1,
        )

        draft_encoded = self.draft_encoder(combined)
        logits = self.classifier(draft_encoded)
        if champion_priors is not None:
            logits = logits + champion_priors
        if role_priors is not None:
            logits = logits + role_priors
        return logits


def find_latest_run_dir(workspace_root: Path) -> Path | None:
    base = workspace_root / ".tmp"
    if not base.exists():
        return None
    candidates = []
    for model_path in base.rglob("model.pth"):
        run_dir = model_path.parent
        if (run_dir / "config.json").exists():
            candidates.append(run_dir)
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def load_champion_mapping(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, list):
        raise ValueError("Champion mapping must be a JSON list.")
    return payload


def build_champion_indexes(mapping_entries: list[dict]) -> tuple[dict[str, int], dict[int, str]]:
    champion2idx = {}
    idx2name = {}
    missing_key = normalize("MISSING")
    champion2idx[missing_key] = 0
    idx2name[0] = "MISSING"

    for i, entry in enumerate(mapping_entries, start=1):
        normalized_name = entry.get("normalized_name")
        if not normalized_name:
            continue
        sanitized = normalize(str(normalized_name))
        champion2idx[sanitized] = i
        idx2name[i] = entry.get("name") or str(normalized_name)
    return champion2idx, idx2name


def load_eligibility(path: Optional[Path], champion2idx: dict[str, int]) -> dict[str, list[int]]:
    if not path or not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    leagues_payload = payload.get("leagues")
    if not isinstance(leagues_payload, dict):
        return {}

    by_league: dict[str, list[int]] = {}
    for league_name, league_payload in leagues_payload.items():
        if not isinstance(league_payload, dict):
            continue
        first_seen = league_payload.get("first_seen")
        if not isinstance(first_seen, dict):
            continue
        normalized_league = normalize_category(league_name)
        if not normalized_league:
            continue
        vector = [MISSING_TIMESTAMP] * (len(champion2idx) - 1)
        for champ_name, date_value in first_seen.items():
            if champ_name is None or date_value is None:
                continue
            sanitized = normalize(str(champ_name))
            if not sanitized:
                continue
            idx = champion2idx.get(sanitized)
            if not idx:
                continue
            parsed_ns = parse_date_to_ns(date_value)
            if parsed_ns is None:
                continue
            vector[idx - 1] = parsed_ns
        by_league[normalized_league] = vector
    return by_league


def load_model_context(
    *,
    run_dir: Optional[Path] = None,
    model_path: Optional[Path] = None,
    config_path: Optional[Path] = None,
    champion_mapping_path: Optional[str] = None,
    eligibility_path: Optional[str] = None,
) -> dict:
    workspace_root = Path(__file__).resolve().parents[2]
    resolved_run_dir = run_dir or find_latest_run_dir(workspace_root)

    resolved_config = config_path
    resolved_model = model_path
    if resolved_run_dir:
        resolved_config = resolved_config or resolved_run_dir / "config.json"
        resolved_model = resolved_model or resolved_run_dir / "model.pth"

    if not resolved_model or not resolved_model.exists():
        raise FileNotFoundError("model.pth not found. Provide --model-path or --run-dir.")

    config = {}
    if resolved_config and resolved_config.exists():
        with resolved_config.open("r", encoding="utf-8") as handle:
            config = json.load(handle)

    mapping_path = champion_mapping_path or config.get("champion_mapping_path")
    if not mapping_path:
        raise FileNotFoundError("Champion mapping path missing.")

    eligibility_override = eligibility_path or config.get("champion_eligibility_path")

    state_dict = torch.load(resolved_model, map_location="cpu")
    feature_dims = {
        "num_champions": state_dict["champion_embedding.weight"].shape[0],
        "num_patches": state_dict["patch_embedding.weight"].shape[0],
        "num_actions": state_dict["action_embedding.weight"].shape[0],
        "num_sides": state_dict["side_embedding.weight"].shape[0],
        "num_events": state_dict["event_embedding.weight"].shape[0],
        "num_leagues": state_dict["league_embedding.weight"].shape[0],
        "num_teams": state_dict["team_embedding.weight"].shape[0],
        "draft_sequence": len(DRAFT_ORDER),
    }
    hidden_size = state_dict["draft_encoder.0.weight"].shape[0]
    output_size = state_dict["classifier.3.weight"].shape[0]

    model = DraftMLP(feature_dims, hidden_size=hidden_size, output_size=output_size)
    model.load_state_dict(state_dict)
    model.eval()

    mapping_entries = load_champion_mapping(Path(mapping_path))
    champion2idx, idx2name = build_champion_indexes(mapping_entries)
    eligibility = load_eligibility(
        Path(eligibility_override) if eligibility_override else None, champion2idx
    )

    return {
        "model": model,
        "device": torch.device("cpu"),
        "champion2idx": champion2idx,
        "idx2name": idx2name,
        "eligibility_by_league": eligibility,
        "feature_dims": feature_dims,
        "run_dir": resolved_run_dir,
    }


def build_unavailable_indices(payload: dict, champion2idx: dict[str, int]) -> set[int]:
    taken = set()
    for name in payload.get("fearlessLockout", []) or []:
        sanitized = normalize(str(name))
        idx = champion2idx.get(sanitized)
        if idx:
            taken.add(idx)
    for entry in payload.get("draft", []) or []:
        champion = entry.get("champion")
        if champion:
            sanitized = normalize(str(champion))
            idx = champion2idx.get(sanitized)
            if idx:
                taken.add(idx)
    return taken


def resolve_slot_index(payload: dict, draft_sequence: list[int]) -> Optional[int]:
    slot = payload.get("slot") or {}
    slot_side = slot.get("side")
    slot_type = slot.get("type")
    slot_num = slot.get("num")
    if slot_side and slot_type and slot_num:
        for index, (side, action_type, number) in enumerate(DRAFT_ORDER):
            if side == slot_side and action_type == slot_type and number == slot_num:
                return index
        return None
    for index, champion in enumerate(draft_sequence):
        if champion == 0:
            return index
    return len(DRAFT_ORDER) - 1


def build_draft_sequence(payload: dict, champion2idx: dict[str, int]) -> list[int]:
    lookup: dict[tuple[str, str, int], str] = {}
    for entry in payload.get("draft", []) or []:
        try:
            lookup[(entry.get("side"), entry.get("type"), int(entry.get("num")))] = entry.get(
                "champion"
            )
        except (TypeError, ValueError):
            continue
    sequence = [0] * len(DRAFT_ORDER)
    for idx, (side, action_type, number) in enumerate(DRAFT_ORDER):
        champion = lookup.get((side, action_type, number))
        if not champion:
            continue
        sanitized = normalize(str(champion))
        sequence[idx] = champion2idx.get(sanitized, 0)
    return sequence


def parse_game_date(payload: dict) -> Optional[int]:
    for key in ("game_date", "gameDate", "date"):
        value = payload.get(key)
        if not value:
            continue
        parsed_ns = parse_date_to_ns(value)
        if parsed_ns is not None:
            return parsed_ns
    return None


class DraftHandler(BaseHTTPRequestHandler):
    model: DraftMLP | None = None
    device: torch.device = torch.device("cpu")
    champion2idx: dict[str, int] = {}
    idx2name: dict[int, str] = {}
    eligibility_by_league: dict[str, list[int]] = {}
    feature_dims: dict[str, int] = {}

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

        status, response = select_champion(
            payload,
            self.model,
            self.champion2idx,
            self.idx2name,
            self.eligibility_by_league,
            self.feature_dims,
            device=self.device,
        )
        self._send_json(status, response)


def select_champion(
    payload: dict,
    model: DraftMLP | None,
    champion2idx: dict[str, int],
    idx2name: dict[int, str],
    eligibility_by_league: dict[str, list[int]],
    feature_dims: dict[str, int],
    *,
    device: torch.device,
) -> tuple[int, dict]:
    if model is None:
        return 500, {"error": "Model not loaded"}

    draft_sequence = build_draft_sequence(payload, champion2idx)
    slot_index = resolve_slot_index(payload, draft_sequence)
    if slot_index is None:
        return 400, {"error": "Invalid slot"}
    side, action_type, number = DRAFT_ORDER[slot_index]
    action_value = 1 if action_type == "pick" else 0
    side_value = 1 if side == "red" else 0

    patch_index = int(payload.get("patch_index", 0) or 0)
    league_index = int(payload.get("league_index", 0) or 0)
    team_index = int(payload.get("team_index", 0) or 0)

    if patch_index < 0 or patch_index >= feature_dims.get("num_patches", 1):
        patch_index = 0
    if league_index < 0 or league_index >= feature_dims.get("num_leagues", 1):
        league_index = 0
    if team_index < 0 or team_index >= feature_dims.get("num_teams", 1):
        team_index = 0

    features = {
        "draft_sequence": torch.tensor([draft_sequence], dtype=torch.long, device=device),
        "patch_index": torch.tensor([patch_index], dtype=torch.long, device=device),
        "action_type": torch.tensor([action_value], dtype=torch.long, device=device),
        "side": torch.tensor([side_value], dtype=torch.long, device=device),
        "event_index": torch.tensor([slot_index], dtype=torch.long, device=device),
        "league_index": torch.tensor([league_index], dtype=torch.long, device=device),
        "team_index": torch.tensor([team_index], dtype=torch.long, device=device),
    }

    blocked_indices = build_unavailable_indices(payload, champion2idx)
    output_size = model.classifier[-1].out_features
    mask = torch.ones(output_size, dtype=torch.bool, device=device)
    for idx in blocked_indices:
        if idx > 0 and idx - 1 < output_size:
            mask[idx - 1] = False

    league_key = normalize_category(payload.get("league"))
    game_date_value = parse_game_date(payload)
    if league_key and game_date_value is not None:
        eligibility = eligibility_by_league.get(league_key)
        if eligibility:
            for idx, threshold in enumerate(eligibility):
                if game_date_value < threshold:
                    mask[idx] = False

    if not mask.any():
        return 422, {"error": "No available champions"}

    with torch.no_grad():
        logits = model(features)
        masked_logits = logits.masked_fill(~mask, -1e9)
        pick_index = int(masked_logits.argmax(dim=1).item())

    champion_name = idx2name.get(pick_index + 1)
    if not champion_name:
        return 422, {"error": "Model returned unknown champion"}

    return 200, {"champion": champion_name, "slot": {"side": side, "type": action_type, "num": number}}


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve Draft Sage draft pick API.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--run-dir", default=None, help="Training run directory with model.pth + config.json.")
    parser.add_argument("--model-path", default=None, help="Path to model.pth (overrides run-dir).")
    parser.add_argument("--config-path", default=None, help="Path to config.json (overrides run-dir).")
    parser.add_argument(
        "--champion-mapping-path",
        default=None,
        help="Override champion mapping JSON path.",
    )
    parser.add_argument(
        "--eligibility-path",
        default=None,
        help="Override champion eligibility JSON path.",
    )
    args = parser.parse_args()

    context = load_model_context(
        run_dir=Path(args.run_dir) if args.run_dir else None,
        model_path=Path(args.model_path) if args.model_path else None,
        config_path=Path(args.config_path) if args.config_path else None,
        champion_mapping_path=args.champion_mapping_path,
        eligibility_path=args.eligibility_path,
    )

    DraftHandler.model = context["model"]
    DraftHandler.device = context["device"]
    DraftHandler.champion2idx = context["champion2idx"]
    DraftHandler.idx2name = context["idx2name"]
    DraftHandler.eligibility_by_league = context["eligibility_by_league"]
    DraftHandler.feature_dims = context["feature_dims"]

    server = HTTPServer((args.host, args.port), DraftHandler)
    run_note = f"run-dir={context['run_dir']}" if context.get("run_dir") else "run-dir=manual"
    print(f"Draft Sage API listening on http://{args.host}:{args.port} ({run_note})")
    server.serve_forever()


if __name__ == "__main__":
    main()
