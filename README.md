# Lunarly ✦ Rhythm Studio

Cycle‑aware planning for women who train, perform, and manage high‑output routines. Lunarly reads your hormonal or energy state, tells you what it means for your body and mind *today*, and schedules your primary movement and intellectual practices on the days they'll actually land — instead of pretending every day of the month is the same day.

No app store, no subscription, no login. Your data never leaves your browser.

Live at: [moon-cycle.vercel.app](https://moon-cycle.vercel.app)

---

## What Lunarly actually is

Most fitness and productivity apps assume a flat, identical day-to-day baseline. They ask you to be equally strong, equally focused, and equally motivated on day 3 as day 23. That's not how a hormonal body — cycling *or* post-cycling — works.

Lunarly is a **config-driven planning engine** that sits on top of one core idea: your body runs on a rhythm (menstrual cycle, or post-menopause energy pattern), and almost everything — training capacity, focus, appetite, mood, sleep need — moves with it. Tell Lunarly where you are in that rhythm, and it reshapes the whole day around it: what to train, what to eat, whether to fast, when to push and when to rest, and which of your two personal practices (a movement one and a mental one) belongs on today specifically.

It is not one static app. It's one engine, wired to a `config-<archetype>.json` file that defines *whose* rhythm it's modeling. Swap the config and the entire app — copy, colors, logic, food guide, activity library — becomes a different person's dashboard. That's the whole architecture, and it's why this same codebase can be Sanyuja's personal tracker, a public demo, or eventually a client's paid, personalized build, without forking the code.

---

## How the public demo works

The live Vercel site is a **demo**, not the maintainer's real dashboard. Two things make that safe and make it useful at the same time:

1. **No real health data ships anywhere.** The two archetype configs on GitHub/Vercel (`config-demo-urban-athlete.json`, `config-menopausal-archetype.json`) contain zero real health history — no real period dates, no real biometric log, no personal integration tokens. My own real config (`config-sanyuja.json`) never leaves my machine — it's gitignored and only runs locally, in a separate `legacy/personal/` copy of the app that I open in Chrome for myself. The public repo and Vercel deploy literally cannot see it.

2. **The demo still needs to *feel* alive**, not empty, so a visitor immediately understands what the finished product looks like instead of staring at a blank dashboard. So each archetype config ships with a small, clearly-synthetic seed profile — a plausible primary movement practice, a plausible primary intellectual practice, ~2 weeks of generated (not real) health history with natural day-to-day variation, and a couple of demo habit logs. It's realistic *shape*, fabricated content. A small "ⓘ" on the phase card (hover it) tells you exactly that — generic phase/energy state shown, nothing personal behind it.

Everything you interact with in the demo — the phase engine, the hormone chart, the food guide, the Insights charts, the Settings — is the *real* logic. Nothing is mocked or faked at the interaction level. Only the starting data is synthetic.

---

## How the original (personal) app works

Before the multi-archetype rebuild, this was a single hardcoded file — `legacy/miss-behaves-cycle-planner.html` — built for one person (me), with everything from training style to hormone assumptions baked directly into the markup. It still exists, kept for reference as **v1**.

The **v2** rebuild (what's live now) pulled every personal assumption out of the code and into a config file, so the same `index.html` + `app.js` can run *anyone's* dashboard depending only on which config it loads. My own day-to-day use of the app didn't go away — it moved to a private, local-only copy (`legacy/personal/`, never committed to git) that's hardwired to always load my real config. Same app, same logic, same UI — just pointed at real data that stays on my machine instead of a demo config that ships publicly. That's the actual proof this architecture works: the "product" and the "founder's own daily tool" are the same codebase, running two different configs.

---

## Why two archetypes — and why they're built completely differently

The public demo ships two example archetypes on purpose, because they represent the two fundamentally different *models* Lunarly needs to support — not just two different personalities with the same underlying math reskinned.

### Archetype 1 — Urban Athlete (`config-demo-urban-athlete.json`), natural cycle

This is the **menstrual-phase model**. It exists for anyone still cycling naturally (not on hormonal birth control, not in menopause). The entire dashboard is driven off one number: days since your last period started. From that single input, Lunarly derives:

- Which of the four phases you're in — **menstrual, follicular, ovulatory, luteal**
- A modeled **hormone curve** (see below) for estrogen, progesterone, LH, and FSH across the whole cycle
- Phase-specific guidance for training intensity, food, fasting, and intellectual load

This only works because natural hormone cycling is *predictable* — estrogen and progesterone rise and fall on a roughly repeatable ~28-day rhythm, so day-of-cycle is a genuinely useful predictor of how you'll feel. That predictability is the entire reason phase-based planning is possible for this group.

### Archetype 2 — Menopause / CycleWise (`config-menopausal-archetype.json`), energy model

This is deliberately **not** a menstrual-phase model, because for someone postmenopausal, day-of-cycle is meaningless — there is no cycle to count days from. Modeling this group with fake cycle-day math would just be wrong, not simplified.

So this archetype runs a completely different engine: the **energy-state model**. Instead of a computed phase, it asks a daily question — *how's your energy right now: high, moderate, or low?* — logged directly by the user each day, plus an optional symptom log (hot flashes, joint stiffness, brain fog, poor sleep, low iron/fatigue, etc.). Every recommendation — movement, food, intellectual load, rest — is keyed off that self-reported state instead of a calendar calculation. The hormone curve chart is disabled entirely for this archetype, because there's no cyclical hormone signal left to chart.

The demo persona for this archetype is a woman in her late 50s living in Pune — vegetarian, low baseline physical activity, singing (riyaz) as her primary intellectual practice, iron-forward nutrition guidance, and a bone-density-forward movement library (walking, yoga, light strength work) instead of a strength-training-forward one. It's meant to show that "menopausal" doesn't mean one generic Western template — the same energy-state *engine* can carry a very different lived context.

**Why this split matters architecturally:** `PhaseEngine.current` dispatches on `config.cycle.type` at runtime — `'menstrual'` walks the phase-math path, anything else walks the energy-state path. Every downstream module (Today's Guidance, the food guide, the Insights habit-correlation charts, the Settings fields) branches the same way. Nothing about menopause is a variant of the menstrual model with different labels — it's a structurally different data model, because pretending otherwise would produce nonsense guidance (this is exactly the bug that got fixed recently: the Insights habit charts were defaulting to menstrual-phase correlation logic even for energy-state archetypes, which made zero sense without a period date).

**Not yet modeled (on purpose, not an oversight):** hormonal birth control and perimenopause both sit in an in-between zone — BC suppresses natural cycling, perimenopause is irregular and not yet predictable enough for phase math. Today, hormonal-BC users are pointed toward using the energy-state model instead of the phase model, since it doesn't depend on a rhythm that no longer exists in a predictable form for them. Dedicated configs for both are on the roadmap.

---

## Why phase-specific fasting, rest, and food actually matter

This is the core bet the whole app is built on: your capacity for stress isn't flat across the month, so the *inputs* you give your body — food, fasting, training load, rest — shouldn't be flat either.

- **Menstrual phase** — estrogen and progesterone are both at their lowest. This is a legitimately lower-capacity window: intermittent fasting protocols get relaxed, training intensity drops to light/recovery work, food guidance leans iron-replenishing and warming, and the intellectual-load guidance explicitly calls this a "low-stakes" day.
- **Follicular phase** — estrogen is climbing. This is a genuine building window — the app recommends progressing training load and starting new projects/learning here, because rising estrogen supports both physical recovery and cognitive flexibility.
- **Ovulatory phase** — estrogen and LH both peak. Highest physical output and sharpest, most social thinking of the whole cycle. The app pushes hardest training and collaborative/performance-heavy intellectual work into this window specifically because it's wasted if scheduled elsewhere.
- **Luteal phase** — progesterone dominates, then falls. Fasting windows tighten again as blood sugar sensitivity shifts, food guidance shifts toward magnesium/complex carbs to manage the progesterone drop, training dials back from impact to consistency, and intellectual guidance shifts toward detail-oriented, wrapping-up-loose-threads work rather than starting new things.

For the energy-state model, the same principle holds, it's just keyed off logged energy instead of phase: a **low-energy day** triggers a downgrade note on Today's Guidance, lighter movement suggestions, and iron/rest-forward food guidance; a **high-energy day** is where the heavier movement and the primary intellectual practice get scheduled.

The point isn't "fasting is good" or "rest is good" in the abstract — it's that the *same* action (a hard training session, a 16-hour fast, a big creative push) is a great idea on one day and a bad idea four days later, for a hormonally-driven, non-optional reason. Lunarly's whole reason to exist is making that visible day-to-day instead of leaving it to guesswork.

---

## What each part of the dashboard is actually doing

| Tab | What it does |
|-----|-------------|
| **Today** | The phase/energy banner, live-modeled hormone curve (natural-cycle archetypes only) with today's estrogen/progesterone/LH/FSH levels and a plain-English explanation of what they mean for how you feel right now, body stat rings (sleep/energy/physical/mental — real if logged, estimated from recent history otherwise), local weather, your Primary Movement + Primary Intellectual Practice cards with today's recommendation, a low-energy warning card when your logged energy drops below threshold, and a "what your body needs today" summary |
| **My Cycle** / **Energy Log** | Natural-cycle: visual cycle wheel and full phase timeline with dates. Energy-state: daily energy check-in (high/moderate/low) and symptom log — these check-ins are what feed the Today tab's low-energy note and the Insights energy charts |
| **Nourish** | Food guide by phase or energy state — what to lean into, what to reduce, fasting guidance (natural-cycle) or diet-preference-aware guidance (energy-state) |
| **Insights** | Upload a habits CSV to see streaks, a heatmap shaded by phase (natural-cycle) or by logged energy state (energy-state), a phase/energy-correlation chart, and an "Energy & Sleep Patterns" card built from your logged history |
| **Calendar** | This week's phase- or energy-matched plan — sessions for your primary movement and intellectual practices placed on their best-matched days, not every day — plus a one-click push to ClickUp and a Google Calendar preview |
| **Settings** | Cycle basics (natural-cycle) or energy pattern + top symptoms + diet preferences (energy-state), primary movement & intellectual practice definitions, fasting/diet toggles, wearable CSV uploads |

### Primary Movement & Primary Intellectual Practice

Instead of assuming everyone trains and thinks the same way, you tell Lunarly **one** movement practice (pole dance, strength training, running, walking, whatever) and **one** intellectual/creative practice (streaming, deep work, writing, singing/riyaz, whatever) that actually matter to you, plus how many sessions a week you want of each. Lunarly maps both onto your phase or energy-state model and decides which days are the best match — that's what drives the Calendar tab's weekly plan and the Today tab's recommendation card. This is deliberately not a generic workout library; it's built around the idea that most people have one or two practices that actually matter to their life, and the planning should orbit those specifically.

### Today's Guidance

A synthesized daily summary — movement, recovery, and mindset notes for exactly where you are today — built from the config's `needs` data per phase/energy-state, plus your live body-stat rings and (for energy-state archetypes) your logged symptoms. It's the "so what do I actually do today" answer, in one place, instead of making you cross-reference the hormone chart, the food guide, and the movement card yourself.

---

## Wearables today, and the plan for client builds

Right now, wearable integration works through **CSV upload** — the config declares a `wearables.provider` (currently `samsung-health`) and a `csvTypes` map that defines exactly which exported file pattern maps to which score (sleep, energy/vitality, stress, cycle flow), field by field. Upload a Samsung Health export in Settings and it merges into your day-by-day history without overwriting anything.

That mapping is deliberately data-driven, not hardcoded to Samsung specifically — the parsing logic reads field names and file patterns straight from the config. Which means adding a new wearable source (Apple Health, Fitbit, Oura, Whoop, Garmin) is a matter of writing a new `csvTypes` block for that provider's export format, not rewriting app logic. That's the plan for client builds: the same dashboard, the same phase/energy engine, the same UI — pointed at whichever wearable a specific client actually uses, via their config. One product, swappable data source per person.

Manual CSV export is the bridge today; a live Health Connect / native API integration (pulling data automatically instead of requiring an export-and-upload step) is on the roadmap once there's a paid build that needs it.

---

## The flow behind the build, end to end

1. **A person picks or gets assigned an archetype** — natural-cycle or energy-state, based on where they actually are (still cycling vs. postmenopause/BC-suppressed).
2. **A config file (`config-<id>.json`) is built for them** — cycle model type, primary movement/intellectual suggestions and per-phase or per-energy-state guidance, food guide, activity library, wearable provider mapping, branding.
3. **`app.js` loads that config at runtime** and builds the entire dashboard from it — nothing about the person's specifics lives in code.
4. **`PhaseEngine`** figures out where they are today — either computed cycle-day math (menstrual) or their last logged check-in (energy-state) — and every module downstream (Today's Guidance, food guide, Insights correlations, Calendar plan) reads from that single source of truth.
5. **Daily use** — body stats, energy/symptom check-ins, and (optionally) wearable CSV uploads keep building a real per-day history, which feeds back into estimates, Insights charts, and the low-energy warning over time.
6. **The weekly plan** (Calendar tab) reads all of the above and places the primary practices on their best-matched days, with a one-click ClickUp push and a Google Calendar preview available.

This is why building a new archetype (a new client, a new life stage, a new cultural context) is a config-writing exercise, not a code-forking one — and why the same codebase can simultaneously be a public demo, my own private daily tool, and eventually a paid, personalized build for someone else, without those three ever touching each other's data.

---

## How to Use It

### First-time setup
1. Open the app in Chrome
2. Go to **⚙️ Settings**
3. Natural-cycle: set **First Day of Last Bleed**, average **Cycle Length**, and **Period Duration**. Energy-state: set your **Energy Pattern** and top symptoms.
4. Hit **Save & Refresh** — everything recalculates

### Each new cycle (natural-cycle archetypes)
Go to **⚙️ Settings → update the date → Save & Refresh**. The entire dashboard recalculates forward from that date.

### Body stats — real, estimated, or logged by hand
The Today tab always shows a number for sleep, energy, physical, and mental scores:
- **Real** — today's actual value, from a CSV upload or manual entry for today
- **Estimated** (shown with `~` in italics) — averaged from your last 7 days of history when today has no data yet
- **Baseline** — a starting default if you have no history at all yet

Open **✎ Log today's numbers** under the rings on the Today tab to type in real values any time, without needing a CSV export.

### Optional: wearable data
Export a CSV from your wearable app (Samsung Health today) and upload in Settings for sleep, energy, physical, and stress scores. Uploads merge into your history day-by-day rather than replacing it, so estimates get better over time.

### Optional: ClickUp sync + Google Calendar preview
Use the Calendar tab to see your phase- or energy-matched week. Paste a ClickUp API token to push the week's sessions directly into your task list, or hit **Push this week to Google Calendar** to preview what a synced week would look like.

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

This app is config-driven: each person's personalization lives in its own `config-<id>.json` file, loaded at runtime by `app.js`. The whole point is that it's *personal* — not generic — but you no longer need to touch app code to adapt it for someone new.

**Example configs / archetypes** (the only ones tracked and public — real personal configs stay local, see below):

- **Archetype 1 — Urban athlete, natural cycle** (`config-demo-urban-athlete.json`): menstrual-phase tracking, strength training, hormone curve chart, IF fasting guide, wearable CSV integration. The public Vercel demo loads this by default.
- **Archetype 2 — Menopause energy planner** (`config-menopausal-archetype.json`): energy-state model (high/moderate/low day) instead of cycle-day math, symptom log (hot flash, joint stiffness, brain fog, low iron/fatigue), bone-density-forward activity library, hormone chart disabled, medication log enabled, vegetarian/Pune-context food and movement guidance as a worked example of how far a single archetype can be personalized.

**Note on perimenopause and hormonal BC:** These are on the roadmap but not yet modeled. Perimenopause involves irregular cycles that don't fit cleanly into either the menstrual-phase or the energy-state model — a dedicated transition config is planned. For hormonal birth control, the energy-state model (treat it like the menopausal config) is the most honest current approach.

More archetypes in development. If you want a custom config built and deployed for your specific routine — different training style, dietary restrictions, cultural context, life stage, wearable device, or language — reach out. Paid custom configs and private Vercel deployments available on request.

Each archetype can define its own:
- **Cycle model** — standard menstrual-phase tracking, or an energy-state model (for menopause/perimenopause/hormonal BC) that doesn't depend on cycle day
- **Primary movement & intellectual practice** — suggested practices and per-phase/per-state guidance that drive the Calendar tab's weekly plan
- **Workouts** — phase-matched or energy-matched activity library (background detail behind the primary-practice guidance)
- **Food guide** — what to lean into / ease up on, per phase or energy state, including cultural/dietary pattern
- **Wearable mapping** — which provider's CSV export maps to which score, field by field
- **Needs & notes** — the Today's Guidance categories (movement/recovery/mindset) and the personal pep-talk copy
- **Branding** — app name, tagline, logo, colors, fonts

**To create your own version:**
1. Copy `config-demo-urban-athlete.json` (or `config-menopausal-archetype.json`, whichever model fits) to `config-<yourname>.json` and customize it locally — cycle model, location, primary practice suggestions/phase rules, food guide, wearable mapping, needs/notes
2. `config-<yourname>.json` is gitignored by default (see `.gitignore`'s `config-*.json` rule) so it won't get committed — only the maintained example configs above are tracked. Real personal configs (real training details, real integrations, anything identifying) stay on your machine, never on GitHub or the deployed site
3. Swap in your logo image and reference it from the config
4. If you do want to deploy your own config publicly, add it explicitly (`git add -f`), add your config id to `window.AVAILABLE_CONFIGS` in `index.html`, then load the app with `?config=<yourname>` (falls back to the last-used config saved in `localStorage`, or `demo-urban-athlete` if none)
5. Deploy to Vercel under a new project name so each person gets their own URL

**What stays the same for every person:**
- Hormone curve math (based on standard endocrinology — accurate universally for natural-cycle archetypes)
- Phase detection and energy-state dispatch logic
- Late cycle handling
- Wearable CSV parsing engine (provider-mapping is config-driven)
- ClickUp API integration structure
- Insights / habits heatmap and phase/energy correlation logic

Each config is a personal tool — not a generic app. That's what makes it actually useful.

---

## Privacy

**Your data never leaves your browser.** Wearable CSVs and habits CSVs are parsed entirely client-side — they are never uploaded, sent to a server, or stored anywhere outside your own browser's `localStorage`. The public demo at moon-cycle.vercel.app uses generated sample data, not any real person's health history.

Personal CSVs are never committed to this repo. Configs define structure and personalization (workout content, cycle defaults, food guide), not any actual health data. Period start dates, energy check-ins, and API tokens live exclusively in your browser's `localStorage` — the repo contains neither.

---

## Roadmap

- **Live Google Calendar sync** — the Calendar tab currently previews what a synced week would look like; wiring up the real push is next for paid/custom builds
- **Additional archetype configs** — perimenopause + hormonal BC variant, postpartum recovery model, endurance athlete profile
- **More wearable providers** — Apple Health, Fitbit, Oura, and Whoop mappings alongside the existing Samsung Health one, using the same config-driven `csvTypes` structure
- **Live wearable integration** — pulling data automatically via native APIs (Health Connect, HealthKit) instead of manual CSV export/upload
- **Improved insights charts** — richer phase/energy-correlation visualizations, rolling averages, and period-over-period comparisons

---

## Tech

- Vanilla HTML/CSS/JS — no frameworks, no npm, no build step
- Chart.js loaded from CDN for habits charts; hand-rolled canvas rendering for the hormone curve
- Config-driven wearable CSV parsing (Samsung Health today, provider-agnostic by design)
- Weather via Open-Meteo API (free, no key needed)
- ClickUp API v2 for task sync
- Playfair Display via Google Fonts
