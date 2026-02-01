# Draft Sage UI (MVP)

Static fearless draft UI with optional AI pick calls.

## Run locally
Serve the repo root so the UI can fetch the DDragon snapshot:

```bash
cd /home/jirving/projects/lol
python3 -m http.server 8000
```

Then open:
```
http://localhost:8000/draft-sage/ui/index.html
```

## AI endpoint (optional)
By default the UI posts to:
```
POST http://localhost:8001/draft/pick
```

Start the Draft Sage API first:
```bash
python3 /home/jirving/projects/lol/draft-sage/scripts/serve_api.py --port 8001
```

To pin a specific model run:
```bash
python3 /home/jirving/projects/lol/draft-sage/scripts/serve_api.py --port 8001 \\
  --run-dir /home/jirving/projects/lol/.tmp/training-clean-2025-weights-matrix-seriesid-elig-band-0p3-0p4/20260117_151849
```

Payload includes the current draft, slot metadata, fearless lockout list, and side.
If the endpoint is missing or errors, the UI fails loudly.

## Champion data
The UI loads champion data from the latest local DDragon snapshot:
```
/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/data/en_US/champion.json
```
Fallback: `/draft-sage/resources/champions.json`.

Update `CHAMPION_SOURCES` in `app.js` when the snapshot changes.
