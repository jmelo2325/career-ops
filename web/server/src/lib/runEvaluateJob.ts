import fs from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { getAnthropicClient, getAnthropicModel } from "./anthropic";
import { batchPaths, repoRoot, userPaths } from "./paths";
import { runNodeScript } from "./scripts";
import { generateTailoredPdf } from "./pdf";
import { markPdfGenerated } from "./pdfUpdate";

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

/** Local YYYY-MM-DD HH:mm for tracker / applications.md (ordering within same day). */
function nowTrackerDateTime() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function nextReportNumber(): Promise<string> {
  await ensureDir(userPaths.reportsDir);
  const files = await fs.readdir(userPaths.reportsDir);
  let max = 0;
  for (const f of files) {
    const m = /^(\d{3})-/.exec(f);
    if (m) max = Math.max(max, Number.parseInt(m[1]!, 10));
  }
  return String(max + 1).padStart(3, "0");
}

function slugifyCompany(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function extractJdFromUrl(jdUrl: string, log: (l: string) => void) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    log(`Navigating to ${jdUrl}`);
    await page.goto(jdUrl, { waitUntil: "networkidle", timeout: 90_000 });

    // Heuristic: grab visible text.
    const text = await page.evaluate(() => {
      const d = (globalThis as any).document;
      return d?.body?.innerText || "";
    });
    const trimmed = text.replace(/\s+\n/g, "\n").trim();
    return trimmed;
  } finally {
    await browser.close();
  }
}

