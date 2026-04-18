# Mode: pdf — Infographic-style, ATS-safe tailored CV generation

## Design philosophy

The PDF template is inspired by a premium two-column magazine/infographic resume layout — **not** a generic single-column markdown-export-looking CV. It should read like a designed document that a recruiter receives from a senior candidate who cares.

**But**: every design choice must preserve ATS (applicant tracking system) parseability.

### Visual identity (what distinguishes this template)

- **Two-column layout** — main column (65%): Executive Profile → Core Competencies → **Tools & Skills** → **Education** → **Certifications** → **Experience** → Projects. Education sits before the long experience block so it typically fits on page 1. Sidebar (35%): Most Proud Of, Strengths, Methodologies, Life Philosophy, A Day in the Life (floats right; supplementary only).
- **Dynamic brand colors per target company** — the entire palette (`--brand`, `--accent`) shifts to match the company's real brand identity (Salesforce blue, HubSpot coral, Anthropic rust, etc.).
- **Typography rhythm** — Space Grotesk (uppercase, 700) for name and section headers, DM Sans (regular/medium) for body. Italic accent-colored tagline under name.
- **Accent-ruled section headers** — all-caps, letter-spaced, underlined with a 1.5px accent rule (magazine feel, not blog feel).
- **Iconography** — small inline SVGs for contact row (envelope, linkedin monogram, pin, phone) and "Most Proud Of" cards (lightbulb, rocket, trophy, star). Icons are decoration; every value still has plain-text.
- **Methodology proficiency dots** — `●●●○` Unicode characters inline with the framework name, so ATS reads them as text.
- **Tinted sidebar background** — subtle wash of `--brand` at ~4% opacity so the sidebar feels like a card without adding weight.

### ATS-safety rules (non-negotiable)

- **Semantic DOM order**: header → sidebar (supplementary) → main column (summary → competencies → tools/skills → education → certifications → experience → projects). Main holds all keyword-critical sections; sidebar is optional flavor.
- **Standard section names**: "Executive Profile" / "Experience" / "Education" / "Certifications" / "Tools & Skills" — parsers look for these tokens.
- **No text inside images or SVGs**. Icons are decorative only.
- **No photos on the ATS version**. Photos hurt parsing and introduce bias in US-based applications.
- **No tables** for layout. Use CSS grid / flex only.
- **Selectable text everywhere** (not rasterized).
- **No critical info in page header/footer regions** — ATS ignores those.
- **Keywords from the JD distributed**: Summary (top 5–7), first bullet of each role, Competencies grid, Strengths, Methodologies, Skills.

## Dynamic sections

The LLM can populate these optional sections or omit them. When omitted they are hidden via `display: none` so the layout stays clean.

- `mostProudOf` — 3 career-defining achievements, each with a 1–3 word title + one-sentence description. Title examples: Ingenuity, Growth, Expertise, Leadership, Impact, Craft.
- `strengths` — 5–7 short (2–5 word) phrases describing persistent strengths.
- `methodologies` — 3–5 frameworks/methodologies relevant to the role, with a proficiency level 1–4. Rendered as `FRAMEWORK ●●●○`.
- `lifePhilosophy` — a short quote + author. **Only populate if the candidate profile includes one** — never fabricate.
- `dayInTheLife` — 3–5 time-slot + activity pairs. Only populate if the profile suggests distinctive daily rituals — otherwise omit.

## Dynamic brand colors (required)

On every evaluation the LLM must return:

- `brandPrimary` — the target company's dominant hex color (e.g. Salesforce `#00A1E0`)
- `brandAccent` — complementary hex color from the palette (e.g. Salesforce deep navy `#032D60`)

These flow through the template as `--brand` and `--accent` CSS custom properties. Every structural color references them.

If the company cannot be identified from the JD, fall back to `#1a1a2e` / `#2d6a6a`.

## Pipeline (runtime flow)

1. Read `cv.md` (canonical CV), `config/profile.yml` (contact info), `modes/_profile.md` (voice/narrative overrides).
2. Detect JD language → CV language (EN default).
3. Detect company → select brand colors.
4. Detect archetype from JD → adjust framing of summary + experience bullets.
5. LLM generates JSON with all template fields (see below).
6. Template is filled and written to `output/_tmp/cv-{num}-{slug}.html`.
7. Playwright renders PDF with 0.6in margins, letter (US/Canada) or A4 (rest of world).
8. Output: `output/cv-{slug}-{num}.pdf`.

## Keyword injection (ethical)

Reformulate real experience using the JD's vocabulary. Never invent skills.

- JD says "RAG pipelines" and CV says "LLM workflows with retrieval" → rewrite to "RAG pipeline design and LLM orchestration workflows".
- JD says "stakeholder management" and CV says "collaborated with team" → rewrite to "stakeholder management across engineering, operations, and business".

## Placeholder reference

| Placeholder | Content |
|---|---|
| `{{LANG}}` | `en` or `es` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{BRAND_PRIMARY}}` | Hex color matching target company brand |
| `{{BRAND_ACCENT}}` | Complementary hex color from company palette |
| `{{NAME}}` | from `config/profile.yml` |
| `{{TAGLINE}}` | 6–12 word personal brand line |
| `{{EMAIL}}` / `{{PHONE}}` / `{{LOCATION}}` | from `config/profile.yml` |
| `{{LINKEDIN_URL}}` | Full URL |
| `{{LINKEDIN_DISPLAY}}` | Readable path, e.g. `linkedin.com/in/jessmelo` |
| `{{SUMMARY_TEXT}}` | 3–5 sentence Executive Profile |
| `{{COMPETENCIES}}` | `<span class="competency-tag">…</span>` × 6–10 |
| `{{EXPERIENCE}}` | Reverse-chronological `<div class="job">` blocks |
| `{{PROJECTS}}` | Optional — `<div class="project">` blocks |
| `{{EDUCATION}}` | `<div class="edu-item">` blocks |
| `{{CERTIFICATIONS}}` | Optional — `<div class="cert-item">` blocks |
| `{{SKILLS}}` | `<div class="skill-item">` blocks |
| `{{PROUD}}` | Optional — `<div class="proud-item">` blocks (3 cards) |
| `{{STRENGTHS}}` | Optional — `<li>` list items |
| `{{METHODOLOGIES}}` | Optional — `<div class="method-item">` with proficiency dots |
| `{{PHILOSOPHY}}` | Optional — `<blockquote>` + author |
| `{{DAY_IN_THE_LIFE}}` | Optional — `<div class="day-item">` rows |
| `{{*_DISPLAY}}` | `block` or `none` — controls visibility of optional sections |

## Post-generation

Update the tracker (PDF column from `❌` to `✅`) once the PDF has been successfully written.
