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
  tagline: z.string().min(4).max(120),
  summaryText: z.string().min(10),
  competencies: z.array(z.string().min(2)).min(4).max(12),
  experienceHtml: z.string().min(10),
  projectsHtml: z.string().min(0).default(""),
  educationHtml: z.string().min(0).default(""),
  certificationsHtml: z.string().min(0).default(""),
  skillsHtml: z.string().min(10),
  lifePhilosophy: z
    .object({
      quote: z.string().min(8),
      author: z.string().min(2),
    })
    .nullable()
    .default(null),
  mostProudOf: z
    .array(
      z.object({
        title: z.string().min(2).max(30),
        description: z.string().min(8).max(240),
      }),
    )
    .max(4)
    .default([]),
  strengths: z.array(z.string().min(2)).max(8).default([]),
  methodologies: z
    .array(
      z.object({
        name: z.string().min(1).max(30),
        level: z.number().int().min(1).max(4),
      }),
    )
    .max(6)
    .default([]),
  dayInTheLife: z
    .array(z.object({ time: z.string().min(1).max(16), activity: z.string().min(2).max(80) }))
    .max(6)
    .default([]),
});

type PdfParts = z.infer<typeof PdfPartsSchema>;

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
    fs.readFile(path.join(repoRoot, "templates", "cv-template.html"), "utf-8"),
  ]);

  const profile = YAML.parse(profileYml) as any;
  const candidate = profile?.candidate ?? {};
  const fullName = candidate.full_name || "Candidate";
  const email = candidate.email || "";
  const linkedin = candidate.linkedin || "";
  const location = candidate.location || candidate.city || "";
  const phone = candidate.phone || "";

  setProgress("Generating PDF content (LLM)");
  const client = getAnthropicClient();
  const model = getAnthropicModel();

  const system = [
    "You generate infographic-style, ATS-friendly resume content for a two-column magazine layout.",
    "Return ONLY valid JSON, no markdown, no backticks.",
    "HTML fields MUST be fragments only (no <html>, <body>).",
    "",
    "BRAND COLORS (required):",
    "Return `brandPrimary` and `brandAccent` as hex strings (#RRGGBB).",
    "These MUST match the target company's actual brand palette.",
    "brandPrimary = the company's dominant brand color (used for the header banner and accents).",
    "brandAccent = a complementary color from their palette (used for section rules and highlights).",
    "Examples: Salesforce → #00A1E0/#032D60, HubSpot → #FF7A59/#2D3E50, Anthropic → #D97757/#191919, Wellhub → #FF6132/#1C1C1C.",
    "If you cannot identify the company, use #1a1a2e/#2d6a6a.",
    "",
    "CONTENT GUIDELINES:",
    "- tagline: ONE short personal brand line (6–12 words), e.g. 'Sales Enablement Executive & Innovative Powerhouse'. Match the candidate's voice from their CV.",
    "- summaryText: 3–5 sentence executive profile, dense with JD keywords, written in 1st-person-implied prose (no 'I').",
    "- competencies: 6–10 short keyword phrases from the JD, e.g. 'Revenue Enablement Strategy'.",
    "- mostProudOf: 3 items, each a title (1–3 words) + one-sentence description of a career-defining achievement. Examples of titles: Ingenuity, Growth, Expertise, Leadership, Impact, Craft.",
    "- strengths: 5–7 short strengths/abilities phrases (2–5 words each), e.g. 'Transformative Leadership', 'Consultative Selling'.",
    "- methodologies: 3–5 domain-relevant frameworks with a proficiency level 1–4. For sales-enablement roles use MEDDPICC/BANT/CoM/SPIN/Challenger. For eng roles use SOLID/TDD/DDD/REST/GraphQL. Pick what fits the candidate and JD.",
    "- dayInTheLife: OMIT (return empty array) unless the candidate's profile clearly suggests specific daily rituals.",
    "- lifePhilosophy: OMIT (return null) unless the candidate's profile includes a personal quote; do NOT fabricate.",
    "",
    "HTML STRUCTURE for experienceHtml (use these CSS classes, in reverse-chronological order):",
    '<div class="job"><div class="job-header"><div class="job-title-block"><div class="job-role">Vice President of Revenue Enablement</div><div class="job-company">Enable</div></div><div class="job-meta"><div class="job-period">Sep 2024 – May 2025</div><div class="job-location">Remote</div></div></div><ul><li>Achievement bullet with <strong>key metric</strong>.</li></ul></div>',
    "",
    "HTML STRUCTURE for projectsHtml (optional, omit by returning empty string):",
    '<div class="project"><span class="project-title">Name</span><div class="project-desc">Description</div><div class="project-tech">Tech/context</div></div>',
    "",
    "HTML STRUCTURE for educationHtml:",
    '<div class="edu-item"><div class="edu-header"><span class="edu-title"><span class="edu-org">School</span> — Degree</span><span class="edu-year">Year</span></div></div>',
    "",
    "HTML STRUCTURE for certificationsHtml (omit if none):",
    '<div class="cert-item"><span class="cert-title"><span class="cert-org">Issuer</span> — Cert Name</span><span class="cert-year">Year</span></div>',
    "",
    "HTML STRUCTURE for skillsHtml:",
    '<div class="skills-grid"><div class="skill-item"><span class="skill-category">Category:</span> item1, item2, item3</div></div>',
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
    jd,
  ].join("\n\n");

  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    temperature: 0.2,
    system,
    messages: [
      {
        role: "user",
        content:
          user +
          "\n\nReturn JSON with keys: lang, brandPrimary, brandAccent, tagline, summaryText, competencies (string[]), mostProudOf (array of {title, description}), strengths (string[]), methodologies (array of {name, level}), dayInTheLife (array of {time, activity}), lifePhilosophy ({quote, author} or null), experienceHtml, projectsHtml, educationHtml, certificationsHtml, skillsHtml.",
      },
    ],
  });

  let jsonText = resp.content.map((b) => ("text" in b ? b.text : "")).join("").trim();
  jsonText = jsonText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  let parsed: PdfParts;
  try {
    parsed = PdfPartsSchema.parse(JSON.parse(jsonText));
  } catch (e) {
    log("Failed to parse PDF JSON from model. Raw response (first 400 chars):");
    log(jsonText.slice(0, 400));
    throw e instanceof Error ? e : new Error(String(e));
  }

  const competenciesHtml = parsed.competencies
    .map((c) => `<span class="competency-tag">${escapeHtml(c)}</span>`)
    .join("\n");

  const mostProudOfHtml = parsed.mostProudOf
    .map((item, i) => {
      const icons = ["lightbulb", "rocket", "trophy", "star"] as const;
      const icon = renderIconSvg(icons[i % icons.length]);
      return `<div class="proud-item"><div class="proud-icon">${icon}</div><div class="proud-body"><div class="proud-title">${escapeHtml(item.title)}</div><div class="proud-desc">${escapeHtml(item.description)}</div></div></div>`;
    })
    .join("\n");

  const strengthsHtml = parsed.strengths
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("\n");

  const methodologiesHtml = parsed.methodologies
    .map((m) => {
      const filled = "●".repeat(m.level);
      const empty = "○".repeat(Math.max(0, 4 - m.level));
      return `<div class="method-item"><span class="method-name">${escapeHtml(m.name)}</span><span class="method-dots" aria-label="${m.level} of 4">${filled}${empty}</span></div>`;
    })
    .join("\n");

  const dayInTheLifeHtml = parsed.dayInTheLife
    .map((d) => `<div class="day-item"><span class="day-time">${escapeHtml(d.time)}</span><span class="day-activity">${escapeHtml(d.activity)}</span></div>`)
    .join("\n");

  const lifePhilosophyHtml = parsed.lifePhilosophy
    ? `<blockquote class="philosophy-quote">“${escapeHtml(parsed.lifePhilosophy.quote)}”</blockquote><div class="philosophy-author">— ${escapeHtml(parsed.lifePhilosophy.author)}</div>`
    : "";

  const lang = parsed.lang || "en";
  const pageWidth = "8.5in";

  const sections =
    lang === "es"
      ? {
          SECTION_SUMMARY: "Perfil Ejecutivo",
          SECTION_COMPETENCIES: "Competencias Clave",
          SECTION_EXPERIENCE: "Experiencia",
          SECTION_PROJECTS: "Proyectos",
          SECTION_EDUCATION: "Formación",
          SECTION_CERTIFICATIONS: "Certificaciones",
          SECTION_SKILLS: "Herramientas y Habilidades",
          SECTION_PROUD: "Logros Destacados",
          SECTION_STRENGTHS: "Fortalezas",
          SECTION_METHODOLOGIES: "Metodologías",
          SECTION_PHILOSOPHY: "Filosofía",
          SECTION_DAY: "Un Día en la Vida",
        }
      : {
          SECTION_SUMMARY: "Executive Profile",
          SECTION_COMPETENCIES: "Core Competencies",
          SECTION_EXPERIENCE: "Experience",
          SECTION_PROJECTS: "Projects",
          SECTION_EDUCATION: "Education",
          SECTION_CERTIFICATIONS: "Certifications",
          SECTION_SKILLS: "Tools & Skills",
          SECTION_PROUD: "Most Proud Of",
          SECTION_STRENGTHS: "Strengths / Abilities",
          SECTION_METHODOLOGIES: "Methodologies",
          SECTION_PHILOSOPHY: "Life Philosophy",
          SECTION_DAY: "A Day in the Life",
        };

  const linkedinDisplay = linkedin
    ? linkedin.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
    : "";

  const hasProud = parsed.mostProudOf.length > 0;
  const hasStrengths = parsed.strengths.length > 0;
  const hasMethodologies = parsed.methodologies.length > 0;
  const hasPhilosophy = parsed.lifePhilosophy !== null;
  const hasDay = parsed.dayInTheLife.length > 0;
  const hasProjects = parsed.projectsHtml.trim().length > 0;
  const hasCertifications = parsed.certificationsHtml.trim().length > 0;
  const hasPhone = phone.trim().length > 0;
  const sidebarHasContent = hasProud || hasStrengths || hasMethodologies || hasPhilosophy || hasDay;

  let template2 = template;
  if (!sidebarHasContent) {
    template2 = template2.replace('<aside class="sidebar">', '<aside class="sidebar sidebar-collapsed">');
  }

  const filled = safeReplaceAll(template2, {
    "{{LANG}}": lang,
    "{{PAGE_WIDTH}}": pageWidth,
    "{{BRAND_PRIMARY}}": parsed.brandPrimary,
    "{{BRAND_ACCENT}}": parsed.brandAccent,
    "{{NAME}}": escapeHtml(fullName),
    "{{TAGLINE}}": escapeHtml(parsed.tagline),
    "{{EMAIL}}": escapeHtml(email),
    "{{PHONE}}": escapeHtml(phone),
    "{{PHONE_DISPLAY}}": hasPhone ? "flex" : "none",
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
    "{{PROJECTS_DISPLAY}}": hasProjects ? "block" : "none",

    "{{SECTION_EDUCATION}}": sections.SECTION_EDUCATION,
    "{{EDUCATION}}": parsed.educationHtml,

    "{{SECTION_CERTIFICATIONS}}": sections.SECTION_CERTIFICATIONS,
    "{{CERTIFICATIONS}}": parsed.certificationsHtml,
    "{{CERTIFICATIONS_DISPLAY}}": hasCertifications ? "block" : "none",

    "{{SECTION_SKILLS}}": sections.SECTION_SKILLS,
    "{{SKILLS}}": parsed.skillsHtml,

    "{{SECTION_PROUD}}": sections.SECTION_PROUD,
    "{{PROUD}}": mostProudOfHtml,
    "{{PROUD_DISPLAY}}": hasProud ? "block" : "none",

    "{{SECTION_STRENGTHS}}": sections.SECTION_STRENGTHS,
    "{{STRENGTHS}}": strengthsHtml,
    "{{STRENGTHS_DISPLAY}}": hasStrengths ? "block" : "none",

    "{{SECTION_METHODOLOGIES}}": sections.SECTION_METHODOLOGIES,
    "{{METHODOLOGIES}}": methodologiesHtml,
    "{{METHODOLOGIES_DISPLAY}}": hasMethodologies ? "block" : "none",

    "{{SECTION_PHILOSOPHY}}": sections.SECTION_PHILOSOPHY,
    "{{PHILOSOPHY}}": lifePhilosophyHtml,
    "{{PHILOSOPHY_DISPLAY}}": hasPhilosophy ? "block" : "none",

    "{{SECTION_DAY}}": sections.SECTION_DAY,
    "{{DAY_IN_THE_LIFE}}": dayInTheLifeHtml,
    "{{DAY_DISPLAY}}": hasDay ? "block" : "none",
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

/** Simple outline SVG icon set for the "Most Proud Of" sidebar card. Accent-colored via currentColor. */
function renderIconSvg(kind: "lightbulb" | "rocket" | "trophy" | "star"): string {
  const common = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  switch (kind) {
    case "lightbulb":
      return `<svg ${common}><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z"/></svg>`;
    case "rocket":
      return `<svg ${common}><path d="M14 4c3 0 7 4 7 7 0 0-3 1-5 3l-4-4c2-2 2-6 2-6Z"/><path d="M6 14c-2 2-3 7-3 7s5-1 7-3"/><path d="M9 11l4 4"/><circle cx="15" cy="9" r="1"/></svg>`;
    case "trophy":
      return `<svg ${common}><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 4h3v3a3 3 0 0 1-3 3"/><path d="M7 4H4v3a3 3 0 0 0 3 3"/></svg>`;
    case "star":
    default:
      return `<svg ${common}><polygon points="12 2 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9"/></svg>`;
  }
}
