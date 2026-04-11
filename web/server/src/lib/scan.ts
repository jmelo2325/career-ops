import fs from "node:fs/promises";
import YAML from "yaml";

import { chromium } from "playwright";

import { userPaths } from "./paths";

type PortalsConfig = {
  title_filter?: {
    positive?: string[];
    negative?: string[];
  };
  tracked_companies?: Array<{
    name: string;
    careers_url: string;
    enabled?: boolean;
  }>;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function includesAny(haystack: string, needles: string[]) {
  const h = haystack.toLowerCase();
  return needles.some((n) => n && h.includes(n.toLowerCase()));
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
      const m = line.match(/https?:\/\/\S+/);
      if (m?.[0]) urls.add(m[0]);
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

export async function runScanJob(opts: {
  log: (l: string) => void;
  setProgress: (s: string, d?: string) => void;
}) {
  await ensureFiles();
  opts.setProgress("Reading portals.yml");
  const portalsYml = await fs.readFile(userPaths.portalsYml, "utf-8");
  const cfg = YAML.parse(portalsYml) as PortalsConfig;

  const positive = cfg.title_filter?.positive ?? [];
  const negative = cfg.title_filter?.negative ?? [];
  const companies = (cfg.tracked_companies ?? []).filter((c) => c.enabled !== false && c.careers_url);

  const seen = await readSeenUrls();
  const inPipeline = await readPipelineUrls();

  opts.setProgress("Launching browser");
  const browser = await chromium.launch({ headless: true });
  const found: Array<{ company: string; title: string; url: string; source: string }> = [];

  try {
    for (const c of companies) {
      opts.setProgress("Scanning", c.name);
      opts.log(`Scanning ${c.name}: ${c.careers_url}`);
      const page = await browser.newPage();
      try {
        await page.goto(c.careers_url, { waitUntil: "networkidle", timeout: 90_000 });
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

        for (const l of links) {
          const title = l.text.replace(/\s+/g, " ").trim();
          if (!title) continue;
          if (negative.length && includesAny(title, negative)) continue;
          if (positive.length && !includesAny(title, positive)) continue;
          const url = l.href;
          if (seen.has(url) || inPipeline.has(url)) continue;
          found.push({ company: c.name, title, url, source: c.careers_url });
        }
      } catch (e) {
        opts.log(`Scan failed for ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
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

  const scanRows = found.map((f) => `${f.url}\t${todayYmd()}\tplaywright\t${f.title}\t${f.company}\tadded`);
  const scanPrev = await fs.readFile(userPaths.scanHistoryTsv, "utf-8");
  await fs.writeFile(userPaths.scanHistoryTsv, scanPrev.trimEnd() + "\n" + scanRows.join("\n") + "\n", "utf-8");

  return { added: found.length };
}

