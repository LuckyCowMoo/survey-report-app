# Damp Survey Report Generator

A web app for iPhone (installable PWA) that turns a surveyor's shorthand
damp-survey document into a finished, client-ready report.

The surveyor picks the shorthand `.docx` (numbered photos + short field notes)
from the Files app. The app:

1. **Parses** the document in the browser - photos, notes and dates are
   extracted locally; nothing is uploaded to any server.
2. **Matches** each photo's note against the firm's approved standard wording
   (the content library extracted from the template document), filling in
   values like humidity percentages and pin readings found in the note.
3. Optionally asks **Claude** (with the photo attached) to resolve terse or
   unmatched notes - picking a library paragraph, reading values off meter
   displays, writing a bespoke paragraph in house style, or cross-referencing
   an earlier section.
4. Lets the surveyor **review** every section, pick different wording, edit
   text, add report details (property, client, weather), tick which damp
   issues apply, choose recommendations, and build the costed project plan.
5. **Generates** the finished `.docx` report - cover page, contents,
   introduction, numbered photo sections, damp explainers, recommendations,
   costs and limitations - entirely on the device, then hands it to the iOS
   share sheet.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/lib/docxParser.ts` | Reads the shorthand `.docx` (entries, notes, dates, images) |
| `src/lib/matcher.ts` | Rule-based matching of notes to library wording |
| `src/lib/claude.ts` | Claude vision fallback (direct browser calls) |
| `src/lib/docxGenerator.ts` | Builds the finished report `.docx` |
| `src/lib/imageUtils.ts` | Image compression / dimension handling |
| `src/data/content-library.json` | Curated standard wording (from the template doc) |
| `src/data/boilerplate.ts` | Fixed report scaffolding text |
| `src/components/` | The review/details/generate UI |
| `scripts/extract-library.mjs` | Re-extracts raw paragraphs from a template `.docx` |
| `scripts/test-parse.ts` | Parses a sample shorthand file and prints the result |
| `scripts/test-e2e.ts` | Full pipeline test: shorthand in, report out |
| `samples/` | Local test documents (gitignored - client data) |

## Development (Windows, no Mac needed)

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally

npm run test-parse # parse samples/shorthand.docx and print entries
npm run test-e2e   # full pipeline test, writes test-output/report.docx
npm run icons      # regenerate PWA icons
```

Testing hook: opening the app with `?sample=<url>` loads a document over HTTP
through the same pipeline as the file picker (used by automated tests, e.g.
copy a sample into `dist/` and open `/?sample=/shorthand.docx`).

## Deployment (free static hosting)

The app is a static site - any static host works. No server-side code runs.

**Cloudflare Pages (recommended):**

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: Workers & Pages -> Create -> Pages ->
   Connect to Git -> select the repo.
3. Build command `npm run build`, output directory `dist`. Deploy.
4. Every push to `main` redeploys automatically. The site gets a
   `*.pages.dev` URL (custom domains optional).

**GitHub Pages (alternative):** already configured in
`.github/workflows/deploy.yml`. In the repo settings enable
Pages -> Source: GitHub Actions, then push to `main`.

## Installing on the iPhone

1. Open the deployed URL in Safari.
2. Tap the Share button -> **Add to Home Screen**.
3. The app appears as "Survey Reports" with its own icon and runs
   full-screen. After the first visit it also loads offline (AI calls need
   internet).

## Claude API key

Sections the matcher can't confidently resolve are flagged "Needs attention".
To let the AI resolve them (it reads the photos too):

1. Create an API key at <https://platform.claude.com/> (the client's own
   account - usage costs pennies per report).
2. In the app, open **Settings** and paste the key. It is stored only on the
   device (localStorage) and sent only to `api.anthropic.com`.
3. The model defaults to `claude-sonnet-5`; it can be changed in Settings.

Without a key everything still works - flagged sections are simply edited by
hand or via the standard-wording picker.

## Updating the standard wording

Edit `src/data/content-library.json` (each entry: `id`, `group`, `topic`,
`keywords` used by the matcher, `placeholders`, `text`). To pull text out of a
new template document for curation, run:

```bash
node scripts/extract-library.mjs path/to/template.docx
```

which writes the raw paragraphs to `scripts/extracted/` for copy-editing into
the library.

## Privacy

Survey documents and photos are processed entirely on the device. The only
outbound traffic is the optional Claude API call (photo + note + candidate
wording for flagged sections). Keep `samples/` out of version control (already
gitignored) - it contains real client documents.
