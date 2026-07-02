# Lunarly

Cycle‑aware planning for women who train, perform, and manage high‑output routines. Lunarly reads your hormonal or energy state, tells you what it means for your body and mind *today*, and schedules your primary movement and intellectual practices on the days they'll actually land — instead of treating every day of the month the same.

No app store, no subscription, no login. Your data never leaves your browser.

**At a glance**
- **Who it's for:** natural-cycle women planning training/work/fasting around their menstrual phase; menopausal women who want energy-aware planning instead of period tracking
- **What it does:** reads your phase or logged energy state and reshapes training, food, fasting, and focus guidance around it, day by day
- **Try it:** live demo at [moon-cycle.vercel.app](https://moon-cycle.vercel.app) — synthetic data, real logic
- **Build your own:** config-driven — clone an archetype config and plug in your details, no code changes needed
- **Custom builds:** paid, personalized configs and private deployments available — see [Replicating This for Someone Else](#replicating-this-for-someone-else)

---

## What Lunarly actually is

Most fitness and productivity apps assume a flat, identical day-to-day baseline — equally strong, equally focused, equally motivated on day 3 as day 23. That's not how a hormonal body, cycling or post-cycling, works.

Lunarly is a **config-driven planning engine** built on one idea: your body runs on a rhythm (menstrual cycle, or post-menopause energy pattern), and training capacity, focus, appetite, mood, and sleep need all move with it. Tell it where you are in that rhythm, and it reshapes the day around it — what to train, what to eat, whether to fast, when to push and when to rest, and which of your two personal practices (a movement one and a mental one) belongs on today specifically.

It's one engine, wired to a `config-<archetype>.json` file that defines whose rhythm it's modeling. Swap the config and the app — copy, colors, logic, food guide, activity library — becomes a different person's dashboard. The same codebase runs my personal tracker, this public demo, and (eventually) a client's paid build, without forking any code.

---

## How the public demo works

The live Vercel site is a demo, not my real dashboard.

1. **No real health data ships.** The two public archetype configs (`config-demo-urban-athlete.json`, `config-menopausal-archetype.json`) contain no real period dates, biometric history, or integration tokens. My real config stays local and gitignored, running only in a private copy of the app on my machine.
2. **The demo still needs to feel alive.** Each archetype ships a small seed profile — a primary movement and intellectual practice, ~2 weeks of generated health history, and a few habit logs — so a visitor sees a populated dashboard instead of an empty one. A "ⓘ" on the phase card (hover it) flags this as generic, synthetic data.

Everything else — the phase engine, hormone chart, food guide, Insights charts, Settings — is the real logic, just running on generated starting data instead of a mockup.

---

## How the original (personal) app works

Before the multi-archetype rebuild, this was a single hardcoded file — `legacy/miss-behaves-cycle-planner.html` — built for one person (me), with training style and hormone assumptions baked directly into the markup. It's kept for reference as **v1**.

The **v2** rebuild (what's live now) pulled every personal assumption out of the code and into a config file, so the same `index.html` + `app.js` can run anyone's dashboard depending only on which config it loads. My own day-to-day use moved to a private, local-only copy (`legacy/personal/`, never committed to git) hardwired to load my real config — same app, same logic, same UI, just pointed at data that stays on my machine instead of a config that ships publicly.

---

## Why two archetypes — and why they're built completely differently

The public demo ships two example archetypes because they represent two fundamentally different *models* Lunarly supports — not two personalities reskinned on the same math.

### Archetype 1 — Urban Athlete, natural cycle
`config-demo-urban-athlete.json`

- **Who it's for:** anyone still cycling naturally — not on hormonal birth control, not in menopause
- **Model:** menstrual-phase — days since your last period start drives everything
- **Includes:** hormone curve chart, phase timeline, IF fasting guide, strength-training-forward activity library

From one input — day of cycle — Lunarly derives which of the four phases you're in (menstrual, follicular, ovulatory, luteal) and a modeled hormone curve for estrogen, progesterone, LH, and FSH across the whole cycle. From there it generates phase-specific guidance for training intensity, food, fasting, and intellectual load. This works because natural hormone cycling is predictable on a roughly repeatable rhythm — that predictability is the whole reason phase-based planning makes sense for this group.

### Archetype 2 — Menopause / CycleWise, energy model
`config-menopausal-archetype.json`

- **Who it's for:** postmenopausal women, or anyone without a predictable cycle to count from
- **Model:** energy-state — a daily self-reported check-in (high/moderate/low) plus an optional symptom log, not a calendar calculation
- **Disabled:** the hormone curve chart — there's no cyclical hormone signal left to chart

Modeling this group with cycle-day math would be wrong, not just simplified, since there's no cycle to count from. Every recommendation — movement, food, intellectual load, rest — is keyed off the logged energy state instead.

The demo persona is a woman in her late 50s in Pune. She's vegetarian with a modest baseline activity level, and singing (riyaz) is her primary intellectual practice. Food guidance leans iron-forward, and the activity library leans bone-density-forward (walking, yoga, light strength work) rather than strength-training-forward. It's meant to show the energy-state *engine* can carry very different lived contexts, not just one generic template.

**Why the split is architectural** *(for developers — non-technical readers can skip this one):* `PhaseEngine.current` dispatches on `config.cycle.type` at runtime, and every downstream module — Today's Guidance, food guide, Insights correlations, Settings — branches the same way. Menopause isn't a variant of the menstrual model with different labels; it's a structurally different data model.

**Not yet modeled:** hormonal birth control and perimenopause both sit in an in-between zone — BC suppresses natural cycling, perimenopause is irregular and not yet predictable enough for phase math. Today, hormonal-BC users are pointed toward the energy-state model instead. Dedicated configs for both are on the roadmap.

---

## Why phase-specific fasting, rest, and food matter

Your capacity for stress isn't flat across the month, so food, fasting, training load, and rest shouldn't be flat either — the same action can be a great idea on one day and a bad idea four days later.

- **Menstrual phase** — estrogen and progesterone are both at their lowest. A legitimately lower-capacity window: fasting protocols relax, training drops to light/recovery work, food leans iron-replenishing and warming, and intellectual load is explicitly "low-stakes."
- **Follicular phase** — estrogen is climbing. A genuine building window — progress training load, start new projects or learning, since rising estrogen supports both physical recovery and cognitive flexibility.
- **Ovulatory phase** — estrogen and LH both peak. Highest physical output and sharpest, most social thinking of the whole cycle — hardest training and collaborative/performance-heavy work belong here specifically.
- **Luteal phase** — progesterone dominates, then falls. Fasting windows tighten again, food shifts toward magnesium/complex carbs to manage the progesterone drop, training dials back from impact to consistency, and intellectual focus shifts toward detail work and wrapping up loose threads.

The energy-state model follows the same principle, just keyed off logged energy instead of phase: a **low-energy day** triggers a downgrade note on Today's Guidance, lighter movement, and iron/rest-forward food; a **high-energy day** is where heavier movement and the primary intellectual practice get scheduled.

---

## What each part of the dashboard is actually doing

**Today** — Phase/energy banner and body stat rings.

- Hormone curve (natural-cycle only) with live estrogen/progesterone/LH/FSH levels and a plain-English "what this means for how you feel" note
- Sleep/energy/physical/mental rings — real if logged, estimated from recent history otherwise
- Local weather, a low-energy warning card, and a "what your body needs today" summary

**My Cycle / Energy Log** — Natural-cycle: cycle wheel and phase timeline. Energy-state: daily energy check-in and symptom log.

- These check-ins feed the Today tab's low-energy note and the Insights energy charts

**Nourish** — Food guide by phase or energy state.

- What to lean into, what to reduce, fasting guidance (natural-cycle) or diet-preference-aware guidance (energy-state)

**Insights** — Upload a habits CSV to see streaks and correlations.

- Heatmap shaded by phase or energy state, a phase/energy-correlation chart, and an Energy & Sleep Patterns card

**Calendar** — This week's phase- or energy-matched plan.

- Primary movement and intellectual sessions placed on their best-matched days, a one-click ClickUp push, and a Google Calendar preview (live sync is planned, not yet wired up)

**Settings** — Cycle basics, or energy pattern + top symptoms + diet preferences, depending on archetype.

- Primary movement & intellectual practice definitions, fasting/diet toggles, wearable CSV uploads

### Primary Movement & Primary Intellectual Practice

Instead of assuming everyone trains and thinks the same way, you tell Lunarly **one** movement practice (pole dance, strength training, running, walking, whatever) and **one** intellectual/creative practice (streaming, deep work, writing, singing/riyaz, whatever) that actually matter to you, plus sessions per week for each. Lunarly maps both onto your phase or energy-state model and decides which days are the best match — that drives the Calendar tab's weekly plan and the Today tab's recommendation card. It's not a generic workout library; it's built around the idea that most people have one or two practices that actually matter, and planning should orbit those specifically.

### Today's Guidance

A synthesized daily summary — movement, recovery, and mindset notes for exactly where you are today — built from the config's `needs` data per phase/energy-state, your live body-stat rings, and (for energy-state archetypes) your logged symptoms. It's the "so what do I actually do today" answer in one place, instead of cross-referencing the hormone chart, food guide, and movement card yourself.

---

## Wearables today, and the plan for client builds

Wearable integration currently works through **CSV upload** — the config declares a `wearables.provider` (currently `samsung-health`) and a `csvTypes` map defining exactly which exported file pattern maps to which score (sleep, energy/vitality, stress, cycle flow), field by field. Upload a Samsung Health export in Settings and it merges into your day-by-day history without overwriting anything.

That mapping is data-driven, not hardcoded to Samsung — the parsing logic reads field names and file patterns straight from the config. Adding a new wearable source (Apple Health, Fitbit, Oura, Whoop, Garmin) is a matter of writing a new `csvTypes` block for that provider's export format, not rewriting app logic. That's the plan for client builds: the same dashboard, the same phase/energy engine, the same UI — pointed at whichever wearable a specific client uses, via their config.

Manual CSV export is the bridge today; live native-API integration (pulling data automatically instead of export-and-upload) is on the roadmap for paid builds.

---

## The flow behind the build, end to end

1. **A person picks or gets assigned an archetype** — natural-cycle or energy-state, based on where they actually are (still cycling vs. postmenopause/BC-suppressed).
2. **A config file (`config-<id>.json`) is built for them** — cycle model type, primary movement/intellectual suggestions and per-phase or per-energy-state guidance, food guide, activity library, wearable provider mapping, branding.
3. **`app.js` loads that config at runtime** and builds the entire dashboard from it — nothing about the person's specifics lives in code.
4. **`PhaseEngine`** figures out where they are today — computed cycle-day math (menstrual) or their last logged check-in (energy-state) — and every module downstream (Today's Guidance, food guide, Insights correlations, Calendar plan) reads from that single source of truth.
5. **Daily use** — body stats, energy/symptom check-ins, and optional wearable CSV uploads build a real per-day history, which feeds estimates, Insights charts, and the low-energy warning over time.
6. **The weekly plan** (Calendar tab) reads all of the above and places the primary practices on their best-matched days, with a one-click ClickUp push and a Google Calendar preview.

Building a new archetype — a new client, life stage, or cultural context — is a config-writing exercise, not a code-forking one.

---

## How to Use It

### First-time setup
1. Open the app in Chrome
2. Go to **⚙️ Settings**
3. Set your starting point:
   - **Natural-cycle:** First Day of Last Bleed, average Cycle Length, Period Duration
   - **Energy-state:** Energy Pattern and top symptoms
4. Hit **Save & Refresh** — everything recalculates

### Each new cycle
- **Natural-cycle:** Settings → update the date → Save & Refresh. The dashboard recalculates forward from that date.
- **Energy-state:** no reset needed — just keep logging your daily energy check-in.

### Body stats — real, estimated, or logged by hand
The Today tab always shows a number for sleep, energy, physical, and mental scores:
- **Real** — today's actual value, from a CSV upload or manual entry for today
- **Estimated** (shown with `~` in italics) — averaged from your last 7 days of history when today has no data yet
- **Baseline** — a starting default if you have no history at all yet

Open **✎ Log today's numbers** under the rings on the Today tab to type in real values any time, without needing a CSV export.

### Optional: wearable data
Export a CSV from your wearable app (Samsung Health today) and upload in Settings for sleep, energy, physical, and stress scores. Uploads merge into your history day-by-day rather than replacing it, so estimates get better over time.

### Optional: ClickUp sync + Google Calendar preview
Use the Calendar tab to see your phase- or energy-matched week. Paste a ClickUp API token to push the week's sessions directly into your task list, or hit **Push this week to Google Calendar** to preview what a synced week would look like (ClickUp requires a token to actually push; Google Calendar is preview-only for now).

---

## Deployment

`index.html` + `app.js`, config-driven — no build step, no backend.

**Vercel (current setup):**
Connect the `MoonCycle` GitHub repo to Vercel. Every push auto-deploys. `index.html` is served from the repo root, so no rewrite rules are needed.

**GitHub Pages:**
Repo → Settings → Pages → Deploy from branch → main → / (root)

### Versions

- **v2 (current)** — Lunarly ✦ Rhythm Studio / CycleWise. Config-driven, multi-archetype: `index.html` + `app.js` + `config-<id>.json`.
- **v1 (legacy)** — Miss Behaves Cycle Planner. Single-file, personal, hardcoded to one person. Kept for reference at [legacy/miss-behaves-cycle-planner.html](legacy/miss-behaves-cycle-planner.html).

---

## Replicating This for Someone Else

Want a custom config built for your own routine — different training style, dietary restrictions, cultural context, life stage, or wearable device? **Paid custom configs and private Vercel deployments are available on request** — reach out.

This app is config-driven: each person's personalization lives in its own `config-<id>.json` file, loaded at runtime by `app.js`. You don't need to touch app code to adapt it for someone new.

**Example configs / archetypes** (the only ones tracked and public — real personal configs stay local):

- **Archetype 1 — Urban athlete, natural cycle** (`config-demo-urban-athlete.json`): menstrual-phase tracking, strength training, hormone curve chart, IF fasting guide, wearable CSV integration. The public Vercel demo loads this by default.
- **Archetype 2 — Menopause energy planner** (`config-menopausal-archetype.json`): energy-state model, symptom log, bone-density-forward activity library, hormone chart disabled, medication log enabled, vegetarian/Pune-context food and movement guidance as a worked example of how far one archetype can be personalized.

**Note on perimenopause and hormonal BC:** on the roadmap, not yet modeled. Perimenopause's irregular cycles don't fit cleanly into either model — a dedicated transition config is planned. For hormonal birth control, the energy-state model is the most honest current approach.

Each archetype can define its own:
- **Cycle model** — menstrual-phase, or energy-state (menopause/perimenopause/hormonal BC)
- **Primary movement & intellectual practice** — suggested practices and per-phase/per-state guidance
- **Workouts** — phase- or energy-matched activity library
- **Food guide** — what to lean into / ease up on, including cultural/dietary pattern
- **Wearable mapping** — which provider's CSV export maps to which score, field by field
- **Needs & notes** — Today's Guidance categories and pep-talk copy
- **Branding** — app name, tagline, logo, colors, fonts

If you're not a developer, you can stop reading here — the rest of this section is the technical fork flow.

**For developers wanting to fork this themselves**, the technical flow is:
1. Copy `config-demo-urban-athlete.json` (or `config-menopausal-archetype.json`, whichever model fits) to `config-<yourname>.json` and customize it locally
2. `config-<yourname>.json` is gitignored by default (`.gitignore`'s `config-*.json` rule) — only the maintained example configs are tracked, so anything identifying stays off GitHub
3. Swap in your logo image and reference it from the config
4. To deploy your own config publicly, add it explicitly (`git add -f`), add your config id to `window.AVAILABLE_CONFIGS` in `index.html`, then load with `?config=<yourname>` (falls back to the last-used config in `localStorage`, or `demo-urban-athlete`)
5. Deploy to Vercel under a new project name so each person gets their own URL

**What stays the same for every person:**
- Hormone curve math (standard endocrinology — accurate universally for natural-cycle archetypes)
- Phase detection and energy-state dispatch logic
- Late cycle handling
- Wearable CSV parsing engine (provider-mapping is config-driven)
- ClickUp API integration structure
- Insights / habits heatmap and phase/energy correlation logic

---

## Privacy

Wearable and habits CSVs are parsed entirely client-side and never uploaded anywhere. Period dates, energy check-ins, and API tokens live only in your browser's `localStorage`. The only configs tracked in this repo are the two demo archetypes — real personal configs are gitignored and stay local.

---

## Roadmap

**Archetypes**
- Perimenopause and hormonal birth control configs
- Postpartum recovery and endurance-athlete profiles

**Integrations**
- Live Google Calendar sync (Calendar tab currently previews only)
- More wearable providers — Apple Health, Fitbit, Oura, Whoop — via the same config-driven `csvTypes` structure
- Live wearable data via native APIs (Health Connect, HealthKit) instead of manual CSV export

**Insights**
- Richer phase/energy-correlation visualizations, rolling averages, and period-over-period comparisons

---

## Tech

- Vanilla HTML/CSS/JS — no frameworks, no npm, no build step
- Chart.js loaded from CDN for habits charts; hand-rolled canvas rendering for the hormone curve
- Config-driven wearable CSV parsing (Samsung Health today, provider-agnostic by design)
- Weather via Open-Meteo API (free, no key needed)
- ClickUp API v2 for task sync
- Playfair Display via Google Fonts
