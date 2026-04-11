import fs from "node:fs/promises";
import path from "node:path";
import type { Response } from "express";
import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropicClient, getAnthropicModel } from "./anthropic";
import { repoRoot, userPaths } from "./paths";

const VALID_MODES = [
  "general",
  "ofertas",
  "contacto",
  "deep",
  "training",
  "project",
  "apply",
] as const;

export type ChatMode = (typeof VALID_MODES)[number];

export function isValidMode(s: string): s is ChatMode {
  return (VALID_MODES as readonly string[]).includes(s);
}

const MODE_FILES: Record<Exclude<ChatMode, "general">, string> = {
  ofertas: "ofertas.md",
  contacto: "contacto.md",
  deep: "deep.md",
  training: "training.md",
  project: "project.md",
  apply: "apply.md",
};

async function readOptional(p: string): Promise<string> {
  try {
    return await fs.readFile(p, "utf-8");
  } catch {
    return "";
  }
}

async function buildSystemPrompt(mode: ChatMode): Promise<string> {
  const [shared, profileMd, profileYml, cv, articleDigest] = await Promise.all([
    fs.readFile(userPaths.sharedMd, "utf-8"),
    fs.readFile(userPaths.profileMd, "utf-8"),
    fs.readFile(userPaths.profileYml, "utf-8"),
    fs.readFile(userPaths.cv, "utf-8"),
    readOptional(userPaths.articleDigest),
  ]);

  const parts: string[] = [
    "You are career-ops, an AI-powered job search assistant.",
    "You have full context about the candidate below. Use it to give specific, actionable advice.",
    "Respond in the language the user writes in. Use markdown formatting.",
    "",
    "## System context (_shared.md)",
    shared,
    "",
    "## User profile overrides (_profile.md)",
    profileMd,
    "",
    "## Candidate profile (profile.yml)",
    profileYml,
    "",
    "## Candidate CV (cv.md)",
    cv,
  ];

  if (articleDigest) {
    parts.push("", "## Article digest", articleDigest);
  }

  if (mode !== "general") {
    const modeFile = MODE_FILES[mode];
    const modeContent = await fs.readFile(
      path.join(repoRoot, "modes", modeFile),
      "utf-8"
    );
    parts.push("", `## Mode instructions (${modeFile})`, modeContent);
  }

  return parts.join("\n");
}

export async function streamChat(
  mode: ChatMode,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  res: Response
): Promise<void> {
  const systemPrompt = await buildSystemPrompt(mode);
  const client = getAnthropicClient();
  const model = getAnthropicModel();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: apiMessages,
  });

  let aborted = false;
  res.on("close", () => {
    aborted = true;
    stream.abort();
  });

  try {
    for await (const event of stream) {
      if (aborted) break;
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        res.write(`data: ${JSON.stringify({ type: "text", text: event.delta.text })}\n\n`);
      }
    }

    if (!aborted) {
      res.write("data: [DONE]\n\n");
    }
  } catch (err) {
    if (!aborted) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
      res.write("data: [DONE]\n\n");
    }
  } finally {
    res.end();
  }
}
