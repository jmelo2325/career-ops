import path from "node:path";

export const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");

export const userPaths = {
  cv: path.join(repoRoot, "cv.md"),
  profileYml: path.join(repoRoot, "config", "profile.yml"),
  profileMd: path.join(repoRoot, "modes", "_profile.md"),
  sharedMd: path.join(repoRoot, "modes", "_shared.md"),
  portalsYml: path.join(repoRoot, "portals.yml"),
  applicationsMd: path.join(repoRoot, "data", "applications.md"),
  pipelineMd: path.join(repoRoot, "data", "pipeline.md"),
  scanHistoryTsv: path.join(repoRoot, "data", "scan-history.tsv"),
  reportsDir: path.join(repoRoot, "reports"),
  outputDir: path.join(repoRoot, "output"),
  jdsDir: path.join(repoRoot, "jds"),
  interviewStoryBank: path.join(repoRoot, "interview-prep", "story-bank.md"),
  articleDigest: path.join(repoRoot, "article-digest.md")
} as const;

export const batchPaths = {
  additionsDir: path.join(repoRoot, "batch", "tracker-additions"),
  batchInputTsv: path.join(repoRoot, "batch", "batch-input.tsv"),
  batchStateTsv: path.join(repoRoot, "batch", "batch-state.tsv")
} as const;

