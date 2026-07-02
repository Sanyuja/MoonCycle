# Lunarly ✦ Rhythm Studio

Cycle‑aware planning for women who train, perform, and manage high‑output routines. Tracks your menstrual phase, shows hormone curves, schedules your primary movement and intellectual practices on their best-matched days, and syncs to ClickUp / Google Calendar — no app store, no subscription, no login.

Lunarly is a config‑driven cycle‑aware planning studio, built from my own dashboard and designed to be cloned per archetype (athlete, busy professional, menopause).

Live at: [moon-cycle.vercel.app](https://moon-cycle.vercel.app)

### Who it's for

**Natural-cycle women** who want to plan training, work, fasting, and daily routines around their menstrual phases — not just track periods, but actually structure the month around when their body is strongest, most focused, or needs rest.

**Menopausal women** who want energy- and symptom-aware planning instead of period tracking. No cycle-day math. Just a daily energy check-in and symptom log that shifts all the recommendations — movement, food, intellectual load, rest.

### Who it's not for (yet)

If you're on **hormonal birth control** or **hormone replacement therapy (HRT)**, Lunarly can still work as a general energy planner — but its menstrual-phase modeling is not medically precise for you, since both suppress or modify natural hormone cycling. A dedicated hormonal-BC mode is on the roadmap. For now, use it as an energy and habits tracker rather than a phase guide.

**Perimenopause** (the transition into menopause, which can last years and varies enormously) is not yet fully modeled. A perimenopause config is planned — the symptom-tracking foundation is already in place, but the planning logic hasn't been adapted for the irregular-cycle phase of the transition.

---

## What It Does

Most fitness apps treat every week of the month the same. This one doesn't.

The planner knows what phase you're in — menstrual, follicular, ovulatory, or luteal — and gives you phase-appropriate guidance for each day. Your primary movement practice on your peak power days. Your primary intellectual/creative practice when your focus is sharpest. Hot tub when your body needs it. Rest when rest is actually the work.

It also handles a **late cycle** correctly: if you're past your average cycle length, the banner, timeline, hormone chart, and calendar all show "late" instead of wrapping back to day 1.

You tell Lunarly what your **primary movement practice** (pole dance, strength training, running, whatever) and **primary intellectual/creative practice** (streaming, deep work, writing, coding, whatever) are, plus how many sessions a week you want of each. Lunarly maps both onto your cycle, decides which days are the best match, and builds the week's plan from that — instead of assuming everyone trains and thinks the same way every day.

| Tab | What you get |
|-----|-------------|
| **Today** | Phase banner, body stats (sleep/energy/physical/mental — always shows a number, real if you've logged it, estimated from recent history otherwise), Chicago weather, hormone curve chart, your Primary Movement + Primary Intellectual Practice cards, and a "what your body needs today" summary |
| **My Cycle** | Visual cycle wheel, full phase timeline with dates, cycle focus selector |
| **Nourish** | Food guide by phase — what to lean into, what to reduce |
| **Insights** | Upload Checkmarks.csv from your habits app to see streaks, heatmaps, and cycle-phase correlations |
| **Calendar** | This week's phase-aware plan — sessions for your primary movement and intellectual practices placed on their best-matched days (not every day), plus a one-click push of the week's plan to ClickUp |
| **Settings** | Period start date, cycle length, period duration, primary movement & intellectual practice (name, sessions/week, preferred time), Samsung Health CSV uploads |

---

## How to Use It

### First-time setup
1. Open the app in Chrome
2. Go to **⚙️ Settings**
3. Set **First Day of Last Bleed** — this is the most important field
4. Set your average **Cycle Length** and **Period Duration**
5. Hit **Save & Refresh** — everything recalculates

### Each new cycle
When your period starts again:
- Go to **⚙️ Settings → update the date → Save & Refresh**
- The entire dashboard recalculates forward from that date

### Body stats — real, estimated, or logged by hand
The Today tab always shows a number for sleep, energy, physical, and mental scores:
- **Real** — today's actual value, from a CSV upload or manual entry for today
- **Estimated** (shown with `~` in italics) — averaged from your last 7 days of history when today has no data yet
- **Baseline** — a starting default if you have no history at all yet

Open **✎ Log today's numbers** under the rings on the Today tab to type in real values any time, without needing a CSV export.

### Optional: Samsung Health data
Export CSVs from the Samsung Health app and upload in Settings for sleep, energy, physical, and stress scores. Uploads merge into your history day-by-day rather than replacing it, so estimates get better over time.

### Optional: ClickUp sync
The primary workflow for time-blocking is **Google Calendar** — use the Calendar tab to see your phase-matched week, then block time yourself. ClickUp sync is an optional add-on for teams already using ClickUp: paste your API token in the **🗓️ Calendar** tab to push the week's sessions directly into your task list.

---

## Deployment

`index.html` + `app.js`, config-driven — no build step, no backend.

**Vercel (current setup):**
Connect the `MoonCycle` GitHub repo to Vercel. Every push auto-deploys. `index.html` is served from the repo root, so no rewrite rules are needed.

**GitHub Pages:**
Repo → Settings → Pages → Deploy from branch → main → / (root)

### Versions

- **v2 (current)** — Lunarly ✦ Rhythm Studio. Config-driven, multi-archetype: `index.html` + `app.js` + `config-<id>.json`.
- **v1 (legacy)** — Miss Behaves Cycle Planner. Single-file, personal, hardcoded to one person. Kept for reference at [legacy/miss-behaves-cycle-planner.html](legacy/miss-behaves-cycle-planner.html).

---

## Replicating This for Someone Else

This app is config-driven: each person's personalization lives in its own `config-<id>.json` file (e.g. `config-demo-urban-athlete.json`), loaded at runtime by `app.js`. The whole point is that it's *personal* — not generic — but you no longer need to touch app code to adapt it for a friend.

**Example configs / archetypes** (the only ones tracked and public — real personal configs stay local, see below):

- **Archetype 1 — Urban athlete, natural cycle** (`config-demo-urban-athlete.json`): menstrual-phase tracking, strength training, hormone curve chart, IF fasting guide, Samsung Health CSV integration. The public Vercel demo loads this by default.
- **Archetype 2 — Menopause energy planner** (`config-menopausal-archetype.json`): energy-state model (high/moderate/low day) instead of cycle-day math, symptom log (hot flash, joint stiffness, brain fog), bone-density-forward activity library, hormone chart disabled, medication log enabled. A generic, Western/omnivore baseline — clone it to build a more personalized version (cultural food guide, specific symptom notes, etc.) for someone in your life.

**Note on perimenopause and hormonal BC:** These are on the roadmap but not yet modeled. Perimenopause involves irregular cycles that don't fit cleanly into either the menstrual-phase or the menopausal energy model — a dedicated transition config is planned. For hormonal birth control, the energy-state model (treat it like the menopausal config) is the most honest current approach.

More archetypes in development. If you want a custom config built and deployed for your specific routine — different training style, dietary restrictions, cultural context, life stage, or language — reach out. Paid custom configs and private Vercel deployments available on request.

Each archetype can define its own:
- **Cycle model** — standard menstrual-phase tracking, or an energy-state model (for menopause/perimenopause/hormonal BC) that doesn't depend on cycle day
- **Primary movement & intellectual practice** — suggested practices and per-phase guidance (`primaryMovementByPhase` / `primaryIntellectualByPhase`: recommended?, intensity/load, note) that drive the Calendar tab's weekly plan
- **Workouts** — phase-matched or energy-matched AM/PM sessions and activity library (background detail behind the primary-practice guidance)
- **Food guide** — what to lean into / ease up on, per phase or energy state
- **Needs & notes** — the Today's Guidance categories (movement/recovery/mindset) and the personal pep-talk copy
- **Branding** — app name, tagline, logo, colors, fonts

**To create your own version:**
1. Copy `config-demo-urban-athlete.json` to `config-<yourname>.json` and customize it locally — set your own cycle defaults, location, primary practice suggestions/phase rules, food guide, and needs/notes
2. `config-<yourname>.json` is gitignored by default (see `.gitignore`'s `config-*.json` rule) so it won't get committed — only the maintained example configs above are tracked. This is deliberate: real personal configs (real training details, real integrations, anything identifying) stay on your machine, never on GitHub or the deployed site
3. Swap in your logo image and reference it from the config
4. If you do want to deploy your own config publicly, add it explicitly (`git add -f`), add your config id to `window.AVAILABLE_CONFIGS` in `index.html`, then load the app with `?config=<yourname>` (falls back to the last-used config saved in `localStorage`, or `demo-urban-athlete` if none)
5. Deploy to Vercel under a new project name so each person gets their own URL

**Personal configs stay local.** The maintainer's own real config (real training specifics, weather location, integration IDs) is intentionally not tracked or published — only the sanitized example configs above ship on GitHub and Vercel. If you're running Lunarly for yourself, keep your real config the same way: local file, gitignored, never pushed.

**What stays the same for every person:**
- Hormone curve logic (based on standard endocrinology — accurate universally)
- Phase detection math
- Late cycle handling
- Samsung Health CSV parsing
- ClickUp API integration structure
- Insights / habits heatmap and correlations

Each config is a personal tool — not a generic app. That's what makes it actually useful.

---

## Privacy

**Your data never leaves your browser.** Samsung Health CSVs and Checkmarks habit CSVs are parsed entirely client-side — they are never uploaded, sent to a server, or stored anywhere outside your own browser's `localStorage`. The public demo at moon-cycle.vercel.app uses generated sample data, not any real person's health history.

Personal CSVs are never committed to this repo. Configs define structure and personalization (workout content, cycle defaults, food guide), not any actual health data. Period start dates and ClickUp API tokens live exclusively in your browser's `localStorage` — the repo contains neither.

---

## Roadmap

- **Google Calendar export** — one-click push of the week's phase-matched plan to Google Calendar (primary time-blocking workflow)
- **Additional archetype configs** — perimenopause + hormonal BC variant, postpartum recovery model, endurance athlete profile
- **Improved insights charts** — richer phase-correlation visualizations, rolling averages, and phase-over-phase comparisons
- **Health Connect integration** — live Samsung Health data via Android Health Connect API (replacing manual CSV exports)

---

## Tech

- Vanilla HTML/CSS/JS — no frameworks, no npm, no build step
- Chart.js loaded from CDN for habits charts
- Samsung Health CSV parsing built-in
- Weather via Open-Meteo API (free, no key needed)
- ClickUp API v2 for task sync
- Playfair Display via Google Fonts