function extractCompanyAndRoleFromReport(md: string): { company: string; role: string } {
  // Prefer first header: "# Evaluación: Company — Role" or "# Evaluation: ..."
  const h1 = md.split("\n").find((l) => l.startsWith("# "));
  if (h1) {
    const s = h1.replace(/^#\s+/, "").trim();
    // Try split on em-dash or dash
    const parts = s.split("—").map((p) => p.trim());
    if (parts.length >= 2) {
      const left = parts[0]!;
      const right = parts.slice(1).join("—").trim();
      // remove "Evaluación:" prefix if present
      const company = left.replace(/^Evaluación:\s*/i, "").replace(/^Evaluation:\s*/i, "").trim();
      return { company, role: right };
    }
  }
  return { company: "company", role: "role" };
}

export async function runEvaluateJob(
  input: { jdText?: string; jdUrl?: string },
  ctx: { log: (line: string) => void; setProgress: (step: string, detail?: string) => void }
) {
  ctx.setProgress("Loading context");

  const [cv, shared, profileMd, profileYml] = await Promise.all([
    fs.readFile(userPaths.cv, "utf-8"),
    fs.readFile(userPaths.sharedMd, "utf-8"),
    fs.readFile(userPaths.profileMd, "utf-8"),
    fs.readFile(userPaths.profileYml, "utf-8")
  ]);

  let articleDigest = "";
  try {
    articleDigest = await fs.readFile(userPaths.articleDigest, "utf-8");
  } catch {
    // optional
  }

  let jd = input.jdText?.trim() || "";
  if (!jd && input.jdUrl) {
    ctx.setProgress("Extracting JD from URL");
    jd = await extractJdFromUrl(input.jdUrl, ctx.log);
  }
  if (!jd || jd.length < 200) {
    throw new Error("JD extraction failed or JD too short. Paste the JD text and retry.");
  }

  ctx.setProgress("Generating A–F evaluation");
  const client = getAnthropicClient();
  const model = getAnthropicModel();

  const system = [
    "You are career-ops, a professional job fit analysis platform.",
    "Return ONLY clean markdown — no code fences, no preamble text before the heading.",
    "",
    "REPORT FORMATTING RULES (critical):",
    "- The report is rendered in a SaaS dashboard, not read as raw text.",
    "- Write like a product, not a chatbot. No filler phrases like 'Let me analyze...' or 'Here is your report'.",
    "- Use direct, decisive language: 'Strong match', 'Gap — mitigable', 'Not recommended unless...'",
    "- Every section must earn its space. Cut fluff, keep signal.",
    "",
    "HEADER FORMAT (exact):",
    "# Evaluation: {Company} — {Role}",
    "",
    "**URL:** {url if provided}",
    "**Date:** {YYYY-MM-DD}",
    "**Archetype:** {detected archetype}",
    "**Score:** {X.X} / 5",
    "",
    "TABLE FORMATTING:",
    "- Use markdown tables for structured data (role summary, matches, gaps, comp, scores).",
    "- In the Match table, the Strength column MUST use exactly: ✅ Strong, ✅ Moderate, ⚠️ Gap, or ⚠️ Mitigable.",
    "- In the Gaps table, columns are: Gap | Blocker? | Adjacent Experience | Mitigation.",
    "",
    "SECTION HEADERS (exact, English):",
    "## A) Role Summary",
    "## B) Match with CV",
    "## C) Level & Strategy",
    "## D) Comp & Demand",
    "## E) Personalization Plan",
    "## F) Interview Prep",
    "## Scoring Summary",
    "",
    "SCORING SUMMARY TABLE (must appear at the end):",
    "| Dimension | Score | Notes |",
    "Dimensions: Match with CV, North Star alignment, Comp, Cultural signals",
    "Each score is X.X out of 5.",
    "",
    "TONE: professional analyst delivering a brief to a hiring committee. Concise, structured, opinionated."
  ].join("\n");

  const user = [
    "## System context (_shared.md)",
    shared,
    "\n## User profile overrides (_profile.md)",
    profileMd,
    "\n## Candidate profile (profile.yml)",
    profileYml,
    "\n## Candidate CV (cv.md)",
    cv,
    articleDigest ? "\n## Article digest (optional)\n" + articleDigest : "",
    "\n## Mode instructions (oferta.md)",
    await fs.readFile(path.join(repoRoot, "modes", "oferta.md"), "utf-8"),
    "\n## Job description",
    input.jdUrl ? `URL: ${input.jdUrl}` : "",
    jd
  ].join("\n\n");

  const resp = await client.messages.create({
    model,
    max_tokens: 8192,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }]
  });

  let reportMd = resp.content
    .map((b) => ("text" in b ? b.text : ""))
    .join("")
    .trim();

  // Strip markdown code fences the model sometimes wraps output in
  reportMd = reportMd.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

  // If there's preamble text before the first heading, extract from the heading onward
  if (!reportMd.startsWith("#")) {
    const headingIdx = reportMd.indexOf("\n#");
    if (headingIdx !== -1) {
      reportMd = reportMd.slice(headingIdx + 1).trim();
    }
  }

  if (!reportMd.startsWith("#")) {
    ctx.log("Model output did not start with '#'. First 300 chars:");
    ctx.log(reportMd.slice(0, 300));
    throw new Error("Model output did not look like a markdown report.");
  }

  const num = await nextReportNumber();
  const ymd = todayYmd();
  const trackerWhen = nowTrackerDateTime();
  const { company, role } = extractCompanyAndRoleFromReport(reportMd);
  const slug = slugifyCompany(company) || "company";
  const reportFilename = `${num}-${slug}-${ymd}.md`;
  const reportRel = `reports/${reportFilename}`;
  const reportPath = path.join(userPaths.reportsDir, reportFilename);

  ctx.setProgress("Writing report", reportRel);
  await ensureDir(userPaths.reportsDir);
  await fs.writeFile(reportPath, reportMd, "utf-8");

  ctx.setProgress("Writing tracker addition TSV");
  await ensureDir(batchPaths.additionsDir);
  const tsvPath = path.join(batchPaths.additionsDir, `${num}-${slug}.tsv`);
  const scoreMatch = reportMd.match(/\*\*Score:\*\*\s*([0-9.]+)\s*\/\s*5/i);
  const score = scoreMatch?.[1] ? `${Number.parseFloat(scoreMatch[1]).toFixed(1)}/5` : "0.0/5";
  const status = "Evaluated";
  const pdfEmoji = "❌";
  const notes = "Web dashboard evaluation";
  const tsvLine = [num, trackerWhen, company, role, status, score, pdfEmoji, `[${num}](${reportRel})`, notes].join("\t");
  await fs.writeFile(tsvPath, tsvLine, "utf-8");

  ctx.setProgress("Merging tracker");
  await runNodeScript("merge-tracker.mjs", [], { log: ctx.log });

  ctx.setProgress("Generating tailored PDF");
  const pdf = await generateTailoredPdf({
    company,
    slug,
    num,
    jd,
    reportRel,
    log: ctx.log,
    setProgress: ctx.setProgress
  });
  await markPdfGenerated(num);
  ctx.log(`PDF generated: ${pdf.pdfPath}`);

  ctx.setProgress("Done");
  return { reportRel, reportPath, tsvPath, pdf };
}

