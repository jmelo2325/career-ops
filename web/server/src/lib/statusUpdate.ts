import fs from "node:fs/promises";

import { userPaths } from "./paths";

export async function updateApplicationStatusByReportNumber(reportNumber: string, newStatus: string) {
  let content: string;
  try {
    content = await fs.readFile(userPaths.applicationsMd, "utf-8");
  } catch {
    // If tracker doesn't exist yet, nothing to update.
    throw new Error("applications.md not found. Run an evaluation first to create the tracker.");
  }

  const lines = content.split("\n");
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (!reportNumber) continue;
    if (!trimmed.includes(`[${reportNumber}]`)) continue;

    // Replace the status field by parsing columns, not substring replace.
    const updated = replaceStatusInTableLine(line, newStatus);
    lines[i] = updated;
    found = true;
    break;
  }

  if (!found) throw new Error(`Application not found for report #${reportNumber}`);
  await fs.writeFile(userPaths.applicationsMd, lines.join("\n"));
}

function replaceStatusInTableLine(line: string, newStatus: string) {
  // Support pipe tables: | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
  // Keep everything else intact.
  const original = line;
  if (!original.includes("|")) return original;

  // Avoid touching header/separator rows.
  if (original.includes("---")) return original;

  const leftTrimmed = original.trim();
  const startsWithPipe = leftTrimmed.startsWith("|");
  if (!startsWithPipe) return original;

  const parts = leftTrimmed.split("|").map((p) => p.trim());
  // parts: ["", "#", "Date", ... , ""]
  const cells = parts.filter((p) => p.length > 0);
  if (cells.length < 8) return original;

  // status is column 6 in apps table (1-indexed): #,Date,Company,Role,Score,Status,PDF,Report,Notes?
  const statusIdx = 5; // 0-based within cells
  if (statusIdx >= cells.length) return original;
  cells[statusIdx] = newStatus;

  return `| ${cells.join(" | ")} |`;
}

