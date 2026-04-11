import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

import { userPaths } from "./paths";

export async function findPdfForReport(reportNum: string): Promise<{ found: boolean; filename?: string }> {
  const padded = reportNum.padStart(3, "0");
  let files: string[];
  try {
    files = await fs.readdir(userPaths.outputDir);
  } catch {
    return { found: false };
  }
  const pattern = new RegExp(`^cv-.+-${padded}\\.pdf$`, "i");
  const match = files.find((f) => pattern.test(f));
  if (!match) return { found: false };
  return { found: true, filename: match };
}

export function getPdfAbsolutePath(filename: string): string | null {
  const safe = path.basename(filename);
  const full = path.join(userPaths.outputDir, safe);
  try {
    const fsSync = require("node:fs") as typeof import("node:fs");
    fsSync.accessSync(full);
    return full;
  } catch {
    return null;
  }
}

export async function revealPdfInExplorer(filename: string): Promise<void> {
  const safe = path.basename(filename);
  const full = path.join(userPaths.outputDir, safe);
  await fs.access(full);

  const platform = process.platform;
  return new Promise((resolve, reject) => {
    if (platform === "win32") {
      execFile("explorer.exe", ["/select,", full], (err) => {
        // explorer.exe returns exit code 1 even on success
        resolve();
      });
    } else if (platform === "darwin") {
      execFile("open", ["-R", full], (err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      execFile("xdg-open", [path.dirname(full)], (err) => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
}
