# Draft Sage UI (MVP)

Static fearless draft UI with optional AI pick calls.

## Run locally
Serve the repo root so the UI can fetch the DDragon snapshot:

```bash
cd /home/jirving/projects/lol
python -m http.server 8000
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

Payload includes the current draft, slot metadata, fearless lockout list, and side.
If the endpoint is missing or errors, the UI falls back to random picks.

## Champion data
The UI loads champion data from the latest local DDragon snapshot:
```
/lol-ddragon-snapshot-cron/data/ddragon/extracted/16.1.1/16.1.1/data/en_US/champion.json
```
Fallback: `/draft-sage/resources/champions.json`.

Update `CHAMPION_DATA_PATHS` and `CHAMPION_IMG_BASE` in `app.js` when the snapshot changes.
