import fs from "node:fs/promises";
import path from "node:path";

import { userPaths } from "./paths";

export type ReportIndexEntry = {
  filename: string;
  relPath: string; // reports/...
  mtimeMs: number;
  title?: string;
};

export async function listReports(): Promise<ReportIndexEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(userPaths.reportsDir);
  } catch {
    return [];
  }
  const out: ReportIndexEntry[] = [];
  for (const filename of files) {
    if (!filename.toLowerCase().endsWith(".md")) continue;
    const full = path.join(userPaths.reportsDir, filename);
    const st = await fs.stat(full);
    out.push({
      filename,
      relPath: `reports/${filename}`,
      mtimeMs: st.mtimeMs
    });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

export async function readReport(relPath: string): Promise<string> {
  const normalized = relPath.replaceAll("\\", "/");
  if (!normalized.startsWith("reports/")) throw new Error("Invalid report path.");
  const filename = normalized.slice("reports/".length);
  const full = path.join(userPaths.reportsDir, path.basename(filename));
  return await fs.readFile(full, "utf-8");
}

