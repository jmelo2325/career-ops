import fs from "node:fs/promises";

import { userPaths } from "./paths";

export async function markPdfGenerated(reportNumber: string) {
  let content: string;
  try {
    content = await fs.readFile(userPaths.applicationsMd, "utf-8");
  } catch {
    return;
  }

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (!trimmed.includes(`[${reportNumber}]`)) continue;
    if (trimmed.includes("✅")) return;

    const parts = trimmed.split("|").map((p) => p.trim());
    const cells = parts.filter((p) => p.length > 0);
    if (cells.length < 8) continue;

    // PDF column index: 6 (0-based)
    const pdfIdx = 6;
    if (pdfIdx < cells.length) cells[pdfIdx] = "✅";
    lines[i] = `| ${cells.join(" | ")} |`;
    break;
  }

  await fs.writeFile(userPaths.applicationsMd, lines.join("\n"));
}

