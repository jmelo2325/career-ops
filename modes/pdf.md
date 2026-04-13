# Modo: pdf — Generación de PDF ATS-Optimizado

## Pipeline completo

1. Lee `cv.md` como fuentes de verdad
2. Pide al usuario el JD si no está en contexto (texto o URL)
3. Extrae 15-20 keywords del JD
4. Detecta idioma del JD → idioma del CV (EN default)
5. Detecta ubicación empresa → formato papel:
   - US/Canada → `letter`
   - Resto del mundo → `a4`
6. Detecta arquetipo del rol → adapta framing
7. Reescribe Professional Summary inyectando keywords del JD + exit narrative bridge ("Built and sold a business. Now applying systems thinking to [domain del JD].")
8. Selecciona top 3-4 proyectos más relevantes para la oferta
9. Reordena bullets de experiencia por relevancia al JD
10. Construye competency grid desde requisitos del JD (6-8 keyword phrases)
11. Inyecta keywords naturalmente en logros existentes (NUNCA inventa)
12. Genera HTML completo desde template + contenido personalizado
13. Escribe HTML a `/tmp/cv-candidate-{company}.html`
14. Ejecuta: `node generate-pdf.mjs /tmp/cv-candidate-{company}.html output/cv-candidate-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}`
15. Reporta: ruta del PDF, nº páginas, % cobertura de keywords

## Reglas ATS (parseo limpio)

- Layout single-column (sin sidebars, sin columnas paralelas)
- Headers estándar: "Professional Summary", "Work Experience", "Education", "Skills", "Certifications", "Projects"
- Sin texto en imágenes/SVGs
- Sin info crítica en headers/footers del PDF (ATS los ignora)
- UTF-8, texto seleccionable (no rasterizado)
- Sin tablas anidadas
- Keywords del JD distribuidas: Summary (top 5), primer bullet de cada rol, Skills section

## Diseño del PDF — Editorial / Magazine style

The template uses CSS custom properties `--brand` and `--accent` that shift the entire color palette per company.

- **Fonts**: Space Grotesk (headings, 600-700) + DM Sans (body, 400-500)
- **Fonts self-hosted**: `fonts/`
- **Header**: full-width brand-colored banner (`--brand` background, white text), candidate name in Space Grotesk 28px bold. Below: contact strip with accent-colored underline (3px `--accent`).
- **Section titles**: Space Grotesk 11px, uppercase, letter-spacing 0.12em, `--accent` color, preceded by a short 16px decorative dash in `--accent`. No full-width underline.
- **Body**: DM Sans 10.5px, line-height 1.55
- **Company names**: `--accent` color, Space Grotesk 11.5px semibold
- **Experience blocks**: 2px left border in `--accent` (35% opacity) with a small accent dot — creates a timeline feel
- **Competency pills**: rounded, brand-tinted background with brand-colored text
- **Margins**: 0.6in
- **Background**: white

### Dynamic brand colors

The LLM must return `brandPrimary` and `brandAccent` (hex `#RRGGBB`) matching the target company's real brand palette. These are injected as `--brand` and `--accent` CSS custom properties. Every structural color in the template references these variables, so the entire CV shifts to match the company.

## Orden de secciones (optimizado "6-second recruiter scan")

1. Header banner (name in white on brand-colored background)
2. Contact strip (email, linkedin.com/in/..., location)
3. Professional Summary (3-4 lines, keyword-dense)
4. Core Competencies (6-8 keyword phrases in rounded pills)
5. Work Experience (reverse chronological, timeline left border)
6. Projects (top 3-4 most relevant)
7. Education & Certifications
8. Skills (languages + technical)

## Estrategia de keyword injection (ético, basado en verdad)

Ejemplos de reformulación legítima:
- JD dice "RAG pipelines" y CV dice "LLM workflows with retrieval" → cambiar a "RAG pipeline design and LLM orchestration workflows"
- JD dice "MLOps" y CV dice "observability, evals, error handling" → cambiar a "MLOps and observability: evals, error handling, cost monitoring"
- JD dice "stakeholder management" y CV dice "collaborated with team" → cambiar a "stakeholder management across engineering, operations, and business"

**NUNCA añadir skills que el candidato no tiene. Solo reformular experiencia real con el vocabulario exacto del JD.**

## Template HTML

Usar el template en `cv-template.html`. Reemplazar los placeholders `{{...}}` con contenido personalizado:

| Placeholder | Contenido |
|-------------|-----------|
| `{{LANG}}` | `en` o `es` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) o `210mm` (A4) |
| `{{BRAND_PRIMARY}}` | Hex color matching target company brand (e.g. `#00A1E0`) |
| `{{BRAND_ACCENT}}` | Complementary hex color from company palette |
| `{{NAME}}` | (from profile.yml) |
| `{{EMAIL}}` | (from profile.yml) |
| `{{LINKEDIN_URL}}` | Full URL (from profile.yml) |
| `{{LINKEDIN_DISPLAY}}` | Readable path, e.g. `linkedin.com/in/jessmelo` |
| `{{LOCATION}}` | (from profile.yml) |
| `{{SECTION_SUMMARY}}` | Professional Summary / Resumen Profesional |
| `{{SUMMARY_TEXT}}` | Summary personalizado con keywords |
| `{{SECTION_COMPETENCIES}}` | Core Competencies / Competencias Core |
| `{{COMPETENCIES}}` | `<span class="competency-tag">keyword</span>` × 6-8 |
| `{{SECTION_EXPERIENCE}}` | Work Experience / Experiencia Laboral |
| `{{EXPERIENCE}}` | HTML de cada trabajo con bullets reordenados |
| `{{SECTION_PROJECTS}}` | Projects / Proyectos |
| `{{PROJECTS}}` | HTML de top 3-4 proyectos |
| `{{SECTION_EDUCATION}}` | Education / Formación |
| `{{EDUCATION}}` | HTML de educación |
| `{{SECTION_CERTIFICATIONS}}` | Certifications / Certificaciones |
| `{{CERTIFICATIONS}}` | HTML de certificaciones |
| `{{SECTION_SKILLS}}` | Skills / Competencias |
| `{{SKILLS}}` | HTML de skills |

## Post-generación

Actualizar tracker si la oferta ya está registrada: cambiar PDF de ❌ a ✅.
