import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";
import YAML from "yaml";

import { getAnthropicClient, getAnthropicModel } from "./anthropic";
import { repoRoot, userPaths } from "./paths";
import { runNodeScript } from "./scripts";

function safeReplaceAll(s: string, map: Record<string, string>) {
  let out = s;
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
  return out;
}

const PdfPartsSchema = z.object({
  lang: z.enum(["en", "es"]).default("en"),
  brandPrimary: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1a1a2e"),
  brandAccent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2d6a6a"),
  summaryText: z.string().min(10),
  competencies: z.array(z.string().min(2)).min(4).max(12),
  experienceHtml: z.string().min(10),
  projectsHtml: z.string().min(0),
  educationHtml: z.string().min(0),
  certificationsHtml: z.string().min(0),
  skillsHtml: z.string().min(10)
});

export async function generateTailoredPdf(params: {
  company: string;
  slug: string;
  num: string;
  jd: string;
  reportRel: string;
  log: (l: string) => void;
  setProgress: (s: string, d?: string) => void;
}) {
  const { company, slug, num, jd, log, setProgress } = params;

  const [cv, profileYml, profileMd, sharedMd, pdfMode, template] = await Promise.all([
    fs.readFile(userPaths.cv, "utf-8"),
    fs.readFile(userPaths.profileYml, "utf-8"),
    fs.readFile(userPaths.profileMd, "utf-8"),
    fs.readFile(userPaths.sharedMd, "utf-8"),
    fs.readFile(path.join(repoRoot, "modes", "pdf.md"), "utf-8"),
    fs.readFile(path.join(repoRoot, "templates", "cv-template.html"), "utf-8")
  ]);

  const profile = YAML.parse(profileYml) as any;
  const candidate = profile?.candidate ?? {};
  const fullName = candidate.full_name || "Candidate";
  const email = candidate.email || "";
  const linkedin = candidate.linkedin || "";
  const location = candidate.location || candidate.city || "";

  setProgress("Generating PDF content (LLM)");
  const client = getAnthropicClient();
  const model = getAnthropicModel();

  const system = [
    "You generate ATS-friendly resume content for an editorial-style HTML template.",
    "Return ONLY valid JSON, no markdown, no backticks.",
    "HTML fields MUST be fragments only (no <html>, <body>).",
    "",
    "BRAND COLORS (required):",
    "Return `brandPrimary` and `brandAccent` as hex strings (#RRGGBB).",
    "These MUST match the target company's actual brand palette.",
    "brandPrimary = the company's dominant brand color (used for the header banner).",
    "brandAccent = a complementary color from their palette (used for section titles and highlights).",
    "Examples: Salesforce → #00A1E0/#032D60, HubSpot → #FF7A59/#2D3E50, Anthropic → #D97757/#191919.",
    "If you cannot identify the company, use #1a1a2e/#2d6a6a.",
    "",
    "HTML STRUCTURE for experienceHtml (use these CSS classes):",
    '<div class="job"><div class="job-header"><span class="job-company">Company Name</span><span class="job-period">Jan 2022 – Present</span></div><div class="job-role">Title</div><ul><li>Achievement bullet</li></ul></div>',
    "",
    "HTML STRUCTURE for projectsHtml:",
    '<div class="project"><span class="project-title">Name</span><div class="project-desc">Description</div><div class="project-tech">Tech stack</div></div>',
    "",
    "HTML STRUCTURE for educationHtml:",
    '<div class="edu-item"><div class="edu-header"><span class="edu-title"><span class="edu-org">School</span> — Degree</span><span class="edu-year">Year</span></div></div>',
    "",
    "HTML STRUCTURE for certificationsHtml:",
    '<div class="cert-item"><span class="cert-title"><span class="cert-org">Issuer</span> — Cert Name</span><span class="cert-year">Year</span></div>',
    "",
    "HTML STRUCTURE for skillsHtml:",
    '<div class="skills-grid"><span class="skill-item"><span class="skill-category">Category:</span> items</span></div>',
  ].join("\n");

  const user = [
    "## System rules (_shared.md)",
    sharedMd,
    "\n## User overrides (_profile.md)",
    profileMd,
    "\n## Mode instructions (pdf.md)",
    pdfMode,
    "\n## Candidate CV (cv.md)",
    cv,
    "\n## Job description",
    jd
  ].join("\n\n");

  const resp = await client.messages.create({
    model,
    max_tokens: 6000,
    temperature: 0.2,
    system,
    messages: [
      {
        role: "user",
        content: user + "\n\nReturn JSON with keys: lang, brandPrimary, brandAccent, summaryText, competencies (string[]), experienceHtml, projectsHtml, educationHtml, certificationsHtml, skillsHtml."
      }
    ]
  });

  let jsonText = resp.content.map((b) => ("text" in b ? b.text : "")).join("").trim();
  jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  let parsed: z.infer<typeof PdfPartsSchema>;
  try {
    parsed = PdfPartsSchema.parse(JSON.parse(jsonText));
  } catch (e) {
    log("Failed to parse PDF JSON from model. Raw response (first 300 chars):");
    log(jsonText.slice(0, 300));
    throw e instanceof Error ? e : new Error(String(e));
  }

  const competenciesHtml = parsed.competencies
    .map((c) => `<span class="competency-tag">${escapeHtml(c)}</span>`)
    .join("\n");

  const lang = parsed.lang || "en";
  const pageWidth = "8.5in"; // US default

  const sections = lang === "es"
    ? {
        SECTION_SUMMARY: "Resumen Profesional",
        SECTION_COMPETENCIES: "Competencias Core",
        SECTION_EXPERIENCE: "Experiencia Laboral",
        SECTION_PROJECTS: "Proyectos",
        SECTION_EDUCATION: "Formación",
        SECTION_CERTIFICATIONS: "Certificaciones",
        SECTION_SKILLS: "Competencias"
      }
    : {
        SECTION_SUMMARY: "Professional Summary",
        SECTION_COMPETENCIES: "Core Competencies",
        SECTION_EXPERIENCE: "Work Experience",
        SECTION_PROJECTS: "Projects",
        SECTION_EDUCATION: "Education",
        SECTION_CERTIFICATIONS: "Certifications",
        SECTION_SKILLS: "Skills"
      };

  const linkedinDisplay = linkedin
    ? linkedin.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
    : "";

  const filled = safeReplaceAll(template, {
    "{{LANG}}": lang,
    "{{PAGE_WIDTH}}": pageWidth,
    "{{BRAND_PRIMARY}}": parsed.brandPrimary,
    "{{BRAND_ACCENT}}": parsed.brandAccent,
    "{{NAME}}": escapeHtml(fullName),
    "{{EMAIL}}": escapeHtml(email),
    "{{LINKEDIN_URL}}": linkedin || "#",
    "{{LINKEDIN_DISPLAY}}": linkedinDisplay,
    "{{LOCATION}}": escapeHtml(location),
    "{{SECTION_SUMMARY}}": sections.SECTION_SUMMARY,
    "{{SUMMARY_TEXT}}": parsed.summaryText,
    "{{SECTION_COMPETENCIES}}": sections.SECTION_COMPETENCIES,
    "{{COMPETENCIES}}": competenciesHtml,
    "{{SECTION_EXPERIENCE}}": sections.SECTION_EXPERIENCE,
    "{{EXPERIENCE}}": parsed.experienceHtml,
    "{{SECTION_PROJECTS}}": sections.SECTION_PROJECTS,
    "{{PROJECTS}}": parsed.projectsHtml,
    "{{SECTION_EDUCATION}}": sections.SECTION_EDUCATION,
    "{{EDUCATION}}": parsed.educationHtml,
    "{{SECTION_CERTIFICATIONS}}": sections.SECTION_CERTIFICATIONS,
    "{{CERTIFICATIONS}}": parsed.certificationsHtml,
    "{{SECTION_SKILLS}}": sections.SECTION_SKILLS,
    "{{SKILLS}}": parsed.skillsHtml
  });

  setProgress("Rendering PDF (Playwright)");
  const tmpDir = path.join(userPaths.outputDir, "_tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const htmlPath = path.join(tmpDir, `cv-${num}-${slug}.html`);
  const pdfPath = path.join(userPaths.outputDir, `cv-${slug}-${num}.pdf`);
  await fs.writeFile(htmlPath, filled, "utf-8");

  await runNodeScript("generate-pdf.mjs", [htmlPath, pdfPath, "--format=letter"], { log });

  return { htmlPath, pdfPath };
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

