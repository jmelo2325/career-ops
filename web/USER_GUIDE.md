# Web dashboard user guide (career-ops)

A step-by-step guide to the browser-based **career-ops** dashboard (this fork’s UI is titled **Jessica’s Job Tracker** in the header, with the subtitle *Local dashboard*). The app binds to **localhost** only, reads and writes the same files as the CLI, and covers setup, evaluation, scanning, pipeline processing, report review (including in-app PDF viewing), and chat-based modes.

---

## Table of Contents

1. [Setup](#1-setup)
2. [Starting the Dashboard](#2-starting-the-dashboard)
3. [Dashboard Layout](#3-dashboard-layout)
4. [Workflow 1 — Evaluate a Single Job](#4-workflow-1--evaluate-a-single-job)
5. [Workflow 2 — Scan Portals for New Jobs](#5-workflow-2--scan-portals-for-new-jobs)
6. [Workflow 3 — Process the Pipeline](#6-workflow-3--process-the-pipeline)
7. [Workflow 4 — Review a Report](#7-workflow-4--review-a-report)
8. [Workflow 5 — Update Application Status](#8-workflow-5--update-application-status)
9. [Workflow 6 — Pipeline Maintenance](#9-workflow-6--pipeline-maintenance)
10. [Workflow 7 — AI Chat (Conversational Modes)](#10-workflow-7--ai-chat-conversational-modes)
11. [Where Your Data Lives](#11-where-your-data-lives)
12. [Typical End-to-End Session](#12-typical-end-to-end-session)
13. [Troubleshooting](#13-troubleshooting)
14. [Feature Reference](#14-feature-reference)

---

## 1. Setup

You only need to do this once.

### Prerequisites

- **Node.js 18+** installed
- **Playwright Chromium** installed at the repo root (`npx playwright install chromium`)
- **Anthropic API key** (get one at [console.anthropic.com](https://console.anthropic.com/))

### Step-by-step

1. Open a terminal in the repo root (`career-ops/`)

2. Navigate to the web directory and create your `.env` file:
   ```powershell
   cd web
   copy .env.example .env
   ```

3. Open `web/.env` in a text editor and paste your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
   ANTHROPIC_MODEL=claude-sonnet-4-6
   HOST=127.0.0.1
   PORT=8787
   ```

4. Install dependencies (run from the `web/` directory):
   ```powershell
   npm install
   npm --prefix ui install
   ```

5. Make sure your profile is configured. These files should exist in the repo root:
   - `cv.md` — your CV in markdown
   - `config/profile.yml` — your name, location, target roles, comp range
   - `portals.yml` — companies and search keywords for the scanner
   - `modes/_profile.md` — your personalization overrides

   If any are missing, copy from the templates:
   ```powershell
   cd ..
   copy config\profile.example.yml config\profile.yml
   copy templates\portals.example.yml portals.yml
   copy modes\_profile.template.md modes\_profile.md
   ```
   Then edit each file with your details.

---

## 2. Starting the Dashboard

**Recommended — one terminal (API + UI together):**

From the `web/` directory:

```powershell
cd web
npm run dev
```

This runs **`concurrently`**: the Express API (`tsx watch server/src/index.ts`) and the Vite UI (`npm --prefix ui run dev`). You should see the API line:

```
career-ops web API listening on http://127.0.0.1:8787
```

…and Vite reporting something like:

```
➜  Local:   http://localhost:5173/
```

(If **5173** is busy, Vite picks the next free port and prints it.)

**Alternative — two terminals** (same result, split processes):

```powershell
# Terminal 1
cd web
npm run dev:api

# Terminal 2
cd web\ui
npm run dev
```

**Open your browser** at the URL Vite prints (usually **http://localhost:5173/**).

---

## 3. Dashboard Layout

### Header and navigation

The top bar shows the app title (**Jessica’s Job Tracker**) and **Local dashboard**, plus **three** primary nav items (top right):

| Tab | Purpose |
|-----|---------|
| **Pipeline** | Main workspace: tracked applications, search, filters, sorting, and bulk actions. |
| **Evaluate** | Submit a new job URL or pasted JD text for a full evaluation + tailored PDF. |
| **Chat** | Streaming AI assistant with **7** specialized modes (see [Workflow 7](#10-workflow-7--ai-chat-conversational-modes)). |

There is **no separate “Report” tab**. When you open a report from the pipeline, the **report view replaces the pipeline content** in the main area; **Pipeline** stays highlighted in the nav so you can return in one click (or use **Back to pipeline** in the report sidebar).

To change the header title or subtitle, edit `web/ui/src/App.tsx` (e.g. branding for your own fork).

### Pipeline View toolbar

The Pipeline toolbar includes:

- **Search box** — filter rows by company, role, or notes
- **Refresh** — reload data from `data/applications.md`
- **Scan** — start portal scanning (see [Workflow 2](#5-workflow-2--scan-portals-for-new-jobs))
- **Process pipeline** — evaluate pending URLs from `data/pipeline.md` (batch of up to 5)
- **Merge tracker** — run `merge-tracker.mjs` to merge pending TSV additions into the tracker
- **Status** dropdown — filter by application status (All, Evaluated, Applied, …)

Each of **Scan**, **Process pipeline**, and **Merge tracker** has a small **ⓘ** info button next to it: click for a short explanation of what the action reads, writes, and when to use it.

### Pipeline table

- **Default order** — **most recent first** by **Date & time** (column may show `YYYY-MM-DD` or `YYYY-MM-DD HH:mm`). New evaluations from the dashboard write a timestamp so same-day runs sort correctly. Older rows with date-only still order sensibly; same calendar day → higher report **#** first.
- **#** column — click the **#** header to sort by report number: **unsorted** → **newest/highest # first** → **oldest/lowest # first** → **unsorted** (⇅ / ↓ / ↑). Only one of **#**, **Date & time**, or **Score** sort is active at a time.
- **Date & time** column — click to cycle: **most recent first** (default) ↔ **oldest first** ↔ **unsorted** (⇅ / ↓ / ↑). Missing values sort last.
- **Score** column — same cycle for numeric score.
- **Actions** — **Open JD** (if a URL is stored), **View report** (opens the structured report view).

### Floating Job Progress Bar

When any background job is running (evaluation, scan, pipeline processing, scripts), a **progress bar appears fixed at the bottom** of the screen. It shows:

- Job ID and state (queued / running / succeeded / failed)
- Current step and detail (e.g., "Extracting JD from URL")
- A pulsing dot while polling
- **Show logs** / **Hide logs** toggle to see raw output
- **Dismiss** button (appears when the job finishes)

This bar is visible on every tab, so you can navigate freely while a job runs.

---

## 4. Workflow 1 — Evaluate a Single Job

This is the core workflow. You found a job listing and want career-ops to evaluate how well it fits you.

### Steps

1. Click the **Evaluate** tab in the top navigation

2. You have two options:
   - **Paste a URL** into the "Job URL" field — the system will navigate to it with Playwright and extract the job description automatically
   - **Paste the JD text** directly into the textarea — use this if the URL is behind a login or paywall

3. Click **Start evaluation**

4. The **floating progress bar** appears at the bottom. Watch the steps:
   - *Loading context* — reads your CV, profile, and mode files
   - *Extracting JD from URL* — Playwright visits the page (if URL provided)
   - *Generating A–F evaluation* — the AI produces the structured report (sections A–F plus scoring summary)
   - *Writing report* — saves the markdown report to `reports/`
   - *Writing tracker addition TSV* — creates a tracker entry
   - *Merging tracker* — runs `merge-tracker.mjs` to add the entry to `applications.md`
   - *Generating PDF content (LLM)* — the AI generates a tailored CV
   - *Rendering PDF (Playwright)* — converts the HTML to a PDF in `output/`
   - *Done*

5. Once done, click **Dismiss** on the progress bar

6. Switch to the **Pipeline** tab — your new entry appears in the table

### What gets created

| File | Location | Description |
|------|----------|-------------|
| Evaluation report | `reports/001-company-slug-YYYY-MM-DD.md` | Full A–F scoring with fit analysis, gaps, interview prep, negotiation notes |
| Tailored PDF | `output/cv-{company-slug}-{###}.pdf` | ATS-optimized resume; the 3-digit number matches the report number (e.g. report `003-…` → `cv-acme-003.pdf`) |
| Tracker entry | `data/applications.md` | Row added with score, status, report link |

### The evaluation report includes

- **Role summary** — what the company is looking for
- **CV match analysis** — how your experience maps to requirements
- **Gap analysis** — what's missing and how to address it
- **Compensation research** — market data and negotiation framing
- **Personalization** — how to position your narrative for this role
- **Interview prep** — STAR+R stories tailored to likely questions
- **Overall score** — 0–5, with a **Scoring Summary** table when present (dimensions such as match, alignment, comp, culture)

---

## 5. Workflow 2 — Scan Portals for New Jobs

The scanner visits career pages of companies you've configured in `portals.yml` and finds new job listings matching your target roles.

### Steps

1. Make sure `portals.yml` exists in the repo root and has at least some companies configured (the template includes 45+ pre-configured companies)

2. From the **Pipeline** tab, click the **Scan** button

3. Watch the progress bar — it will show each company being scanned:
   - *Reading portals.yml*
   - *Launching browser*
   - *Scanning [Company Name]* — for each configured company
   - *Writing pipeline + scan history*

4. When finished, new job URLs are added to `data/pipeline.md` (under "## Pending") and logged in `data/scan-history.tsv` for deduplication

5. The scan does **not** auto-evaluate. To evaluate the discovered jobs, use **Process pipeline** (next workflow)

### How filtering works

In `portals.yml`, the `title_filter` section controls what gets picked up:

```yaml
title_filter:
  positive:
    - enablement
    - sales enablement
    - revenue enablement
  negative:
    - intern
    - junior
    - coordinator
```

- **Positive** — job title must contain at least one of these keywords
- **Negative** — job title must NOT contain any of these keywords

### Adding companies

Edit `portals.yml` and add entries under `tracked_companies`:

```yaml
tracked_companies:
  - name: Acme Corp
    careers_url: https://acme.com/careers
    enabled: true
```

---

## 6. Workflow 3 — Process the Pipeline

After scanning, your `data/pipeline.md` will have pending URLs. "Process pipeline" evaluates them one by one (up to 5 at a time).

### Steps

1. From the **Pipeline** tab, click **Process pipeline**

2. The system reads `data/pipeline.md`, finds unchecked entries (`- [ ] https://...`), and evaluates each one sequentially

3. For each URL, it runs the full evaluation workflow (same as Workflow 1): extract JD → evaluate → write report → merge tracker → generate PDF

4. Watch progress in the floating bar at the bottom

5. When done, click **Dismiss** and then **Refresh** to see all new entries in the table

---

## 7. Workflow 4 — Review a Report

Reports open **in the main content area** (not a fourth nav tab). They are rendered as a **rich, structured layout** — executive summary, cards, accordions — with optional raw markdown at the bottom.

### Steps

1. On the **Pipeline** tab, find the row you want to review.

2. Click **View report** (gradient button in the **Actions** column).

3. The **report view** loads. On **narrow screens**, use **Back to pipeline** at the top of the actions block or in the sticky rail when visible.

### Executive summary (top)

- **Score ring** — overall score out of 5  
- **Company & role**, **archetype**, **date**, **View posting →** (if a URL was captured)  
- **TL;DR** when present in the report  
- **Recommendation badge** — color-coded guidance (e.g. strong apply vs. caution vs. skip) based on score bands  
- **Dimension scores** — when the report includes a **Scoring Summary** table, bars appear per dimension; **older reports** without that table may show **synthesized** bars (e.g. overall fit / requirements match) so the UI still has signal  

### Collapsible sections (accordions)

- **Role Snapshot** — role dimensions as cards  
- **Requirements Match** — requirement cards with strength chips (Strong / Moderate / Gap / Mitigable)  
- **Gaps & Mitigation** — gaps, severity, mitigations  
- **Compensation & Market** — comp data and assessment when present  
- **Level & Strategy** — verdict and tips  
- **Personalization Plan** — CV and LinkedIn tweaks when present  
- **Interview Prep** — STAR stories, case study, red-flag Q&A  
- **Full Analysis** — full markdown: toggle **Rendered** vs **Show raw markdown**  

### Sticky action rail (large screens — right column)

- **← Back to pipeline**  
- **View job posting →** — when a URL exists  
- **View tailored CV** — appears only when a matching PDF exists under `output/` (see below)  
- **Quick Stats** — score, match counts, STAR count, comp score when available  
- **Report file** — relative path (e.g. `reports/003-company-2026-04-07.md`)  

### Tailored CV (PDF) in the browser

If evaluation completed PDF generation, the file exists as `output/cv-{slug}-{###}.pdf`. The UI detects it by report number and shows **View tailored CV**:

- Opens a **modal** with an embedded PDF viewer (simple iframe).  
- **Show on my computer** — opens File Explorer (Windows) / Finder (macOS) with that file selected (local paths only).  
- **Download** — saves a copy via the browser.  
- **✕** — close the modal.

If a report was created **before** PDF generation succeeded (or PDF step failed), there is **no** tailored file — the button is hidden until a matching PDF exists.

### Mobile

On small viewports the sticky rail is hidden; use **View tailored CV** next to the recommendation badge when a PDF is available.

### Opening the original job listing

If the evaluation included a URL, **View posting →** appears in the header and in the sidebar. It opens the listing in a new tab.

---

## 8. Workflow 5 — Update Application Status

As you progress through your job search, update statuses to keep your pipeline organized.

### Steps

1. On the **Pipeline** tab, find the row you want to update

2. Click the **Status dropdown** in that row

3. Select the new status:

| Status | When to use |
|--------|-------------|
| **Evaluated** | Report completed, haven't decided yet |
| **Applied** | You submitted the application |
| **Responded** | Company responded to your application |
| **Interview** | You're in the interview process |
| **Offer** | You received an offer |
| **Rejected** | Company rejected you |
| **Discarded** | You decided not to pursue this one |
| **SKIP** | Doesn't fit, don't apply |

4. The change saves immediately to `data/applications.md`

### Filtering by status

Use the **Status** dropdown in the toolbar to show only applications with a specific status. Select "All" to see everything.

---

## 9. Workflow 6 — Pipeline Maintenance

These utilities keep your tracker data clean and consistent.

### Merge tracker

Click **Merge tracker** on the Pipeline tab. This runs `merge-tracker.mjs`, which:
- Reads any pending TSV files from `batch/tracker-additions/`
- Deduplicates against existing entries in `applications.md`
- Merges new entries into the tracker
- Moves processed TSVs to `batch/tracker-additions/merged/`

This runs automatically after every evaluation, but you can trigger it manually if needed.

### Other maintenance scripts

These are available via the API but can be run from the terminal:

```powershell
# From the repo root:

# Verify pipeline integrity (checks for broken links, bad formats, non-canonical statuses)
node verify-pipeline.mjs

# Remove duplicate entries (keeps highest-scored version)
node dedup-tracker.mjs

# Normalize all statuses to canonical values
node normalize-statuses.mjs
```

---

## 10. Workflow 7 — AI Chat (Conversational Modes)

The **Chat** tab gives you a streaming AI assistant that has your full career context loaded (CV, profile, archetypes, proof points). It supports 7 specialized modes for different tasks.

### How to use

1. Click the **Chat** tab in the top navigation
2. Select a **mode** from the dropdown at the top left
3. Type your message and press **Enter** (or click **Send**)
4. The AI response streams in token-by-token with markdown formatting
5. Continue the conversation as long as needed (up to 50 messages)
6. Click **Clear chat** or switch modes to start fresh

### Available modes

#### General (free-form)
Open-ended career advice using your full profile context.

**Example prompts:**
- "What roles am I best suited for right now?"
- "What are my biggest gaps for VP-level enablement roles?"
- "Summarize my top 3 strengths based on my CV"

#### Compare Offers (`ofertas`)
Compare multiple evaluated offers side by side using the same scoring lens as your reports (reference report numbers like `#001`).

**Example prompts:**
- "Compare offers #001 and #003 — which should I prioritize?"
- "Rank my top 3 evaluated offers by overall fit"
- "Which of my evaluated roles has the best comp trajectory?"

**Tip:** Reference offers by their report number (e.g., #001) so the AI can look them up.

#### LinkedIn Outreach (`contacto`)
Generate targeted LinkedIn connection messages using a 3-sentence framework: Hook (specific to the company), Proof (your strongest relevant achievement), Proposal (low-pressure ask).

**Example prompts:**
- "Write a LinkedIn message for the hiring manager at Anthropic for a Sales Enablement role"
- "Draft an outreach message for a VP of Enablement opening at Salesforce"
- "I want to connect with someone on the team at Vericast — help me write the message"

**Rules the AI follows:** Max 300 characters (LinkedIn limit), no corporate-speak, no "I'm passionate about...", no phone numbers.

#### Company Research (`deep`)
Deep research prompt covering 6 axes: AI strategy, recent moves, engineering culture, challenges, competitors, and your angle.

**Example prompts:**
- "Do a deep dive on Vericast — I have an interview coming up"
- "Research Salesforce's enablement org and AI strategy"
- "What should I know about [Company] before my interview next week?"

#### Evaluate Training (`training`)
Evaluate whether a course, certification, or training program is worth your time using 6 dimensions: North Star alignment, recruiter signal, effort, opportunity cost, risks, and portfolio deliverable.

**Example prompts:**
- "Should I get the Salesforce Sales Cloud certification?"
- "Is the HubSpot Revenue Operations cert worth it for my target roles?"
- "Evaluate the value of taking a public speaking course"

**Verdicts:** The AI will recommend TAKE IT, SKIP, or TAKE WITH TIMEBOX with a concrete plan.

#### Evaluate Project (`project`)
Score a portfolio project idea on 6 dimensions: signal for target roles, uniqueness, demo-ability, metrics potential, time to MVP, and STAR story potential.

**Example prompts:**
- "Evaluate a project idea: an AI-powered enablement content recommender"
- "Should I build an ROI calculator for sales training programs?"
- "Score this project idea: automated onboarding assessment tool"

**Verdicts:** BUILD (with weekly milestones), SKIP (with alternative suggestion), or PIVOT TO [better variant].

#### Application Helper (`apply`)
Generate personalized answers for application form questions using your CV and evaluation context.

**Example prompts:**
- "Help me answer these application questions: Why are you interested in this role? What's your greatest strength? Tell us about a time you led a cross-functional project."
- "The application asks for my salary expectation — what should I put for a VP Enablement role in Dallas?"
- "Draft a cover letter for the Vericast VP Sales Enablement position"

**Tip:** Paste the exact questions from the form so the AI can generate copy-paste-ready answers.

### Chat features

- **Streaming responses** — text appears token-by-token as the AI generates it
- **Markdown rendering** — responses include formatted headers, bullets, tables, and code blocks
- **Stop button** — click Stop to interrupt a long response
- **Conversation memory** — the AI remembers everything said in the current conversation
- **50-message limit** — when reached, click "Start new conversation" to continue
- **Mode switching** — changing modes clears the conversation (with confirmation)

---

## 11. Where Your Data Lives

All data stays on your machine. The dashboard reads and writes the same files that the CLI uses.

| File | What it contains |
|------|-----------------|
| `cv.md` | Your CV in markdown (source of truth) |
| `config/profile.yml` | Your name, email, location, target roles, comp range |
| `modes/_profile.md` | Your personalization overrides (archetypes, narrative, negotiation scripts) |
| `portals.yml` | Companies and search keywords for the scanner |
| `data/applications.md` | The tracker — every evaluated role in a markdown table |
| `data/pipeline.md` | Pending URLs to evaluate (populated by the scanner) |
| `data/scan-history.tsv` | Dedup log so the scanner doesn't re-add the same URLs |
| `reports/` | Evaluation reports (one `.md` file per role) |
| `output/` | Generated PDF resumes (one `.pdf` per role) |
| `batch/tracker-additions/` | Staging area for new tracker entries before merge |
| `web/.env` | Your Anthropic API key and server config (never committed) |

---

## 12. Typical End-to-End Session

Here's what a normal job search session looks like:

### First time — set up and evaluate manually

1. Start the dashboard (`cd web` → `npm run dev`, or two terminals — see [Section 2](#2-starting-the-dashboard))
2. Open http://localhost:5173/ (or the port Vite prints)
3. Click **Evaluate**
4. Paste a job URL you found → click **Start evaluation**
5. Wait 2–4 minutes for the full pipeline to complete
6. Go to **Pipeline** → review the score and report
7. If score is 4.0+, open the report; use **View tailored CV** in the report view (or open the PDF under `output/`) before applying
8. Update status to "Applied"

### Ongoing — scan and batch process

1. Start the dashboard
2. Click **Scan** → wait for it to finish scanning all configured portals
3. Click **Process pipeline** → evaluates up to 5 new URLs from the scan
4. Review new entries on the **Pipeline** tab
5. Sort through results: SKIP low scores, evaluate promising ones further, apply to the best fits
6. Repeat every few days

### Decision framework

| Score | Recommendation |
|-------|---------------|
| **4.5–5.0** | Strong fit. Apply immediately. Review the tailored PDF. |
| **4.0–4.4** | Good fit. Worth applying. Check the gap analysis for talking points. |
| **3.5–3.9** | Marginal. Only apply if you have a specific reason (network connection, passion for the company). |
| **Below 3.5** | Poor fit. Mark as SKIP. Your time is better spent elsewhere. |

---

## 13. Troubleshooting

### "ANTHROPIC_API_KEY is not set"
Your `web/.env` file is missing or doesn't have the key. Check that:
- The file is named `.env` (not `.env.sh` or `.env.example`)
- It contains `ANTHROPIC_API_KEY=sk-ant-api03-...`
- You restarted the API server after editing it

### "model: ... not found" (404 from Anthropic)
The model ID in your `.env` is outdated. Update `ANTHROPIC_MODEL` to a current model (e.g., `claude-sonnet-4-6`). Check [Anthropic's model docs](https://docs.anthropic.com/en/docs/about-claude/models/all-models) for current IDs.

### Evaluation takes a long time (3–5 minutes)
This is normal. The pipeline makes two LLM round-trips and two Playwright operations:
1. Playwright → extract JD from URL
2. LLM → generate evaluation report
3. LLM → generate tailored CV content
4. Playwright → render CV as PDF

### "No applications.md found"
The tracker file doesn't exist yet. Create it:
```powershell
# From repo root
mkdir data -ErrorAction SilentlyContinue
```
Then add a file `data/applications.md` with:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

### Scan finds no results
- Check that `portals.yml` has companies with `enabled: true`
- Check that `title_filter.positive` keywords match your target roles
- Some career pages may block automated browsing — try updating the URLs

### Port already in use
If port 8787 or 5173 is taken, edit `web/.env` (for the API port) or check the Vite output for the actual port assigned.

### "View tailored CV" does not appear
The button only shows when a file matching `output/cv-*-{###}.pdf` exists for that report’s 3-digit number. If an evaluation failed during the PDF step, regenerate by re-running evaluation for that job or copy a PDF into `output/` with the expected name. Ensure the **API server** can read `output/` (same repo root as `reports/`).

### Regenerate a tailored PDF without re-running the full evaluation
If the report exists but the PDF is wrong (template bug, bad scrape, missing placeholders), call the API with the report number (no leading zeros required):

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/pdf/regenerate" -Method Post -Body (@{ reportNum = "016" } | ConvertTo-Json) -ContentType "application/json"
```

This re-scrapes the JD from `**URL:**` in the report markdown and overwrites `output/cv-<slug>-<num>.pdf` using the current template and `pdf.ts`. The report file is not modified.

---

## 14. Feature Reference

### Implemented in the web dashboard

| Feature | Original CLI mode | Dashboard equivalent |
|---------|------------------|---------------------|
| Evaluate a single offer | `/career-ops {paste URL}` or `oferta` | **Evaluate** tab → paste URL or JD → Start evaluation |
| Generate tailored PDF | `pdf` | Auto-generated as part of every evaluation; or `POST /api/pdf/regenerate` to rebuild from an existing report |
| Scan portals | `scan` | **Scan** button on Pipeline tab |
| Process pending URLs | `pipeline` | **Process pipeline** button on Pipeline tab |
| View/filter pipeline | `tracker` / Go TUI dashboard | **Pipeline** tab: search, **Status** filter, sortable **#** / **Date** / **Score** columns |
| Update application status | Edit `applications.md` | Status dropdown on each row |
| View evaluation reports | Open `reports/*.md` | **View report** → structured report view (Pipeline nav stays active; no separate Report tab) |
| View tailored PDF | Open `output/*.pdf` | **View tailored CV** in report modal + **Show on my computer** / **Download** |
| Open original job listing | N/A | **Open JD** in the table; **View job posting →** in the report |
| Merge tracker entries | `node merge-tracker.mjs` | **Merge tracker** button (ⓘ explains behavior) |
| Compare multiple offers | `ofertas` | **Chat** tab → Compare Offers mode |
| LinkedIn outreach message | `contacto` | **Chat** tab → LinkedIn Outreach mode |
| Deep company research | `deep` | **Chat** tab → Company Research mode |
| Evaluate a course/cert | `training` | **Chat** tab → Evaluate Training mode |
| Evaluate a portfolio project | `project` | **Chat** tab → Evaluate Project mode |
| Fill application forms | `apply` | **Chat** tab → Application Helper mode |
| General career advice | N/A | **Chat** tab → General mode |
| Pipeline health check | `node verify-pipeline.mjs` | Run from terminal |
| Dedup tracker | `node dedup-tracker.mjs` | Run from terminal |
| Normalize statuses | `node normalize-statuses.mjs` | Run from terminal |

### Terminal-only features

| Feature | How to use |
|---------|-----------|
| Batch processing (parallel workers) | Run `batch/batch-runner.sh` from the terminal |
| Pipeline health check | `node verify-pipeline.mjs` |
| Dedup tracker | `node dedup-tracker.mjs` |
| Normalize statuses | `node normalize-statuses.mjs` |

---

## Quick Reference Card

| I want to... | Do this |
|--------------|---------|
| Start the app | `cd web` → `npm run dev` → open the URL Vite prints (usually port **5173**) |
| Evaluate a job I found | **Evaluate** tab → paste URL or JD → **Start evaluation** |
| Find new jobs automatically | **Pipeline** → **Scan** (ⓘ for details) |
| Evaluate jobs the scanner found | **Pipeline** → **Process pipeline** (ⓘ) |
| Read an evaluation | **Pipeline** → **View report** (report opens in-page; **Pipeline** stays selected in the nav) |
| Open the tailored PDF | In the report → **View tailored CV** → optional **Show on my computer** |
| Sort by score | **Pipeline** → click the **Score** column header (⇅ / ↓ / ↑) |
| Track my progress | **Pipeline** → **Status** dropdown on each row |
| Filter by status | **Pipeline** → toolbar **Status** filter |
| Search for a company | **Pipeline** → **Search** box |
| See job progress/logs | Floating bar at the bottom (**Show logs** / **Dismiss**) |
| Merge tracker TSVs into the table | **Merge tracker** (ⓘ) |
| Other maintenance (verify / dedup / normalize) | Run `node *.mjs` from the repo root (see [Workflow 6](#9-workflow-6--pipeline-maintenance)) |
| Compare my top offers | **Chat** → Compare Offers |
| Write a LinkedIn message | **Chat** → LinkedIn Outreach |
| Research a company for an interview | **Chat** → Company Research |
| Decide if a cert is worth it | **Chat** → Evaluate Training |
| Score a portfolio project idea | **Chat** → Evaluate Project |
| Get help filling out an application | **Chat** → Application Helper |
| Get general career advice | **Chat** → General |
