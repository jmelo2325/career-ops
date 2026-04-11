import fs from "node:fs/promises";

import { userPaths } from "./paths";
import { runEvaluateJob } from "./runEvaluateJob";

type PipelineEntry = { url: string; company?: string; title?: string };

function parsePending(md: string): PipelineEntry[] {
  const lines = md.split("\n");
  const entries: PipelineEntry[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*-\s*\[\s*\]\s*(\S+)\s*\|\s*([^|]+)\|\s*(.+)\s*$/);
    if (m) {
      entries.push({ url: m[1]!, company: m[2]!.trim(), title: m[3]!.trim() });
      continue;
    }
    const m2 = line.match(/^\s*-\s*\[\s*\]\s*(https?:\/\/\S+)/);
    if (m2) entries.push({ url: m2[1]! });
  }
  return entries;
}

export async function runPipelineJob(opts: {
  max?: number;
  log: (l: string) => void;
  setProgress: (s: string, d?: string) => void;
}) {
  let pipeline: string;
  try {
    pipeline = await fs.readFile(userPaths.pipelineMd, "utf-8");
  } catch {
    throw new Error("data/pipeline.md not found. Run scan first or create it.");
  }

  const pending = parsePending(pipeline);
  const max = Math.max(1, Math.min(opts.max ?? 5, pending.length));
  const slice = pending.slice(0, max);

  let processed = 0;
  for (const entry of slice) {
    opts.setProgress("Evaluating from pipeline", entry.url);
    opts.log(`Evaluating ${entry.url}`);
    await runEvaluateJob({ jdUrl: entry.url }, { log: opts.log, setProgress: opts.setProgress });
    processed++;
  }

  return { processed };
}

