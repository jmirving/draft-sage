from pathlib import Path
import subprocess
import sys

import torch

from scripts.serve_api import (
    DraftMLP,
    build_champion_indexes,
    load_model_context,
    normalize,
    select_champion,
)

REAL_RUN_DIR = Path(
    "/home/jirving/projects/lol/.tmp/"
    "training-clean-2025-weights-matrix-seriesid-elig-band-0p3-0p4/20260117_151849"
)


def build_model(output_size: int) -> DraftMLP:
    feature_dims = {
        "num_champions": output_size + 1,
        "num_patches": 2,
        "num_actions": 2,
        "num_sides": 2,
        "num_events": 20,
        "num_leagues": 1,
        "num_teams": 1,
        "draft_sequence": 20,
    }
    model = DraftMLP(feature_dims, hidden_size=8, output_size=output_size)
    for param in model.parameters():
        param.data.zero_()
    # Bias logits so index 1 is preferred, then index 2, then index 0.
    model.classifier[3].bias.data = torch.tensor([0.1, 0.5, 0.2])
    model.eval()
    return model


def make_model_context():
    mapping_entries = [
        {"normalized_name": "aatrox", "name": "Aatrox"},
        {"normalized_name": "ahri", "name": "Ahri"},
        {"normalized_name": "akali", "name": "Akali"},
    ]
    champion2idx, idx2name = build_champion_indexes(mapping_entries)
    return {
        "model": build_model(output_size=3),
        "device": torch.device("cpu"),
        "champion2idx": champion2idx,
        "idx2name": idx2name,
        "eligibility_by_league": {},
        "feature_dims": {
            "num_patches": 2,
            "num_leagues": 1,
            "num_teams": 1,
        },
    }


def base_payload():
    return {
        "slot": {"side": "blue", "type": "ban", "num": 1},
        "draft": [],
        "fearlessLockout": [],
    }


def test_model_missing():
    context = make_model_context()
    context["model"] = None
    status, payload = select_champion(
        base_payload(),
        context["model"],
        context["champion2idx"],
        context["idx2name"],
        context["eligibility_by_league"],
        context["feature_dims"],
        device=context["device"],
    )
    assert status == 500
    assert payload.get("error") == "Model not loaded"


def test_pick_respects_mask():
    context = make_model_context()
    payload = base_payload()
    payload["fearlessLockout"] = ["Ahri"]
    status, response = select_champion(
        payload,
        context["model"],
        context["champion2idx"],
        context["idx2name"],
        context["eligibility_by_league"],
        context["feature_dims"],
        device=context["device"],
    )
    assert status == 200
    assert normalize(response["champion"]) != "ahri"
    assert normalize(response["champion"]) == "akali"


def test_pick_all_blocked():
    context = make_model_context()
    payload = base_payload()
    payload["fearlessLockout"] = ["Aatrox", "Ahri", "Akali"]
    status, response = select_champion(
        payload,
        context["model"],
        context["champion2idx"],
        context["idx2name"],
        context["eligibility_by_league"],
        context["feature_dims"],
        device=context["device"],
    )
    assert status == 422
    assert response.get("error") == "No available champions"


def test_invalid_slot_returns_400():
    context = make_model_context()
    payload = base_payload()
    payload["slot"] = {"side": "blue", "type": "pick", "num": 9}
    status, response = select_champion(
        payload,
        context["model"],
        context["champion2idx"],
        context["idx2name"],
        context["eligibility_by_league"],
        context["feature_dims"],
        device=context["device"],
    )
    assert status == 400
    assert response.get("error") == "Invalid slot"


def test_real_model_selects_champion():
    assert REAL_RUN_DIR.exists(), "Expected training run directory to exist."
    context = load_model_context(run_dir=REAL_RUN_DIR)
    payload = base_payload()
    status, response = select_champion(
        payload,
        context["model"],
        context["champion2idx"],
        context["idx2name"],
        context["eligibility_by_league"],
        context["feature_dims"],
        device=context["device"],
    )
    assert status == 200
    assert response.get("champion")
    assert normalize(response["champion"]) in context["champion2idx"]


def test_preflight_check_success():
    result = subprocess.run(
        [
            sys.executable,
            "scripts/serve_api.py",
            "--check",
            "--run-dir",
            str(REAL_RUN_DIR),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "Preflight OK" in result.stdout


def test_preflight_check_missing_model():
    missing_dir = Path("/tmp/draft-sage-missing-run")
    if missing_dir.exists():
        for child in missing_dir.iterdir():
            if child.is_file():
                child.unlink()
        missing_dir.rmdir()
    result = subprocess.run(
        [
            sys.executable,
            "scripts/serve_api.py",
            "--check",
            "--run-dir",
            str(missing_dir),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "model.pth not found" in result.stderr
