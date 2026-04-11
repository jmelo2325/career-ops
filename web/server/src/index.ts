import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

import express from "express";
import cors from "cors";

import { z } from "zod";

import { computeMetrics, parseApplications, statusPriority } from "./lib/applications";
import { updateApplicationStatusByReportNumber } from "./lib/statusUpdate";
import { enqueueJob, getJob, listJobs } from "./lib/jobQueue";
import { listReports, readReport } from "./lib/reports";
import { findPdfForReport, getPdfAbsolutePath, revealPdfInExplorer } from "./lib/pdfLookup";
import { runEvaluateJob } from "./lib/runEvaluateJob";
import { runNodeScript } from "./lib/scripts";
import { runScanJob } from "./lib/scan";
import { runPipelineJob } from "./lib/pipeline";
import { isValidMode, streamChat } from "./lib/chat";
import type { ChatMode } from "./lib/chat";

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/applications", async (_req, res) => {
  const apps = await parseApplications();
  apps.sort((a, b) => {
    const sp = statusPriority(a.status) - statusPriority(b.status);
    if (sp !== 0) return sp;
    if (a.score !== b.score) return (b.score ?? 0) - (a.score ?? 0);
    return (b.date ?? "").localeCompare(a.date ?? "");
  });
  const metrics = computeMetrics(apps);
  res.json({ apps, metrics });
});

app.get("/api/reports", async (_req, res) => {
  const reports = await listReports();
  res.json({ reports });
});

app.get("/api/reports/raw", async (req, res) => {
  const qp = z.object({ path: z.string().min(1) }).safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ ok: false, error: qp.error.flatten() });
    return;
  }
  try {
    const md = await readReport(qp.data.path);
    res.json({ ok: true, markdown: md });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.patch("/api/applications/:reportNumber/status", async (req, res) => {
  const reportNumber = req.params.reportNumber;
  const bodySchema = z.object({ status: z.string().min(1) });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() });
    return;
  }
  try {
    await updateApplicationStatusByReportNumber(reportNumber, parsed.data.status);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ ok: false, error: "Not found" });
    return;
  }
  res.json({ ok: true, job });
});

app.post("/api/jobs/evaluate", async (req, res) => {
  const schema = z.object({
    jdText: z.string().min(50).optional(),
    jdUrl: z.string().url().optional()
  }).refine((v) => Boolean(v.jdText) || Boolean(v.jdUrl), { message: "Provide jdText or jdUrl" });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() });
    return;
  }

  const job = enqueueJob({
    type: "evaluate",
    run: async ({ log, setProgress }) => runEvaluateJob(parsed.data, { log, setProgress })
  });

  res.json({ ok: true, jobId: job.id });
});

app.post("/api/jobs/scripts/:name", async (req, res) => {
  const name = req.params.name;
  const allowed: Record<string, string> = {
    merge: "merge-tracker.mjs",
    verify: "verify-pipeline.mjs",
    normalize: "normalize-statuses.mjs",
    dedup: "dedup-tracker.mjs"
  };
  const script = allowed[name];
  if (!script) {
    res.status(404).json({ ok: false, error: "Unknown script" });
    return;
  }

  const job = enqueueJob({
    type: `script:${name}`,
    run: async ({ log, setProgress }) => {
      setProgress("Running script", script);
      await runNodeScript(script, [], { log });
      return { script };
    }
  });

  res.json({ ok: true, jobId: job.id });
});

app.post("/api/jobs/scan", async (_req, res) => {
  const job = enqueueJob({
    type: "scan",
    run: async ({ log, setProgress }) => runScanJob({ log, setProgress })
  });
  res.json({ ok: true, jobId: job.id });
});

app.post("/api/jobs/pipeline", async (req, res) => {
  const schema = z.object({ max: z.number().int().min(1).max(50).optional() });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() });
    return;
  }
  const job = enqueueJob({
    type: "pipeline",
    run: async ({ log, setProgress }) => runPipelineJob({ max: parsed.data.max, log, setProgress })
  });
  res.json({ ok: true, jobId: job.id });
});

app.get("/api/pdf/info", async (req, res) => {
  const qp = z.object({ reportNum: z.string().min(1) }).safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ ok: false, error: qp.error.flatten() });
    return;
  }
  const info = await findPdfForReport(qp.data.reportNum);
  res.json({ ok: true, ...info });
});

app.get("/api/pdf/serve/:filename", async (req, res) => {
  const filename = req.params.filename;
  if (!/^[\w.-]+\.pdf$/i.test(filename)) {
    res.status(400).json({ ok: false, error: "Invalid filename" });
    return;
  }
  const absPath = getPdfAbsolutePath(filename);
  if (!absPath) {
    res.status(404).json({ ok: false, error: "PDF not found" });
    return;
  }
  res.sendFile(absPath);
});

app.post("/api/pdf/reveal", async (req, res) => {
  const schema = z.object({ filename: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() });
    return;
  }
  try {
    await revealPdfInExplorer(parsed.data.filename);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.post("/api/chat", async (req, res) => {
  const schema = z.object({
    mode: z.string().min(1),
    messages: z.array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      })
    ).min(1).max(100),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.flatten() });
    return;
  }

  if (!isValidMode(parsed.data.mode)) {
    res.status(400).json({ ok: false, error: `Invalid mode: ${parsed.data.mode}` });
    return;
  }

  await streamChat(parsed.data.mode as ChatMode, parsed.data.messages, res);
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";

app.listen(port, host, () => {
  console.log(`career-ops web API listening on http://${host}:${port}`);
  console.log(`ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? "configured" : "NOT SET"}`);
  console.log(`ANTHROPIC_MODEL: ${process.env.ANTHROPIC_MODEL || "(default: claude-sonnet-4-6)"}`);

});

