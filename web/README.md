# career-ops web dashboard (localhost)

This is a browser-based dashboard for `career-ops` that reads/writes the same files (`data/applications.md`, `reports/`, `output/`, `data/pipeline.md`, `data/scan-history.tsv`) and can run evaluations, scanning, and pipeline processing locally.

## Prereqs

- Node.js 18+ (you already installed Node)
- Playwright Chromium installed at repo root (already done via `npx playwright install chromium`)
- Anthropic API key (for evaluation + PDF generation)

## Setup

From the repo root:

```powershell
cd web
copy .env.example .env
# then edit .env and set ANTHROPIC_API_KEY
```

Install dependencies:

```powershell
npm install
npm --prefix ui install
```

## Run (dev)

In one terminal:

```powershell
cd web
npm run dev:api
```

In another terminal:

```powershell
cd web\ui
npm run dev
```

Open the UI:

- `http://localhost:5173/` (or the next available port if 5173 is taken)

## What it can do

- View and filter pipeline entries from `data/applications.md`
- Open job URLs and view reports from `reports/`
- Update status in `data/applications.md`
- Run:
  - Scan (adds to `data/pipeline.md` + `data/scan-history.tsv`)
  - Pipeline processing (evaluates pending URLs)
  - Merge tracker (`merge-tracker.mjs`)
- Evaluate a JD (URL or pasted text) using Anthropic; writes a report and generates a tailored PDF in `output/`

