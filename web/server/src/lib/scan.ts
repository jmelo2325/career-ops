import fs from "node:fs/promises";
import YAML from "yaml";

import { chromium } from "playwright";

import { userPaths } from "./paths";

type TrackedCompany = {
  name: string;
  careers_url: string;
  enabled?: boolean;
  api?: string;
};

type PortalsConfig = {
  title_filter?: {
    positive?: string[];
    negative?: string[];
  };
  tracked_companies?: TrackedCompany[];
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function includesAny(haystack: string, needles: string[]) {
  const h = haystack.toLowerCase();
  return needles.some((n) => n && h.includes(n.toLowerCase()));
}

/** e.g. job-boards.greenhouse.io/anthropic → anthropic */
export function greenhouseBoardToken(careersUrl: string): string | null {
  const m = careersUrl.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)/i);
  return m?.[1]?.trim() || null;
}

async function fetchGreenhouseJobs(
  boardToken: string,
  log: (l: string) => void
): Promise<Array<{ title: string; url: string }>> {
  const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs`;
  log(`Greenhouse API: GET ${apiUrl}`);
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { jobs?: Array<{ title?: string; absolute_url?: string }> };
  const jobs = data.jobs ?? [];
  return jobs
    .filter((j) => j.title && j.absolute_url)
    .map((j) => ({ title: String(j.title).replace(/\s+/g, " ").trim(), url: String(j.absolute_url).trim() }));
}

async function readSeenUrls(): Promise<Set<string>> {
  try {
    const tsv = await fs.readFile(userPaths.scanHistoryTsv, "utf-8");
    const seen = new Set<string>();
    for (const line of tsv.split("\n")) {
      const [url] = line.split("\t");
      if (url && url !== "url") seen.add(url.trim());
    }
    return seen;
  } catch {
    return new Set();
  }
}

async function readPipelineUrls(): Promise<Set<string>> {
  try {
    const md = await fs.readFile(userPaths.pipelineMd, "utf-8");
    const urls = new Set<string>();
    for (const line of md.split("\n")) {
      const m = line.match(/https?:\/\/[^\s|)]+/);
      if (m?.[0]) urls.add(m[0].replace(/[),.;]+$/, ""));
    }
    return urls;
  } catch {
    return new Set();
  }
}

async function ensureFiles() {
  await fs.mkdir(userPaths.reportsDir, { recursive: true });
  await fs.mkdir(userPaths.outputDir, { recursive: true });
  await fs.mkdir(userPaths.jdsDir, { recursive: true });
  await fs.mkdir("data", { recursive: true }).catch(() => {});

  try {
    await fs.access(userPaths.scanHistoryTsv);
  } catch {
    await fs.writeFile(userPaths.scanHistoryTsv, "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n", "utf-8");
  }
  try {
    await fs.access(userPaths.pipelineMd);
  } catch {
    await fs.writeFile(
      userPaths.pipelineMd,
      ["# Pipeline", "", "## Pending", "", "## Done", ""].join("\n"),
      "utf-8"
    );
  }
}

function applyFilters(
  title: string,
  url: string,
  company: string,
  source: string,
  positive: string[],
  negative: string[],
  seen: Set<string>,
  inPipeline: Set<string>,
  found: Array<{ company: string; title: string; url: string; source: string }>
): void {
  if (!title) return;
  if (negative.length && includesAny(title, negative)) return;
  if (positive.length && !includesAny(title, positive)) return;
  if (seen.has(url) || inPipeline.has(url)) return;
  found.push({ company, title, url, source });
  seen.add(url);
}

export type ScanJobResult = {
  added: number;
  companiesScanned: number;
  greenhouseBoards: number;
  playwrightPages: number;
  failures: Array<{ company: string; error: string }>;
  /** User-facing summary for the dashboard */
  message: string;
};

export async function runScanJob(opts: {
  log: (l: string) => void;
  setProgress: (s: string, d?: string) => void;
}): Promise<ScanJobResult> {
  await ensureFiles();
  opts.setProgress("Reading portals.yml");
  const portalsYml = await fs.readFile(userPaths.portalsYml, "utf-8");
  const cfg = YAML.parse(portalsYml) as PortalsConfig;

  const positive = cfg.title_filter?.positive ?? [];
  const negative = cfg.title_filter?.negative ?? [];
  const companies = (cfg.tracked_companies ?? []).filter((c) => c.enabled !== false && c.careers_url);

  const seen = await readSeenUrls();
  const inPipeline = await readPipelineUrls();

  const found: Array<{ company: string; title: string; url: string; source: string }> = [];
  const failures: Array<{ company: string; error: string }> = [];
  let greenhouseBoards = 0;
  let playwrightPages = 0;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;

  try {
    for (const c of companies) {
      opts.setProgress("Scanning", c.name);

      const ghToken = greenhouseBoardToken(c.careers_url);
      if (ghToken) {
        greenhouseBoards++;
        try {
          opts.log(`Scanning ${c.name} via Greenhouse API (board: ${ghToken})`);
          const jobs = await fetchGreenhouseJobs(ghToken, opts.log);
          opts.log(`  → ${jobs.length} open roles from API`);
          for (const job of jobs) {
            applyFilters(job.title, job.url, c.name, c.careers_url, positive, negative, seen, inPipeline, found);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          failures.push({ company: c.name, error: msg });
          opts.log(`Greenhouse API failed for ${c.name}: ${msg}`);
        }
        continue;
      }

      if (!browser) {
        opts.setProgress("Launching browser");
        browser = await chromium.launch({ headless: true });
      }
      playwrightPages++;
      const page = await browser.newPage();
      try {
        opts.log(`Scanning ${c.name} (Playwright): ${c.careers_url}`);
        await page.goto(c.careers_url, { waitUntil: "networkidle", timeout: 90_000 });
        await page.waitForTimeout(2000);
        const links = await page.evaluate(() => {
          const d = (globalThis as any).document;
          const anchors = Array.from(d?.querySelectorAll?.("a") ?? []);
          return anchors
            .map((a: any) => ({
              href: String(a?.href || ""),
              text: String(a?.textContent || "").trim()
            }))
            .filter((x: any) => x.href && x.href.startsWith("http") && x.text && x.text.length >= 6);
        });

        let matched = 0;
        let newFromCompany = 0;
        for (const l of links) {
          const title = l.text.replace(/\s+/g, " ").trim();
          if (!title) continue;
          if (negative.length && includesAny(title, negative)) continue;
          if (positive.length && !includesAny(title, positive)) continue;
          matched++;
          const url = l.href;
          if (seen.has(url) || inPipeline.has(url)) continue;
          found.push({ company: c.name, title, url, source: c.careers_url });
          seen.add(url);
          newFromCompany++;
        }
        opts.log(`  → ${links.length} anchors, ${matched} matched keywords, ${newFromCompany} new URLs this site`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        failures.push({ company: c.name, error: msg });
        opts.log(`Scan failed for ${c.name}: ${msg}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  opts.setProgress("Writing pipeline + scan history");
  const pipeline = await fs.readFile(userPaths.pipelineMd, "utf-8");
  const lines = pipeline.split("\n");
  let pendingIdx = lines.findIndex((l) => l.trim().toLowerCase() === "## pending");
  if (pendingIdx === -1) {
    lines.unshift("## Pending", "");
    pendingIdx = 0;
  }
  const insertAt = pendingIdx + 1;
  const newLines = found.map((f) => `- [ ] ${f.url} | ${f.company} | ${f.title}`);
  lines.splice(insertAt, 0, ...newLines, "");
  await fs.writeFile(userPaths.pipelineMd, lines.join("\n"), "utf-8");

  const scanRows = found.map((f) => `${f.url}\t${todayYmd()}\tscan\t${f.title}\t${f.company}\tadded`);
  const scanPrev = await fs.readFile(userPaths.scanHistoryTsv, "utf-8");
  await fs.writeFile(userPaths.scanHistoryTsv, scanPrev.trimEnd() + "\n" + scanRows.join("\n") + "\n", "utf-8");

  const companiesScanned = companies.length;
  let message: string;
  if (found.length === 0) {
    message =
      failures.length > 0
        ? `No new jobs added (${failures.length} site(s) failed — see logs). Matches may be filtered by title keywords, or URLs already in pipeline / scan history.`
        : "No new jobs added — titles did not match your keywords, or every URL was already in data/pipeline.md / scan history.";
  } else {
    message = `Added ${found.length} new URL(s) to data/pipeline.md (Pending). Use “Process pipeline” to evaluate them.`;
  }

  return {
    added: found.length,
    companiesScanned,
    greenhouseBoards,
    playwrightPages,
    failures,
    message
  };
}
