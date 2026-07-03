/**
 * CycleApp v2 — Config-driven engine
 * ====================================
 * Architecture:
 *   MoonCycleApp          — orchestrator, owns config + state
 *   PhaseEngine           — computes current phase or energy state
 *   BaseModule            — abstract base for all tab modules
 *   [Module subclasses]   — one per tab, renders into #module-container
 *
 * To add a new archetype: add a config JSON file. No JS changes needed.
 * To add a new module:    subclass BaseModule, register in MODULE_REGISTRY.
 */

'use strict';

// ─── CONFIG LOADER ────────────────────────────────────────────────────────────

async function loadConfig(id) {
  const res = await fetch(`config-${id}.json`);
  if (!res.ok) throw new Error(`Config "${id}" not found (${res.status})`);
  return res.json();
}

// ─── STATE MANAGER ────────────────────────────────────────────────────────────

class StateManager {
  constructor(configId) {
    this._key = `mcapp_v2_${configId}`;
    this._defaults = {
      periodStart: null,
      cycleLength: 35,
      periodDuration: 5,
      cycleFocus: null,
      primaryMovement: null,     // { name, description, sessionsPerWeek, preferredTime } — set in Settings
      primaryIntellectual: null, // { name, description, sessionsPerWeek, preferredTime } — set in Settings
      healthData: { sleepScore: null, physicalRecovery: null, mentalRecovery: null, energyScore: null, stressScore: null, lastUpdated: null, history: [] },
      todayCheckin: null,       // { date, energyState, symptoms[] } — used for menopausal model
      fastClock: null,          // { startMs, goalHours }
      weather: null,
      habitsData: null,
      fastingEnabled: true,     // natural-cycle: opt out of fasting guidance entirely
      dietType: null,           // natural-cycle: 'omnivore' | 'vegetarian' | 'vegan'
      energyPattern: null,      // menopausal: 'morning' | 'afternoon' | 'evening' — when energy is usually best
      topSymptoms: [],          // menopausal: up to 3 symptoms the user says matter most
      dietPreferences: []       // menopausal: e.g. ['High protein', 'Low sugar']
    };
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this._key) || '{}');
      const merged = Object.assign({}, this._defaults, saved);
      merged.healthData = Object.assign({}, this._defaults.healthData, saved.healthData);
      if (!Array.isArray(merged.healthData.history)) merged.healthData.history = [];
      return merged;
    } catch { return { ...this._defaults }; }
  }

  save(state) {
    try {
      const { clickupToken, ...safe } = state; // never persist API tokens
      localStorage.setItem(this._key, JSON.stringify(safe));
    } catch(e) { console.warn('State save failed:', e); }
  }

  clear() {
    localStorage.removeItem(this._key);
  }
}

// ─── PHASE ENGINE ─────────────────────────────────────────────────────────────
// Handles both cycle types: "menstrual" and "menopausal" (energy-based).
// Returns a unified phase object consumed by all modules.

class PhaseEngine {
  constructor(config, state) {
    this.config = config;
    this.state = state;
  }

  /**
   * Returns the current phase/energy state object.
   * Shape: { key, label, shortLabel, icon, color, desc, needs, note, dayOfCycle?, isLate? }
   */
  get current() {
    const cycleType = this.config.cycle.type;
    if (cycleType === 'menstrual') return this._menstrualPhase();
    if (cycleType === 'menopausal' || cycleType === 'perimenopausal') return this._energyState();
    if (cycleType === 'hormonal-bc') return this._energyState(); // BC suppresses natural phases
    return this._energyState(); // energy-only fallback
  }

  /** Compute cycle day (1-based, no wrapping) from period start date. */
  get cycleDay() {
    if (!this.state.periodStart) return null;
    const start = new Date(this.state.periodStart);
    const today = new Date();
    start.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return Math.floor((today - start) / 86_400_000) + 1;
  }

  get isLate() {
    const cd = this.cycleDay;
    return cd !== null && cd > (this.state.cycleLength || this.config.cycle.defaultLength);
  }

  _menstrualPhase() {
    const cd = this.cycleDay;
    if (!cd) return this._noDataState();

    const cl = this.state.cycleLength || this.config.cycle.defaultLength;
    const pd = this.state.periodDuration || this.config.cycle.periodDuration;
    const phases = this.config.cycle.phases;

    // Resolve dynamic day ranges
    const dayEnd = (ph) => {
      if (ph.daysEndFn === 'periodDuration') return pd;
      if (ph.daysEndFn === 'cycleLength') return cl;
      if (ph.daysEndFraction) return Math.round(cl * ph.daysEndFraction);
      if (ph.daysEnd) return ph.daysEnd;
      return cl;
    };
    const dayStart = (ph) => {
      if (ph.daysStartFn === 'periodDuration+1') return pd + 1;
      if (ph.daysStartFraction) return Math.round(cl * ph.daysStartFraction) + 1;
      return ph.daysStart || 1;
    };

    // Late period
    if (cd > cl) {
      const daysLate = cd - cl;
      return {
        key: 'late',
        label: 'Running Late',
        shortLabel: 'Late',
        icon: '🌘',
        color: '#d4af5a',
        colorBg: 'rgba(212,175,90,0.15)',
        colorClass: 'phase-luteal',
        desc: 'Your period is running late — totally normal. Stress, sleep shifts, and travel can all push your timing.',
        needs: ['Be patient with your body', 'Gentle movement only', 'Magnesium & omega-3', 'Stay hydrated', 'No pressure, no guilt'],
        note: 'Cycles run late — it happens. Keep things gentle. When your period arrives, update your date in Settings.',
        dayOfCycle: cd,
        isLate: true,
        daysLate
      };
    }

    // Match to a defined phase
    for (const [key, ph] of Object.entries(phases)) {
      const s = dayStart(ph);
      const e = dayEnd(ph);
      if (cd >= s && cd <= e) {
        return { key, ...ph, dayOfCycle: cd, isLate: false, cycleLength: cl };
      }
    }

    // Fallback to luteal if nothing matched (rounding edge)
    return { key: 'luteal', ...phases.luteal, dayOfCycle: cd, isLate: false, cycleLength: cl };
  }

  _energyState() {
    const states = this.config.cycle.energyModel?.states || {};
    const defaultKey = this.config.cycle.energyModel?.defaultState || 'moderate';
    const todayKey = this.state.todayCheckin?.energyState || defaultKey;
    const stateData = states[todayKey] || states[defaultKey] || {};
    return { key: todayKey, ...stateData };
  }

  _noDataState() {
    return {
      key: null, label: 'Set Up Your Cycle', shortLabel: '', icon: '🌑',
      color: '#c9b8e8', colorClass: '', desc: 'Enter your period date in Settings to unlock your personalized dashboard.',
      needs: ['Set up your cycle first →'], note: '', dayOfCycle: null
    };
  }

  /** Get phase for a specific future/past cycle day (for planning views). */
  phaseForDay(absoluteCycleDay) {
    const cl = this.state.cycleLength || this.config.cycle.defaultLength;
    const pd = this.state.periodDuration || this.config.cycle.periodDuration;
    const phases = this.config.cycle.phases;

    if (absoluteCycleDay > cl) return { key: 'late' };

    // Use fraction-based thresholds matching getPhase() in v1
    const ovuStart = Math.round(cl * 0.43);
    const ovuEnd   = Math.round(cl * 0.50);

    if (absoluteCycleDay <= pd) return { key: 'menstrual', ...phases.menstrual };
    if (absoluteCycleDay < ovuStart) return { key: 'follicular', ...phases.follicular };
    if (absoluteCycleDay <= ovuEnd) return { key: 'ovulatory', ...phases.ovulatory };
    return { key: 'luteal', ...phases.luteal };
  }
}

// ─── BASE MODULE ──────────────────────────────────────────────────────────────

class BaseModule {
  constructor(app) {
    this.app = app;
  }
  get config() { return this.app.config; }
  get state()  { return this.app.state;  }
  get phase()  { return this.app.phaseEngine.current; }
  get engine() { return this.app.phaseEngine; }

  /** Called when the tab is activated. Return HTML string for the module container. */
  render() { return `<p style="color:var(--text-soft)">Module not implemented yet.</p>`; }

  /** Called after the HTML is injected into the DOM — wire up event listeners here. */
  onMount() {}

  /** Called when the user saves settings and phase may have changed. */
  onRefresh() { this.app.switchTab(this.app.activeTabId, true); }

  /** Convenience: safely format a Date as "Jun 12" */
  formatDate(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

  /** Convenience: phase color tag HTML */
  phaseTag(phaseKey) {
    const ph = this.config.cycle.phases?.[phaseKey] || {};
    return `<span class="phase-tag" style="background:${ph.color}22;color:${ph.color};border:1px solid ${ph.color}44">${ph.shortLabel || phaseKey}</span>`;
  }

  /** Shared "Primary Movement" card — used on both Today and Calendar. */
  primaryMovementCardHTML() {
    return this._practiceCardHTML({
      stateKey: 'primaryMovement',
      title: 'Primary Movement',
      emptyBody: "Set your primary movement practice in Settings and Lunarly will tell you when it's your best window — and when to swap it for something gentler.",
      guidance: () => this.app.getPrimaryMovementGuidance(),
      metricField: 'intensity',
      metricFallback: 'go for it',
      metricSuffix: 'intensity'
    });
  }

  /** Shared "Primary Intellectual Practice" card — used on both Today and Calendar. */
  primaryIntellectualCardHTML() {
    return this._practiceCardHTML({
      stateKey: 'primaryIntellectual',
      title: 'Primary Intellectual Practice',
      emptyBody: "Set your primary intellectual/creative practice in Settings and Lunarly will match its load to your cognitive energy each phase.",
      guidance: () => this.app.getPrimaryIntellectualGuidance(),
      metricField: 'load',
      metricFallback: 'steady',
      metricSuffix: 'load'
    });
  }

  _practiceCardHTML({ stateKey, title, emptyBody, guidance: guidanceFn, metricField, metricFallback, metricSuffix }) {
    const p = this.state[stateKey];
    if (!p?.name) {
      return `
      <div class="card">
        <h3>${title}</h3>
        <p style="font-size:0.82rem;color:var(--text-soft);">${emptyBody}</p>
      </div>`;
    }
    const guidance = guidanceFn();
    const rec = guidance ? guidance.recommended !== false : true;
    const metricVal = guidance?.[metricField] || metricFallback;
    const time = p.preferredTime ? p.preferredTime[0].toUpperCase() + p.preferredTime.slice(1) : '';
    const meta = [p.description, p.sessionsPerWeek ? `${p.sessionsPerWeek}×/week · ${time}` : ''].filter(Boolean).join(' · ');
    return `
    <div class="card" style="border-color:${rec ? 'rgba(128,203,196,0.4)' : 'rgba(244,160,181,0.4)'}">
      <h3>${title} — ${p.name}</h3>
      ${meta ? `<p style="font-size:0.78rem;color:var(--text-soft);font-style:italic;margin-bottom:10px;">${meta}</p>` : ''}
      ${guidance ? `
        <div class="status-pill ${rec ? 'pill-success' : 'pill-warn'}" style="margin-bottom:10px;">${rec ? `✅ Recommended — ${metricVal} ${metricSuffix}` : '⚠️ Not ideal today'}</div>
        <p style="font-size:0.85rem;color:var(--text);line-height:1.5;">${guidance.note || ''}</p>
      ` : `<p style="font-size:0.8rem;color:var(--text-soft);">No phase guidance configured for this archetype yet.</p>`}
    </div>`;
  }
}

// ─── MODULE: TODAY ─────────────────────────────────────────────────────────────

class TodayModule extends BaseModule {
  render() {
    const ph = this.phase;
    const isMenstrual = this.config.cycle.type === 'menstrual';

    return `
      <!-- Health Score Rings -->
      <div class="card">
        <div class="card-head">
          <h3>Today's Body Stats</h3>
          <div class="info-icon" title="${this._statsNoteText()}">ⓘ</div>
        </div>
        <div class="score-grid" id="scoreGrid">${this._scoreRingsHTML()}</div>
        <details class="log-toggle">
          <summary>✎ Log today's numbers</summary>
          <div class="log-toggle-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;">
              ${(this._ringStats||[]).map(r => `
                <div class="form-row" style="margin-bottom:0">
                  <label>${r.label}</label>
                  <input type="number" min="0" max="100" id="manual-${r.id}" placeholder="0–100" value="${r.stat.value != null ? Math.round(r.stat.value) : ''}"/>
                </div>
              `).join('')}
            </div>
            <button class="save-btn" style="margin-top:12px" onclick="app.saveManualHealthEntry()">Save Today's Numbers</button>
          </div>
        </details>
      </div>

      <!-- Weather -->
      ${this.config.integrations?.weather?.enabled ? `
      <div class="card" id="weatherCard">
        <h3>${this.config.integrations.weather.locationLabel} Weather</h3>
        <p class="weather-subtitle">Today's training weather, personalized to your spot</p>
        <div id="weatherContent"><div style="text-align:center;color:var(--text-soft);font-size:0.85rem;padding:20px;">Loading weather...</div></div>
      </div>` : ''}

      <!-- Hormone Curve (menstrual only) -->
      ${isMenstrual && this.config.hormoneModel?.enabled ? `
      <div class="card">
        <h3>Hormone Curve — Where You Are Today</h3>
        <p style="font-size:0.75rem;color:var(--text-soft);font-style:italic;margin-bottom:12px;">${this.config.hormoneModel.disclaimer}</p>
        <canvas id="hormoneChart" height="200" style="width:100%;display:block;"></canvas>
        <div class="hormone-legend">
          <div class="hormone-legend-item"><div class="hormone-swatch" style="background:#c9305a"></div>Estrogen <span class="hormone-level" id="lvl-estrogen">–</span></div>
          <div class="hormone-legend-item"><div class="hormone-swatch" style="background:#7c3fbf"></div>Progesterone <span class="hormone-level" id="lvl-progesterone">–</span></div>
          <div class="hormone-legend-item"><div class="hormone-swatch" style="background:#d4930a"></div>LH <span class="hormone-level" id="lvl-lh">–</span></div>
          <div class="hormone-legend-item"><div class="hormone-swatch" style="background:#2eb8ae"></div>FSH <span class="hormone-level" id="lvl-fsh">–</span></div>
        </div>
        <div id="todayHormoneNote" style="margin-top:12px;background:rgba(201,184,232,0.2);border-radius:10px;padding:10px 14px;font-size:0.8rem;line-height:1.5;"></div>
      </div>` : ''}

      <!-- Energy Check-in (menopausal / energy model) -->
      ${!isMenstrual ? `
      <div class="card">
        <h3>Energy Check-In</h3>
        <p style="font-size:0.82rem;color:var(--text-soft);margin-bottom:14px;">${this.config.cycle.energyModel?.checkInPrompt || 'How does your body feel today?'}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap" id="energyBtns">
          ${Object.entries(this.config.cycle.energyModel?.states || {}).map(([key, s]) => `
            <button onclick="app.setEnergyState('${key}')" class="energy-btn ${this.state.todayCheckin?.energyState === key ? 'active' : ''}"
              style="flex:1;min-width:100px;padding:14px;border-radius:14px;border:2px solid ${s.color}44;background:${this.state.todayCheckin?.energyState === key ? s.color+'33' : 'rgba(255,255,255,0.06)'};cursor:pointer;text-align:center;">
              <div style="font-size:1.6rem;margin-bottom:6px">${s.icon}</div>
              <div style="font-size:0.8rem;font-weight:bold;color:${s.color}">${s.label}</div>
            </button>
          `).join('')}
        </div>
        ${this.config.cycle.energyModel?.symptoms?.length ? `
          <div style="margin-top:14px">
            <div style="font-size:0.72rem;letter-spacing:0.12em;color:var(--text-soft);margin-bottom:8px">ANY SYMPTOMS TODAY?</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${(this.config.cycle.energyModel.symptoms || []).map(s => `
                <button onclick="app.toggleSymptom('${s}')"
                  class="symptom-btn ${(this.state.todayCheckin?.symptoms||[]).includes(s) ? 'active' : ''}"
                  style="padding:6px 12px;border-radius:20px;border:1px solid rgba(212,175,90,0.3);background:${(this.state.todayCheckin?.symptoms||[]).includes(s) ? 'rgba(212,175,90,0.2)' : 'rgba(255,255,255,0.06)'};cursor:pointer;font-size:0.75rem;color:var(--text-soft)">
                  ${s}
                </button>
              `).join('')}
            </div>
          </div>` : ''}
        <p class="checkin-feeds-note">These check-ins feed your Insights: see energy and sleep patterns by ${isMenstrual ? 'phase' : 'energy state'} over time.</p>
      </div>` : ''}

      <!-- Primary Movement -->
      ${this.primaryMovementCardHTML()}

      <!-- Primary Intellectual Practice -->
      ${this.primaryIntellectualCardHTML()}

      <!-- Today's Guidance -->
      <div class="need-card">
        <h3>Today's Guidance</h3>
        ${this._guidanceHTML(ph)}
        ${this._lowEnergyNoteHTML()}
      </div>

      <!-- Pep Talk — the personal notes, kept front and center in their own card -->
      ${ph.note ? `
      <div class="pep-talk-card">
        <h3>Pep Talk</h3>
        <p>${ph.note}</p>
      </div>` : ''}
    `;
  }

  onMount() {
    this._drawScoreRings();
    if (this.config.integrations?.weather?.enabled) this._fetchWeather();
    if (this.config.cycle.type === 'menstrual' && this.config.hormoneModel?.enabled) {
      this._drawHormoneChart();
    }
  }

  /** Renders the "Today's Guidance" body: categorized Movement/Recovery/Mindset groups when
   *  the phase config provides them, otherwise falls back to the flat needs pill list. */
  _guidanceHTML(ph) {
    if (ph.needsByCategory) {
      const groups = [
        { key: 'movement', label: 'Movement' },
        { key: 'recovery', label: 'Recovery' },
        { key: 'mindset',  label: 'Mindset'  }
      ];
      return groups.map(g => {
        const data = ph.needsByCategory[g.key];
        if (!data || !data.tags?.length) return '';
        return `
        <div class="guidance-group">
          <div class="guidance-label">${g.label}${data.intensity ? ` <span class="intensity-badge intensity-${data.intensity}">${data.intensity}</span>` : ''}</div>
          <div class="need-items">
            ${data.tags.map(t => `<div class="need-pill">✓ ${t}</div>`).join('')}
          </div>
        </div>`;
      }).join('');
    }
    if (ph.needs?.length) {
      return `<div class="need-items">${ph.needs.map(n => `<div class="need-pill">${n}</div>`).join('')}</div>`;
    }
    return `<div class="need-items"><div class="need-pill">Set up your cycle first →</div></div>`;
  }

  /** If today's logged/estimated energy score is meaningfully low, say so — even a "strong" phase
   *  or "high energy" state shouldn't override what the body is actually reporting today. */
  _lowEnergyNoteHTML() {
    const stat = this.app.getHealthStat('energyScore');
    if (stat.value == null || stat.value >= 40) return '';
    const verb = stat.predicted ? 'has been trending low' : 'is low today';
    return `
      <div class="low-energy-note">
        ⚠️ Your energy ${verb} (${Math.round(stat.value)}/100) — consider dialing back from what your phase alone would suggest. Gentler movement and lighter cognitive load are reasonable today, whatever the guidance above says.
      </div>`;
  }

  _scoreRingsHTML() {
    const defs = [
      { id: 'energy', key: 'energyScore',      label: 'Energy',   color: '#b39ddb', desc: 'How energized you feel' },
      { id: 'sleep',  key: 'sleepScore',       label: 'Sleep',    color: '#80cbc4', desc: 'Last night\'s sleep quality' },
      { id: 'phys',   key: 'physicalRecovery', label: 'Physical', color: '#f4a0b5', desc: 'Body\'s readiness to train' },
      { id: 'mental', key: 'mentalRecovery',   label: 'Mental',   color: '#c9b8e8', desc: 'Mental & stress recovery' }
    ];
    this._ringStats = defs.map(r => ({ ...r, stat: this.app.getHealthStat(r.key) }));
    return this._ringStats.map(r => {
      const { value, predicted } = r.stat;
      return `
      <div class="score-item">
        <div class="score-ring">
          <svg width="70" height="70" viewBox="0 0 70 70">
            <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(201,184,232,0.2)" stroke-width="7"/>
            <circle cx="35" cy="35" r="28" fill="none" stroke="${r.color}" stroke-width="7"
              stroke-dasharray="176" stroke-dashoffset="${value != null ? 176 - (Math.min(value,100)/100)*176 : 176}"
              id="ring-${r.id}" stroke-linecap="round"/>
          </svg>
          <div class="score-num${value != null ? (predicted ? ' predicted' : '') : ' no-data'}" id="num-${r.id}">${value != null ? (predicted ? '~' : '') + Math.round(value) : 'No data yet'}</div>
        </div>
        <div class="score-label">${r.label}</div>
        <div class="score-desc">${r.desc}</div>
      </div>
    `;
    }).join('');
  }

  _statsNoteText() {
    const stats = this._ringStats || [];
    if (stats.every(r => r.stat.baseline)) return 'Starting baseline — log today\'s numbers below or upload a Samsung Health CSV in Settings to personalize these';
    if (stats.every(r => !r.stat.predicted)) return 'Today\'s real numbers';
    if (stats.some(r => !r.stat.predicted)) return 'Mix of today\'s real numbers and estimates (~) from your recent average';
    return 'Estimated (~) from your recent average — log today\'s numbers below for real data';
  }

  _drawScoreRings() {
    (this._ringStats || []).forEach(r => {
      const { value, predicted } = r.stat;
      const el = document.getElementById(`ring-${r.id}`);
      const ne = document.getElementById(`num-${r.id}`);
      if (el && value != null) {
        el.style.strokeDashoffset = 176 - (Math.min(value, 100) / 100) * 176;
        if (ne) { ne.textContent = (predicted ? '~' : '') + Math.round(value); ne.classList.remove('no-data'); ne.classList.toggle('predicted', predicted); }
      }
    });
  }

  async _fetchWeather() {
    const w = this.config.integrations.weather;
    const _fallback = (msg) => {
      const el = document.getElementById('weatherContent');
      if (el) el.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;color:var(--text-soft);font-size:0.82rem;">
          <div style="font-size:1.6rem;">🌤️</div>
          <div>
            <div style="font-weight:600;color:var(--text);margin-bottom:2px;">${w.locationLabel || 'Weather'}</div>
            <div>${msg}</div>
          </div>
        </div>`;
    };
    if (!w.lat || !w.lon) { _fallback('Add lat/lon to your config to enable live weather.'); return; }
    const unit = w.units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,wind_speed_10m,precipitation,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=auto&forecast_days=3&temperature_unit=${unit}&wind_speed_unit=mph`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      this._renderWeather(data, w);
    } catch {
      _fallback('Could not load weather — check your connection and try again.');
    }
  }

  _renderWeather(data, wcfg) {
    const el = document.getElementById('weatherContent');
    if (!el) return;
    const c = data.current;
    const temp = Math.round(c.temperature_2m);
    const unit = wcfg.units === 'fahrenheit' ? '°F' : '°C';
    const info = WeatherHelper.codeToInfo(c.weather_code);
    const rec  = WeatherHelper.recommendation(c, wcfg);
    const d0   = data.daily;
    el.innerHTML = `
      <div class="weather-layout">
        <div class="weather-current">
          <div class="weather-main">
            <div class="weather-icon">${info.icon}</div>
            <div>
              <div class="weather-temp">${temp}${unit}</div>
              <div class="weather-desc">${info.desc} · ${wcfg.locationLabel}</div>
              <div class="weather-detail">💨 ${Math.round(c.wind_speed_10m)} mph · 💧 ${c.relative_humidity_2m}% · 🌧️ ${c.precipitation}" precip</div>
            </div>
          </div>
          <div class="weather-rec ${rec.cls}">${rec.text}</div>
        </div>
        <div class="weather-forecast">
          ${[0,1,2].map(i => {
            const dw = WeatherHelper.codeToInfo(d0.weather_code[i]);
            const dd = new Date(d0.time[i]);
            return `<div class="weather-forecast-day">
              <div class="weather-forecast-label">${i===0?'Today':i===1?'Tomorrow':dd.toLocaleDateString('en-US',{weekday:'short'})}</div>
              <div class="weather-forecast-icon">${dw.icon}</div>
              <div class="weather-forecast-temps">${Math.round(d0.temperature_2m_max[i])}° / ${Math.round(d0.temperature_2m_min[i])}°</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  _drawHormoneChart() {
    // Full implementation is in HormoneChart helper below
    HormoneChart.draw('hormoneChart', this.engine.cycleDay, this.state, this.config);
  }
}

// ─── MODULE: CYCLE / ENERGY OVERVIEW ──────────────────────────────────────────

class CycleModule extends BaseModule {
  render() {
    const isMenstrual = this.config.cycle.type === 'menstrual';
    if (isMenstrual) return this._menstrualView();
    return this._energyView();
  }

  _menstrualView() {
    if (!this.state.periodStart) {
      return `<div class="card"><h3>Your Cycle</h3><p style="color:var(--text-soft);font-size:0.83rem;">Set your period date in Settings to see your cycle.</p></div>`;
    }
    return `
      <div class="card">
        <h3>Cycle Wheel</h3>
        <div class="cycle-wheel-wrap">
          <canvas id="cycleWheel" width="280" height="280"></canvas>
        </div>
        <div id="cycleStats" style="text-align:center;font-size:0.82rem;color:var(--text-soft);margin-top:12px;"></div>
      </div>
      <div class="card">
        <h3>Phase Timeline</h3>
        <div id="phaseTimeline"></div>
      </div>
      <div class="card">
        <h3>Cycle Focus</h3>
        <div class="form-row">
          <label>My Focus This Cycle</label>
          <select id="cycleFocus" onchange="app.saveCycleFocus()">
            ${(this.config.activity?.cycleFocusOptions || []).map(opt =>
              `<option value="${opt.value}" ${this.state.cycleFocus === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
          </select>
        </div>
        <p id="focusNote" style="font-size:0.8rem;color:var(--text-soft);margin-top:8px;line-height:1.5;font-style:italic;"></p>
      </div>
    `;
  }

  _energyView() {
    const ph = this.phase;
    const states = this.config.cycle.energyModel?.states || {};
    return `
      <div class="card">
        <h3>Energy States</h3>
        <p style="font-size:0.82rem;color:var(--text-soft);margin-bottom:16px;line-height:1.5;">
          Your planning is driven by how you feel each day, not a fixed cycle calendar.
          Log your energy state on the Today tab — it will shift all recommendations.
        </p>
        ${Object.entries(states).map(([key, s]) => `
          <div style="padding:16px;border-radius:14px;margin-bottom:12px;background:${s.colorBg || s.color+'15'};border:1px solid ${s.color}33;${ph.key === key ? 'border-color:'+s.color+';border-width:2px' : ''}">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
              <div style="font-size:1.6rem">${s.icon}</div>
              <div>
                <div style="font-weight:bold;color:${s.color}">${s.label}</div>
                ${ph.key === key ? '<span class="status-pill pill-success" style="margin-left:6px">TODAY</span>' : ''}
              </div>
            </div>
            <p style="font-size:0.82rem;color:var(--text-soft);line-height:1.5">${s.desc}</p>
          </div>
        `).join('')}
      </div>
      ${this.config.hormoneModel?.suppressedBy ? `
      <div class="card" style="border-color:rgba(212,175,90,0.3)">
        <h3>About Your Hormone Model</h3>
        <p style="font-size:0.82rem;color:var(--text-soft);line-height:1.6;">${this.config.hormoneModel.note}</p>
      </div>` : ''}
    `;
  }

  onMount() {
    if (this.config.cycle.type === 'menstrual' && this.state.periodStart) {
      CycleWheel.draw('cycleWheel', this.state, this.config);
      this._renderTimeline();
      this._updateFocusNote();
    }
  }

  _renderTimeline() {
    const el = document.getElementById('phaseTimeline');
    if (!el || !this.state.periodStart) return;
    const start   = new Date(this.state.periodStart);
    const cl      = this.state.cycleLength;
    const pd      = this.state.periodDuration;
    const phases  = this.config.cycle.phases;
    const cycleDay = this.engine.cycleDay;
    const isLate   = this.engine.isLate;

    // Build a simplified timeline: phases with date ranges
    const timeline = [
      { key: 'menstrual',  s: 1,      e: pd },
      { key: 'follicular', s: pd+1,   e: Math.round(cl*0.43) - 1 },
      { key: 'ovulatory',  s: Math.round(cl*0.43), e: Math.round(cl*0.50) },
      { key: 'luteal',     s: Math.round(cl*0.50)+1, e: cl }
    ];

    el.innerHTML = timeline.map(item => {
      const ph = phases[item.key] || {};
      const phStart = new Date(start); phStart.setDate(phStart.getDate() + item.s - 1);
      const phEnd   = new Date(start); phEnd.setDate(phEnd.getDate() + item.e - 1);
      const isNow   = !isLate && cycleDay >= item.s && cycleDay <= item.e;
      return `<div style="display:flex;gap:12px;align-items:center;padding:12px;border-radius:12px;margin-bottom:8px;background:${ph.color}15;border:1px solid ${ph.color}44${isNow?';border-color:'+ph.color:''}">
        <div style="width:4px;height:48px;border-radius:2px;background:${ph.color};flex-shrink:0"></div>
        <div>
          <div style="font-weight:bold;font-size:0.85rem">${ph.icon||''} ${ph.label||item.key} ${isNow ? '<span class="status-pill pill-success" style="margin-left:6px">NOW</span>' : ''}</div>
          <div style="font-size:0.75rem;color:var(--text-soft);margin-top:3px">Days ${item.s}–${item.e} · ${this.formatDate(phStart)} → ${this.formatDate(phEnd)}</div>
        </div>
      </div>`;
    }).join('');

    // Late indicator
    if (isLate) {
      const daysLate = cycleDay - cl;
      el.innerHTML += `<div style="display:flex;gap:12px;align-items:center;padding:12px;border-radius:12px;margin-bottom:8px;background:rgba(212,175,90,0.1);border:2px solid #d4af5a">
        <div style="width:4px;height:48px;border-radius:2px;background:#d4af5a;flex-shrink:0"></div>
        <div>
          <div style="font-weight:bold;font-size:0.85rem">🌘 Running Late <span class="status-pill" style="margin-left:6px;background:rgba(212,175,90,0.25);color:#a07820">NOW</span></div>
          <div style="font-size:0.75rem;color:var(--text-soft);margin-top:3px">${daysLate} day${daysLate>1?'s':''} past average cycle length</div>
        </div>
      </div>`;
    }

    // Next period prediction
    const nextStart = new Date(start); nextStart.setDate(nextStart.getDate() + cl);
    el.innerHTML += `<div style="text-align:center;font-size:0.8rem;color:var(--text-soft);padding:10px;border-top:1px solid rgba(201,184,232,0.2);margin-top:8px">
      Next period predicted: <strong>${this.formatDate(nextStart)}</strong>
    </div>`;
  }

  _updateFocusNote() {
    const el = document.getElementById('focusNote');
    if (!el) return;
    const focus = this.state.cycleFocus || this.config.activity?.defaultCycleFocus;
    const opt = (this.config.activity?.cycleFocusOptions || []).find(o => o.value === focus);
    if (opt) el.textContent = opt.note;
  }
}

// ─── MODULE: NOURISH (Food + Fasting) ─────────────────────────────────────────

class NourishModule extends BaseModule {
  render() {
    const ph = this.phase;
    const foodPhases = this.config.food?.phases || {};
    const currentFood = foodPhases[ph.key] || Object.values(foodPhases)[0];
    const fasting = this.config.fasting || {};
    const fastRule = fasting.phaseRules?.[ph.key] || {};
    const foodConfig = this.config.food;

    return `
      <div class="card">
        <h3>Eating Today</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:16px;line-height:1.5;">${foodConfig?.intro || ''}</p>
        ${this.state.dietPreferences?.length ? `<p style="font-size:0.78rem;color:var(--gold-light);margin:-10px 0 16px;">Your focus: ${this.state.dietPreferences.join(', ')}</p>` : ''}
        ${currentFood ? `
          <div style="font-size:0.8rem;font-weight:bold;color:var(--gold);margin-bottom:8px;">Eat more:</div>
          <div class="food-tags">${(currentFood.eat || []).map(x=>`<div class="food-tag">${x}</div>`).join('')}</div>
          <div style="font-size:0.8rem;font-weight:bold;color:var(--gold);margin-top:14px;margin-bottom:8px;">Ease up on:</div>
          <div class="food-tags">${(currentFood.limit || []).map(x=>`<div class="food-tag food-avoid">${x}</div>`).join('')}</div>
          <p class="food-note" style="margin-top:12px;">${currentFood.note || ''}</p>
        ` : '<p style="color:var(--text-soft)">Set up your cycle to get food guidance.</p>'}
      </div>

      ${fasting.enabled && this.state.fastingEnabled !== false ? `
      <div class="card">
        <h3>Fasting Today</h3>
        <div style="margin-bottom:16px">
          <span class="fasting-window-badge ${fastRule.recommended ? '' : 'no-fast'}">${fastRule.badge || ''}</span>
          <p style="font-size:0.82rem;color:var(--text-soft);margin-top:8px;line-height:1.5;">${fastRule.reason || ''}</p>
          ${fastRule.maxWindowHours ? `<p style="font-size:0.78rem;color:var(--gold);margin-top:4px;">Max recommended: ${fastRule.maxWindowHours}:${24-fastRule.maxWindowHours} today</p>` : ''}
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:20px;">
          <h3 style="margin-bottom:6px;">Fast Clock</h3>
          <div id="fast-start-panel">
            <label style="font-size:0.75rem;letter-spacing:0.15em;color:var(--gold);display:block;margin-bottom:6px;">FAST START TIME</label>
            <input type="datetime-local" id="fast-start-input" style="width:100%;background:rgba(255,255,255,0.88);border:1px solid rgba(212,175,90,0.4);border-radius:10px;color:#1a0e35;padding:12px 14px;font-size:0.9rem;margin-bottom:16px;outline:none;color-scheme:light;"/>
            <label style="font-size:0.75rem;letter-spacing:0.15em;color:var(--gold);display:block;margin-bottom:6px;">GOAL DURATION</label>
            <div class="fast-goal-row">
              ${(fasting.goalOptions || [12,14,16,20]).map(h => `<button class="fast-goal-btn${h === (fasting.defaultWindowHours||16)?' active':''}" data-hours="${h}">${h} hrs</button>`).join('')}
            </div>
            <button class="fast-start-btn" onclick="app.startFastClock()">Begin Fast →</button>
          </div>
          <div id="fast-clock-panel" style="display:none;">
            <div style="text-align:center;margin:16px 0 8px;">
              <div class="fast-time-display" id="fast-time-display">00:00:00</div>
              <div style="font-size:0.72rem;color:var(--text-soft);letter-spacing:0.2em;margin-top:4px;">HOURS FASTED</div>
            </div>
            <div style="margin:14px 0">
              <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-soft);margin-bottom:6px;">
                <span>Progress to goal</span><span id="fast-pct" style="color:var(--gold)">0%</span>
              </div>
              <div class="fast-bar-track"><div class="fast-bar-fill" id="fast-bar" style="width:0%"></div></div>
            </div>
            <div id="fast-phase-info" class="fasting-phase-card" style="margin-bottom:12px;"></div>
            <button class="fast-reset-btn" onclick="app.resetFastClock()">↺ Reset / Start New Fast</button>
          </div>
        </div>
      </div>` : ''}
    `;
  }

  onMount() {
    // Wire fast goal buttons
    document.querySelectorAll('.fast-goal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fast-goal-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Restore active fast if one was running
    if (this.state.fastClock?.startMs) {
      FastClock.restore(this.state.fastClock, this.config.fasting?.milestones || []);
    }
  }
}

// ─── MODULE: INSIGHTS (Habits) ────────────────────────────────────────────────

class InsightsModule extends BaseModule {
  render() {
    const isMenstrual = this.config.cycle.type === 'menstrual';
    return `
      <div class="card">
        <h3>Load Your Habits Data</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:12px;">Upload your Checkmarks CSV to unlock cycle-habit correlations, streaks, and pattern charts.</p>
        <div class="upload-zone" onclick="document.getElementById('habitsFile').click()">
          <div class="upload-icon">📊</div>
          <p><strong>Checkmarks.csv</strong><br/>Your daily habit log</p>
          <input type="file" id="habitsFile" accept=".csv" onchange="app.parseHabitsCSV(this)"/>
          <div class="upload-status" id="habitsStatus">No file loaded</div>
        </div>
      </div>

      <div class="card" id="demoDataNotice" style="display:none;border-color:rgba(212,175,90,0.4);">
        <p style="font-size:0.8rem;color:var(--gold-light);margin:0;">✨ Showing example data so you can see what Insights looks like. Upload your Checkmarks.csv above to see your real patterns.</p>
      </div>

      <div class="card" id="energyPatternsCard" style="display:none">
        <h3>Energy &amp; Sleep Patterns</h3>
        <p style="font-size:0.75rem;color:var(--text-soft);margin-bottom:14px;">Built from your daily check-ins and logged body stats — real if you've logged them, illustrative if not.</p>
        <div id="energyPatternsBody"></div>
      </div>

      <div class="card" id="streakCard" style="display:none">
        <h3>Current Habit Streaks</h3>
        <div id="streakGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:4px;"></div>
      </div>

      <div class="card" id="heatmapCard" style="display:none">
        <h3>30-Day Habit Heatmap</h3>
        <p style="font-size:0.75rem;color:var(--text-soft);margin-bottom:10px;">Each row is a habit. Filled = done. Shaded bands = ${isMenstrual ? 'cycle phases' : 'logged energy states'}.</p>
        <canvas id="heatmapChart" height="160" style="width:100%;display:block;"></canvas>
      </div>

      <div class="card" id="phaseCorrelCard" style="display:none">
        <h3>Habits by ${isMenstrual ? 'Cycle Phase' : 'Energy State'}</h3>
        <p style="font-size:0.75rem;color:var(--text-soft);margin-bottom:10px;">% of days you completed each habit ${isMenstrual ? 'in each phase' : 'at each energy state'} — your real patterns.</p>
        <canvas id="phaseCorrelChart" height="240" style="width:100%;display:block;"></canvas>
      </div>

      <div id="patternInsights" style="display:none"></div>

      <div class="card" id="wellnessCard" style="display:none">
        <h3>Wellness Score — Last 60 Days</h3>
        <canvas id="wellnessChart" height="160" style="width:100%;display:block;"></canvas>
      </div>
    `;
  }

  onMount() {
    const notice = document.getElementById('demoDataNotice');
    // Habits persist in localStorage, so re-render from history on every visit — not just
    // right after a fresh upload — otherwise the cards go back to empty on reload.
    if (this.state.habitsData) {
      if (notice) notice.style.display = 'none';
      HabitsEngine.renderAll(this.state.habitsData, this.state, this.config);
    } else {
      // No upload yet this browser — show deterministic example data instead of an empty tab.
      // Never derived from or shipped with real personal data; purely illustrative shape, and
      // rendered against a curated demo habit list matching this archetype's persona.
      if (notice) notice.style.display = 'block';
      const isMenopausal = this.config.cycle.type !== 'menstrual';
      const habits    = isMenopausal ? HabitsEngine._demoHabitsMenopausal    : HabitsEngine._demoHabits;
      const wellness  = isMenopausal ? HabitsEngine._demoWellnessMenopausal  : HabitsEngine._demoWellness;
      const limit     = isMenopausal ? HabitsEngine._demoLimitMenopausal    : HabitsEngine._demoLimit;
      const overrides = isMenopausal ? HabitsEngine._demoRateOverridesMenopausal : HabitsEngine._demoRateOverrides;
      const seed = HabitsEngine.generateSeedData(45, habits, overrides);
      const demoConfig = { ...this.config, habits: { ...this.config.habits, tracked: habits, wellness, limit } };
      HabitsEngine.renderAll(seed, this.state, demoConfig);
    }
    this._renderEnergyPatterns();
  }

  /** Turns the unified healthData.history (body stats + energy check-ins, each tagged with a
   *  phase/energy-state via app._historyPhaseKey) into three simple stat blocks: average energy
   *  by phase, average sleep on symptom vs symptom-free days, and low-energy day counts by phase. */
  _renderEnergyPatterns() {
    const card = document.getElementById('energyPatternsCard');
    const body = document.getElementById('energyPatternsBody');
    if (!card || !body) return;

    const history = (this.state.healthData?.history || []).filter(e => e.energyScore != null || e.energyState);
    if (history.length < 3) { card.style.display = 'none'; return; }
    card.style.display = 'block';

    const isMenstrual = this.config.cycle.type === 'menstrual';
    const phaseLabel = (key) => {
      const ph = (isMenstrual ? this.config.cycle.phases : this.config.cycle.energyModel?.states)?.[key];
      return ph?.shortLabel || ph?.label || key || 'Unknown';
    };
    const phaseColor = (key) => {
      const ph = (isMenstrual ? this.config.cycle.phases : this.config.cycle.energyModel?.states)?.[key];
      return ph?.color || '#c9b8e8';
    };
    const barRow = (label, value, color) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:88px;font-size:0.76rem;color:var(--text-soft);flex-shrink:0;">${label}</div>
        <div style="flex:1;background:rgba(255,255,255,0.08);border-radius:6px;height:10px;overflow:hidden;">
          <div style="width:${Math.max(4, Math.min(100, value))}%;height:100%;background:${color};"></div>
        </div>
        <div style="width:34px;text-align:right;font-size:0.76rem;color:var(--text);flex-shrink:0;">${Math.round(value)}</div>
      </div>`;

    const groups = {};
    history.forEach(e => {
      const key = this.app._historyPhaseKey(e) || 'unknown';
      (groups[key] || (groups[key] = [])).push(e);
    });

    let html = '';

    // Average energy by phase / energy-state
    const avgByPhase = Object.entries(groups)
      .map(([key, entries]) => {
        const vals = entries.map(e => e.energyScore).filter(v => v != null);
        return vals.length ? { key, avg: vals.reduce((a,b)=>a+b,0) / vals.length } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.avg - a.avg);
    if (avgByPhase.length) {
      html += `<div class="guidance-label" style="margin-bottom:10px;">Average energy by ${isMenstrual ? 'phase' : 'energy state'}</div>`;
      html += avgByPhase.map(g => barRow(phaseLabel(g.key), g.avg, phaseColor(g.key))).join('');
    }

    // Average sleep: symptom days vs clear days
    const avgSleep = (arr) => { const v = arr.map(e => e.sleepScore).filter(x => x != null); return v.length ? v.reduce((a,b)=>a+b,0)/v.length : null; };
    const sleepWith = avgSleep(history.filter(e => e.symptoms?.length));
    const sleepWithout = avgSleep(history.filter(e => !e.symptoms?.length));
    if (sleepWith != null && sleepWithout != null) {
      html += `<div class="guidance-label" style="margin:18px 0 10px;">Average sleep — symptom days vs clear days</div>`;
      html += barRow('Clear days', sleepWithout, 'var(--teal)');
      html += barRow('Symptom days', sleepWith, 'var(--rose)');
    }

    // Low-energy days per phase / energy-state
    const lowByPhase = Object.entries(groups)
      .map(([key, entries]) => ({ key, low: entries.filter(e => (e.energyScore != null && e.energyScore < 40) || e.energyState === 'low').length, total: entries.length }))
      .filter(g => g.total > 0);
    if (lowByPhase.length) {
      html += `<div class="guidance-label" style="margin:18px 0 10px;">Low-energy days logged, by ${isMenstrual ? 'phase' : 'state'}</div>`;
      html += `<div class="need-items">${lowByPhase.map(g => `<div class="need-pill">${phaseLabel(g.key)}: ${g.low}/${g.total}</div>`).join('')}</div>`;
    }

    body.innerHTML = html || `<p style="font-size:0.8rem;color:var(--text-soft);">Log a few more check-ins to see patterns here.</p>`;
  }
}

// ─── MODULE: CALENDAR (weekly plan + ClickUp push) ────────────────────────────
// Replaces the old separate Workouts + ClickUp tabs. Generates a phase-aware
// weekly plan from the user's primary movement + intellectual practices
// (config + Settings), instead of hard-coded pole/streaming events.

class CalendarModule extends BaseModule {
  render() {
    const cu = this.config.integrations?.clickup;
    const pushEnabled = !!cu?.enabled;

    return `
      ${this.primaryMovementCardHTML()}
      ${this.primaryIntellectualCardHTML()}

      <div class="card">
        <h3>This Week's Plan</h3>
        <p style="font-size:0.78rem;color:var(--text-soft);margin-bottom:14px;">Sessions are placed on your best-matched days for each practice — not every day.</p>
        <div id="weeklyPlan"></div>
      </div>

      ${pushEnabled ? `
      <div class="card">
        <h3>Push to ClickUp</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;line-height:1.6;">Pushes this week's scheduled movement + intellectual sessions as tasks. To get your token: <strong style="color:var(--text)">clickup.com → avatar → Settings → Apps → API Token</strong></p>
        <div class="form-row">
          <label>ClickUp API Token</label>
          <input type="password" id="clickupToken" placeholder="pk_..." oninput="app.state.clickupToken = this.value" autocomplete="off"/>
        </div>
        <button class="sync-btn" onclick="app.syncWeeklyPlan()">Push This Week's Plan to ClickUp</button>
        <div class="sync-log" id="syncLog" style="margin-top:16px;display:none;">Paste your pk_ token above and hit push.</div>
      </div>` : ''}

      <div class="card">
        <h3>Google Calendar</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;line-height:1.6;">Turn this week's movement and focus blocks into calendar events.</p>
        <button class="gcal-btn" onclick="app.previewGoogleCalendar()">Push this week to Google Calendar</button>
        <div id="gcalPreview" style="display:none;margin-top:16px;"></div>
      </div>
    `;
  }

  onMount() {
    this._renderWeeklyPlan();
  }

  _renderWeeklyPlan() {
    const el = document.getElementById('weeklyPlan');
    if (!el) return;

    if (this.config.cycle.type === 'menstrual' && !this.state.periodStart) {
      el.innerHTML = '<p style="color:var(--text-soft);font-size:0.83rem;">Set your period date in Settings to generate this week\'s plan.</p>';
      return;
    }

    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const timeAbbrev = { morning: 'AM', afternoon: 'MID', evening: 'PM' };
    const plan = this.app.buildWeeklyPlan();

    el.innerHTML = plan.map((day, i) => {
      const isToday = i === 0;
      const phInfo = this.config.cycle.phases?.[day.phaseKey] || this.config.cycle.energyModel?.states?.[day.phaseKey] || {};
      const sessionRow = (session, emptyLabel, tagClass) => session
        ? `<div class="session-row">
            <div class="session-time">${timeAbbrev[session.time] || ''}</div>
            <div class="session-detail">${session.name}<span class="session-tag ${tagClass}">${session.intensity || session.load || ''}</span></div>
          </div>`
        : `<div class="session-row"><div class="session-time">–</div><div class="session-detail" style="color:var(--text-soft)">${emptyLabel}</div></div>`;

      return `<div class="workout-day${isToday ? ' today' : ''}">
        <div class="workout-day-header">
          <div>
            <div class="workout-day-name">${isToday ? '⭐ TODAY — ' : ''}${dayNames[day.date.getDay()]} ${this.formatDate(day.date)}</div>
          </div>
          <div class="workout-phase-tag" style="background:${phInfo.color || '#c9b8e8'}22;color:${phInfo.color || '#c9b8e8'};border:1px solid ${phInfo.color || '#c9b8e8'}44">${day.phaseKey}</div>
        </div>
        ${this.state.primaryMovement ? sessionRow(day.movement, `No ${this.state.primaryMovement.name} session`, 'tag-strength') : ''}
        ${this.state.primaryIntellectual ? sessionRow(day.intellectual, `No ${this.state.primaryIntellectual.name} session`, 'tag-focus') : ''}
        ${!this.state.primaryMovement && !this.state.primaryIntellectual ? '<p style="font-size:0.8rem;color:var(--text-soft);">Set your primary movement and intellectual practices in Settings to see them here.</p>' : ''}
      </div>`;
    }).join('');
  }
}

// ─── MODULE: SETTINGS ─────────────────────────────────────────────────────────

class SettingsModule extends BaseModule {
  render() {
    const isMenstrual = this.config.cycle.type === 'menstrual';
    const wearables = this.config.wearables?.csvTypes || {};

    return `
      ${isMenstrual ? `
      <div class="card">
        <h3>Cycle Settings</h3>
        <div class="form-row">
          <label>First Day of Last Bleed</label>
          <input type="date" id="periodStart" value="${this.state.periodStart || ''}" onchange="app.saveSettings()"/>
        </div>
        <div class="form-row">
          <label>Average Cycle Length (days)</label>
          <input type="number" id="cycleLength" value="${this.state.cycleLength || this.config.cycle.defaultLength}" min="21" max="45" onchange="app.saveSettings()"/>
        </div>
        <div class="form-row">
          <label>Average Period Duration (days)</label>
          <input type="number" id="periodDuration" value="${this.state.periodDuration || this.config.cycle.periodDuration}" min="2" max="10" onchange="app.saveSettings()"/>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>Fasting</label>
            <select id="fastingEnabled" onchange="app.saveSettings()">
              <option value="yes" ${this.state.fastingEnabled !== false ? 'selected' : ''}>Yes, show fasting guidance</option>
              <option value="no" ${this.state.fastingEnabled === false ? 'selected' : ''}>No, I don't fast</option>
            </select>
          </div>
          <div class="form-row">
            <label>Diet type</label>
            <select id="dietType" onchange="app.saveSettings()">
              ${['omnivore','vegetarian','vegan'].map(t => `<option value="${t}" ${(this.state.dietType || this.config.food?.pattern?.replace('indian-','') || 'omnivore') === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="save-btn" onclick="app.saveSettings()">Save & Refresh</button>
      </div>` : `
      <div class="card">
        <h3>Energy &amp; Symptom Profile</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;">Status: <strong style="color:var(--text)">Menopause</strong> — energy-based planning, no cycle-day math.</p>
        <div class="form-row">
          <label>When is your energy usually best?</label>
          <select id="energyPattern" onchange="app.saveEnergyProfile()">
            ${['morning','afternoon','evening'].map(t => `<option value="${t}" ${(this.state.energyPattern || 'morning') === t ? 'selected' : ''}>${t[0].toUpperCase()+t.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Top symptoms (pick up to 3)</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
            ${(this.config.cycle.energyModel?.symptoms || []).map(s => `
              <button type="button" onclick="app.toggleTopSymptom('${s}')"
                class="symptom-btn ${(this.state.topSymptoms||[]).includes(s) ? 'active' : ''}"
                style="padding:6px 12px;border-radius:20px;border:1px solid rgba(212,175,90,0.3);background:${(this.state.topSymptoms||[]).includes(s) ? 'rgba(212,175,90,0.2)' : 'rgba(255,255,255,0.06)'};cursor:pointer;font-size:0.75rem;color:var(--text-soft)">
                ${s}
              </button>`).join('')}
          </div>
        </div>
        <div class="form-row">
          <label>Diet preferences</label>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
            ${['High protein','Low sugar','Avoid late heavy dinners','Vegetarian','Vegan','Iron-rich'].map(d => `
              <button type="button" onclick="app.toggleDietPreference('${d}')"
                class="symptom-btn ${(this.state.dietPreferences||[]).includes(d) ? 'active' : ''}"
                style="padding:6px 12px;border-radius:20px;border:1px solid rgba(212,175,90,0.3);background:${(this.state.dietPreferences||[]).includes(d) ? 'rgba(212,175,90,0.2)' : 'rgba(255,255,255,0.06)'};cursor:pointer;font-size:0.75rem;color:var(--text-soft)">
                ${d}
              </button>`).join('')}
          </div>
        </div>
      </div>`}

      <div class="card">
        <h3>Primary Movement Practice</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;">What's the one practice you build your training around? Lunarly will tell you when it's your best window — and when to swap it for something gentler.</p>
        <div class="form-row">
          <label>Movement</label>
          <input type="text" id="primaryMovementName" list="movementSuggestions" value="${this.state.primaryMovement?.name || ''}" placeholder="e.g. Pole dance, Strength training, Running"/>
          <datalist id="movementSuggestions">
            ${(this.config.activity?.primaryMovementSuggestions || ['Strength training','Pole dance','Running','Swimming','Yoga','Dance','Cycling']).map(s => `<option value="${s}">`).join('')}
          </datalist>
        </div>
        <div class="form-row">
          <label>Description (optional)</label>
          <input type="text" id="primaryMovementDesc" value="${this.state.primaryMovement?.description || ''}" placeholder="e.g. Evening studio class"/>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>Sessions per week</label>
            <input type="number" id="primaryMovementFreq" min="1" max="7" value="${this.state.primaryMovement?.sessionsPerWeek || 3}"/>
          </div>
          <div class="form-row">
            <label>Preferred time</label>
            <select id="primaryMovementTime">
              ${['Morning','Afternoon','Evening'].map(t => `<option value="${t.toLowerCase()}" ${((this.state.primaryMovement?.preferredTime || 'evening') === t.toLowerCase()) ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="save-btn" onclick="app.savePrimaryMovement()">Save</button>
      </div>

      <div class="card">
        <h3>Primary Intellectual Practice</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;">The one mental/creative practice you plan around — streaming, deep work, writing, coding, studying. Lunarly matches its load to your cognitive energy each phase.</p>
        <div class="form-row">
          <label>Practice</label>
          <input type="text" id="primaryIntellectualName" list="intellectualSuggestions" value="${this.state.primaryIntellectual?.name || ''}" placeholder="e.g. Live streaming, Deep work, Writing"/>
          <datalist id="intellectualSuggestions">
            ${(this.config.activity?.primaryIntellectualSuggestions || ['Deep work / learning','Live streaming','Writing','Coding','Studying']).map(s => `<option value="${s}">`).join('')}
          </datalist>
        </div>
        <div class="form-row">
          <label>Description (optional)</label>
          <input type="text" id="primaryIntellectualDesc" value="${this.state.primaryIntellectual?.description || ''}" placeholder="e.g. Morning 90-minute block"/>
        </div>
        <div class="grid-2">
          <div class="form-row">
            <label>Sessions per week</label>
            <input type="number" id="primaryIntellectualFreq" min="1" max="7" value="${this.state.primaryIntellectual?.sessionsPerWeek || 4}"/>
          </div>
          <div class="form-row">
            <label>Preferred time</label>
            <select id="primaryIntellectualTime">
              ${['Morning','Afternoon','Evening'].map(t => `<option value="${t.toLowerCase()}" ${((this.state.primaryIntellectual?.preferredTime || 'morning') === t.toLowerCase()) ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="save-btn" onclick="app.savePrimaryIntellectual()">Save</button>
      </div>

      <div class="card">
        <h3>Health Data</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:14px;">Upload your wearable data CSV files for real scores.</p>
        ${Object.entries(wearables).map(([key, w]) => `
          <div class="upload-zone" onclick="document.getElementById('file-${key}').click()">
            <div class="upload-icon">${w.icon}</div>
            <p><strong>${w.label}</strong><br/>${w.filePattern}...csv</p>
            <input type="file" id="file-${key}" data-type="${key}" accept=".csv" onchange="app.parseHealthCSV(this, '${key}')"/>
            <div class="upload-status" id="status-${key}">No file loaded</div>
          </div>
        `).join('')}
      </div>

      <div class="card">
        <h3>Switch Archetype</h3>
        <p style="font-size:0.8rem;color:var(--text-soft);margin-bottom:12px;">Load a different configuration to switch users or archetypes.</p>
        <div class="form-row">
          <label>Active Config</label>
          <select id="configPicker" onchange="app.switchConfig(this.value)">
            ${(window.AVAILABLE_CONFIGS || ['demo-urban-athlete']).map(id =>
              `<option value="${id}" ${id === this.config.meta.id ? 'selected' : ''}>${id}</option>`
            ).join('')}
          </select>
        </div>
      </div>

      ${this.config.ui?.safetyDisclaimer ? `
      <div style="text-align:center;font-size:0.72rem;color:var(--text-soft);padding:16px;line-height:1.6;opacity:0.7">
        ${this.config.ui.safetyDisclaimer}
      </div>` : ''}
    `;
  }
}

// ─── HELPER: WEATHER ──────────────────────────────────────────────────────────

const WeatherHelper = {
  codeToInfo(code) {
    if (code === 0)    return { icon: '☀️', desc: 'Clear sky' };
    if (code <= 3)     return { icon: '🌤️', desc: 'Partly cloudy' };
    if (code <= 48)    return { icon: '🌫️', desc: 'Foggy' };
    if (code <= 67)    return { icon: '🌧️', desc: 'Rainy' };
    if (code <= 77)    return { icon: '❄️', desc: 'Snowy' };
    if (code <= 82)    return { icon: '🌦️', desc: 'Showers' };
    if (code <= 99)    return { icon: '⛈️', desc: 'Thunderstorm' };
    return { icon: '🌡️', desc: 'Unknown' };
  },

  recommendation(current, wcfg) {
    const isFahrenheit = wcfg.units === 'fahrenheit';
    const temp = current.temperature_2m;
    const code = current.weather_code;
    const isStorm = code >= 95;
    const isRainy = code >= 51 && code < 95;
    const minOutdoor = isFahrenheit ? 60 : 15;
    const hotSummer  = isFahrenheit ? 80 : 27;
    const isNice = temp >= minOutdoor && code <= 3 && current.precipitation < 0.1;
    const isHot  = temp >= hotSummer && code <= 3;

    if (isStorm) return { cls: 'weather-storm',   text: '⛈️ Thunderstorm alert — perfect hot tub & swim night! Stay inside but cozy.' };
    if (isNice && isHot) return { cls: 'weather-outdoor', text: '🌅 Hot summer morning — hit the riverwalk run early before it gets too hot.' };
    if (isNice) return { cls: 'weather-outdoor', text: '🌿 Perfect outdoor weather. Walk, jog, or take your workout outside.' };
    if (isRainy) return { cls: 'weather-indoor', text: '🌧️ Rainy day — indoor strength or pool swim. Hot tub after is chef\'s kiss.' };
    return { cls: 'weather-indoor', text: '🏙️ Indoor training today — gym, studio, pool, or living room.' };
  }
};

// ─── HELPER: HORMONE CHART ────────────────────────────────────────────────────

const HormoneChart = {
  draw(canvasId, cycleDay, state, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const cl = state.cycleLength || config.cycle.defaultLength;
    const pd = state.periodDuration || config.cycle.periodDuration;
    const totalDays = Math.max(cl, cycleDay || 0);
    const isLate = (cycleDay || 0) > cl;

    canvas.width  = (canvas.offsetWidth || 600) * (window.devicePixelRatio || 1);
    canvas.height = 210 * (window.devicePixelRatio || 1);
    canvas.style.height = '210px';
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    const W = canvas.width / dpr, H = canvas.height / dpr;
    const pad = { top: 26, right: 20, bottom: 36, left: 30 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;
    ctx.clearRect(0, 0, W, H);

    const curves = this._buildCurves(cl, totalDays, isLate);

    // Phase bands
    [
      { s: 0, e: pd, color: 'rgba(244,160,181,0.12)', label: 'Menstrual' },
      { s: pd, e: Math.round(cl*0.43), color: 'rgba(201,184,232,0.12)', label: 'Follicular' },
      { s: Math.round(cl*0.43), e: Math.round(cl*0.5), color: 'rgba(245,200,66,0.12)', label: 'Ovulatory' },
      { s: Math.round(cl*0.5), e: cl, color: 'rgba(124,92,191,0.08)', label: 'Luteal' },
      ...(isLate ? [{ s: cl, e: totalDays, color: 'rgba(212,175,90,0.1)', label: 'Late' }] : [])
    ].forEach(ph => {
      const x1 = pad.left + (ph.s / totalDays) * plotW;
      const x2 = pad.left + (ph.e / totalDays) * plotW;
      ctx.fillStyle = ph.color;
      ctx.fillRect(x1, pad.top, x2-x1, plotH);
      ctx.fillStyle = 'rgba(224,212,247,0.55)';
      ctx.font = '9px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText(ph.label, (x1+x2)/2, pad.top + plotH + 24);
    });

    // Grid
    ctx.strokeStyle = 'rgba(201,184,232,0.15)';
    [25,50,75,100].forEach(v => {
      const y = pad.top + plotH - (v/100)*plotH;
      ctx.beginPath(); ctx.setLineDash([3,4]);
      ctx.moveTo(pad.left, y); ctx.lineTo(pad.left+plotW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224,212,247,0.65)';
      ctx.font = '8px Georgia'; ctx.textAlign = 'right';
      ctx.fillText(v, pad.left-5, y+3);
    });

    // Convert a value array into plot-space points, then trace a smoothed path through
    // them (quadratic curve to the midpoint of each pair) instead of straight segments.
    const toPoints = (data) => data.map((v,i) => ({ x: pad.left+(i/(data.length-1))*plotW, y: pad.top+plotH-(v/100)*plotH }));
    const smoothPath = (points) => {
      ctx.moveTo(points[0].x, points[0].y);
      for (let i=1; i<points.length-1; i++) {
        const mx = (points[i].x+points[i+1].x)/2, my = (points[i].y+points[i+1].y)/2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      const p1 = points[points.length-2], p2 = points[points.length-1];
      ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
    };
    const drawFill = (data, hex) => {
      const [r,g,b] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
      ctx.beginPath();
      smoothPath(toPoints(data));
      ctx.lineTo(pad.left+plotW, pad.top+plotH); ctx.lineTo(pad.left, pad.top+plotH); ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},0.07)`; ctx.fill();
    };
    const drawLine = (data, hex, lw=2) => {
      const [r,g,b] = [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
      ctx.beginPath(); ctx.strokeStyle=`rgba(${r},${g},${b},0.95)`; ctx.lineWidth=lw; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.setLineDash([]);
      smoothPath(toPoints(data));
      ctx.stroke();
    };

    drawFill(curves.estrogen, '#e87fa5');
    drawFill(curves.progesterone, '#9c6fd6');
    drawFill(curves.lh, '#f5b942');
    drawFill(curves.fsh, '#80cbc4');
    drawLine(curves.fsh, '#2eb8ae', 1.8);
    drawLine(curves.lh, '#d4930a', 2.2);
    drawLine(curves.progesterone, '#7c3fbf', 2.2);
    drawLine(curves.estrogen, '#c9305a', 2.8);

    // TODAY marker
    if (cycleDay && cycleDay >= 1) {
      const tx = pad.left + ((cycleDay-1)/(totalDays-1))*plotW;
      const winW = Math.max(plotW/totalDays*2.5, 8);
      const mc = isLate ? '#d4af5a' : '#7c5cbf';
      ctx.fillStyle = isLate ? 'rgba(212,175,90,0.15)' : 'rgba(124,92,191,0.18)';
      ctx.fillRect(tx-winW/2, pad.top, winW, plotH);
      ctx.strokeStyle = mc; ctx.lineWidth=1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(tx, pad.top); ctx.lineTo(tx, pad.top+plotH); ctx.stroke();
      // Arrow
      ctx.fillStyle = mc; ctx.beginPath();
      ctx.moveTo(tx, pad.top+6); ctx.lineTo(tx-5, pad.top-2); ctx.lineTo(tx+5, pad.top-2); ctx.closePath(); ctx.fill();
      // TODAY pill
      const lw=38, lh=14, lx=tx-lw/2, ly=pad.top-18;
      ctx.fillStyle='#7c5cbf';
      if (ctx.roundRect) ctx.roundRect(lx,ly,lw,lh,4); else ctx.rect(lx,ly,lw,lh);
      ctx.fill();
      ctx.fillStyle='#fff'; ctx.font='bold 8px Georgia'; ctx.textAlign='center';
      ctx.fillText('TODAY', tx, ly+9);
      // Dots on each curve
      const idx = Math.min(cycleDay-1, totalDays-1);
      [['estrogen','#e87fa5'],['progesterone','#9c6fd6'],['lh','#f5b942'],['fsh','#80cbc4']].forEach(([k,color]) => {
        const y = pad.top+plotH-(curves[k][idx]/100)*plotH;
        ctx.beginPath(); ctx.arc(tx,y,4,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
        ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke();
      });
      // Hormone note
      this._updateNote(cycleDay, curves, totalDays, cl, pd);
    }
  },

  _buildCurves(cl, totalDays, isLate) {
    const estrogen=[], progesterone=[], lh=[], fsh=[];
    for (let i=0; i<cl; i++) {
      const t = i/cl;
      let e = t<0.05 ? 8+t*60 : t<0.35 ? 12+t*140 : t<0.42 ? 12+0.35*140+(t-0.35)*500 : t<0.5 ? 85-(t-0.42)*200 : t<0.72 ? 50+(t-0.5)*100 : 70-(t-0.72)*250;
      estrogen.push(Math.max(5, Math.min(100, e)));
      let p = t<0.45 ? 3+t*8 : t<0.55 ? 5+(t-0.45)*60 : t<0.75 ? 11+(t-0.55)*350 : 81-(t-0.75)*380;
      progesterone.push(Math.max(3, Math.min(100, p)));
      lh.push(Math.max(3, Math.min(100, 100*Math.exp(-Math.pow((t-0.43)/0.04,2))+5)));
      fsh.push(Math.max(5, Math.min(100, 55*Math.exp(-Math.pow((t-0.18)/0.12,2)) + 40*Math.exp(-Math.pow((t-0.42)/0.03,2)) + 8)));
    }
    if (isLate) {
      const extra = totalDays - cl;
      for (let i=0; i<extra; i++) {
        const d = 1-(i/Math.max(extra,1))*0.3;
        estrogen.push(Math.max(5, 10*d));
        progesterone.push(Math.max(3, 8*d));
        lh.push(4);
        fsh.push(Math.min(40, 10+i*1.5));
      }
    }
    return { estrogen, progesterone, lh, fsh };
  },

  _updateNote(cycleDay, curves, totalDays, cl, pd) {
    const idx = Math.min(cycleDay-1, totalDays-1);
    const eVal=curves.estrogen[idx], pVal=curves.progesterone[idx], lhVal=curves.lh[idx], fshVal=curves.fsh[idx];
    const level = v => v>75?'Peak':v>50?'High':v>30?'Moderate':v>15?'Low':'Very low';
    const slug = v => level(v).toLowerCase().replace(/\s+/g,'');
    this._setLevelBadge('lvl-estrogen', eVal, level, slug);
    this._setLevelBadge('lvl-progesterone', pVal, level, slug);
    this._setLevelBadge('lvl-lh', lhVal, level, slug);
    this._setLevelBadge('lvl-fsh', fshVal, level, slug);

    const el = document.getElementById('todayHormoneNote');
    if (!el) return;
    const phase = cycleDay>cl?'late':cycleDay<=pd?'menstrual':cycleDay<=Math.round(cl*0.43)?'follicular':cycleDay<=Math.round(cl*0.50)?'ovulatory':'luteal';
    const insights = {
      menstrual: 'Estrogen and progesterone are at their lowest. This explains fatigue, sensitivity, and the need for rest.',
      follicular: 'Estrogen is climbing — your energy, mood, and motivation are building with it.',
      ovulatory: `LH is ${level(lhVal).toLowerCase()} — triggering ovulation. Estrogen is peaking. You feel your best right now.`,
      luteal: 'Progesterone is dominant. You may feel calmer, more inward, or notice PMS as it rises then falls.',
      late: 'Both hormones have dropped. FSH is starting to rise in preparation for the next cycle.'
    };
    el.innerHTML = `<strong>Day ${cycleDay}${cycleDay>cl?` (+${cycleDay-cl}d late)`:''}:</strong> Estrogen <strong>${level(eVal)}</strong> · Progesterone <strong>${level(pVal)}</strong> · LH <strong>${level(lhVal)}</strong><br><span style="opacity:0.85">${insights[phase]||''}</span>`;
  },

  _setLevelBadge(id, val, level, slug) {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = level(val);
    badge.className = `hormone-level lvl-${slug(val)}`;
  }
};

// ─── HELPER: CYCLE WHEEL ──────────────────────────────────────────────────────

const CycleWheel = {
  draw(canvasId, state, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx=140, cy=140, r=110, innerR=60;
    const cl = state.cycleLength || config.cycle.defaultLength;
    const pd = state.periodDuration || config.cycle.periodDuration;
    ctx.clearRect(0, 0, 280, 280);

    const phases = [
      { name:'Menstrual',  days:pd,                          color:'#f4a0b5' },
      { name:'Follicular', days:Math.round(cl*0.33),         color:'#c9b8e8' },
      { name:'Ovulatory',  days:Math.round(cl*0.10),         color:'#f5c842' },
      { name:'Luteal',     days:cl-pd-Math.round(cl*0.33)-Math.round(cl*0.10), color:'#b39ddb' }
    ];

    let angle = -Math.PI/2;
    phases.forEach(ph => {
      const sweep = (ph.days/cl)*Math.PI*2;
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,angle,angle+sweep); ctx.closePath();
      ctx.fillStyle=ph.color+'99'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      const mid = angle+sweep/2;
      ctx.fillStyle='#2d1f4e'; ctx.font='bold 9px Georgia'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(ph.name, cx+r*0.72*Math.cos(mid), cy+r*0.72*Math.sin(mid));
      ctx.font='8px Georgia';
      ctx.fillText(ph.days+'d', cx+r*0.72*Math.cos(mid), cy+r*0.72*Math.sin(mid)+11);
      angle+=sweep;
    });

    ctx.beginPath(); ctx.arc(cx,cy,innerR,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fill();

    if (state.periodStart) {
      const engine = { cycleDay: (() => {
        const s=new Date(state.periodStart), t=new Date(); s.setHours(0,0,0,0); t.setHours(0,0,0,0);
        return Math.floor((t-s)/86400000)+1;
      })() };
      const cd = engine.cycleDay;
      const isLate = cd > cl;
      const dotDay = isLate ? cl : cd;
      const ta = -Math.PI/2+((dotDay-1)/cl)*Math.PI*2;
      ctx.beginPath(); ctx.arc(cx+r*Math.cos(ta), cy+r*Math.sin(ta), 8, 0, Math.PI*2);
      ctx.fillStyle = isLate?'#d4af5a':'#7c5cbf'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle='#2d1f4e'; ctx.font='bold 20px Georgia'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(isLate?`+${cd-cl}d late`:`Day ${cd}`, cx, cy-8);
      ctx.font='11px Georgia'; ctx.fillStyle=isLate?'#9a7a30':'#7b6fa0';
      const phaseLabels={menstrual:'Menstrual',follicular:'Follicular',ovulatory:'Ovulatory',luteal:'Luteal',late:'Running Late'};
      const ph = cd<=pd?'menstrual':cd<=Math.round(cl*0.43)?'follicular':cd<=Math.round(cl*0.5)?'ovulatory':cd>cl?'late':'luteal';
      ctx.fillText(phaseLabels[ph]||'', cx, cy+12);
    }
  }
};

// ─── HELPER: FAST CLOCK ───────────────────────────────────────────────────────

const FastClock = {
  _timer: null,

  start(startMs, goalHours, milestones) {
    this._show(true);
    this._update(startMs, goalHours, milestones);
    this._timer = setInterval(() => this._update(startMs, goalHours, milestones), 1000);
  },

  restore({ startMs, goalHours }, milestones) {
    this._show(true);
    this._update(startMs, goalHours, milestones);
    this._timer = setInterval(() => this._update(startMs, goalHours, milestones), 1000);
  },

  reset() {
    clearInterval(this._timer);
    this._show(false);
  },

  _show(active) {
    const sp = document.getElementById('fast-start-panel');
    const cp = document.getElementById('fast-clock-panel');
    if (sp) sp.style.display = active ? 'none' : 'block';
    if (cp) cp.style.display = active ? 'block' : 'none';
  },

  _update(startMs, goalHours, milestones) {
    const elapsed = (Date.now() - startMs) / 3_600_000;
    const hh = Math.floor(elapsed), mm = Math.floor((elapsed%1)*60), ss = Math.floor(((elapsed*60)%1)*60);
    const display = document.getElementById('fast-time-display');
    if (display) display.textContent = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    const pct = Math.min(elapsed/goalHours, 1);
    const pctEl = document.getElementById('fast-pct');
    const barEl = document.getElementById('fast-bar');
    if (pctEl) pctEl.textContent = `${Math.round(pct*100)}%`;
    if (barEl) barEl.style.width = `${pct*100}%`;

    const reached = (milestones||[]).filter(m => elapsed >= m.hours);
    const current = reached[reached.length-1];
    const next    = (milestones||[]).find(m => elapsed < m.hours);
    const infoEl  = document.getElementById('fast-phase-info');
    if (infoEl && current) {
      infoEl.innerHTML = `
        <div style="font-size:0.7rem;letter-spacing:0.15em;color:var(--gold);margin-bottom:6px;">${current.label?.toUpperCase()}</div>
        <div style="font-size:1rem;color:#fff;font-weight:bold;margin-bottom:8px;">${elapsed >= goalHours ? 'Fast Complete 🌙' : current.label}</div>
        <div style="font-size:0.82rem;color:var(--text-soft);line-height:1.6;">${current.bio}</div>
        ${next ? `<div style="font-size:0.72rem;color:var(--gold);margin-top:10px">Next: ${next.label} at ${next.hours}h</div>` : ''}
      `;
    }
    if (elapsed >= goalHours) clearInterval(this._timer);
  }
};

// ─── MODULE REGISTRY ──────────────────────────────────────────────────────────

const MODULE_REGISTRY = {
  today:    TodayModule,
  cycle:    CycleModule,
  energy:   CycleModule,   // menopausal alias
  nourish:  NourishModule,
  insights: InsightsModule,
  calendar: CalendarModule,
  settings: SettingsModule
};

// ─── DEMO PROFILES ────────────────────────────────────────────────────────────
// Pre-filled "as if already set up" data for each public demo archetype, applied
// in-memory only (never persisted beyond localStorage for that demo config id,
// never derived from any real person's data) so the demo shows what Lunarly
// actually does instead of an empty first-run state.

const DEMO_PROFILES = {
  'demo-urban-athlete': {
    primaryMovement:     { name: 'Pole / Strength', description: '', sessionsPerWeek: 4, preferredTime: 'evening' },
    primaryIntellectual: { name: 'Deep work / learning', description: '', sessionsPerWeek: 4, preferredTime: 'morning' },
    healthBaseline: { energyScore: 68, sleepScore: 72, physicalRecovery: 62, mentalRecovery: 66 }
  },
  'menopausal-archetype': {
    primaryMovement:     { name: 'Walking', description: '', sessionsPerWeek: 2, preferredTime: 'morning' },
    primaryIntellectual: { name: 'Singing / riyaz', description: '', sessionsPerWeek: 3, preferredTime: 'evening' },
    healthBaseline: { energyScore: 52, sleepScore: 58, physicalRecovery: 48, mentalRecovery: 62 },
    energyPattern: 'morning',
    topSymptoms: ['Low iron / fatigue', 'Joint stiffness', 'Poor sleep'],
    dietPreferences: ['Vegetarian', 'Iron-rich'],
    demoCheckin: { energyState: 'moderate', symptoms: ['Low iron / fatigue', 'Joint stiffness'] }
  }
};

// ─── MAIN APP ─────────────────────────────────────────────────────────────────

class MoonCycleApp {
  constructor() {
    this.config      = null;
    this.state       = null;
    this.phaseEngine = null;
    this._stateManager = null;
    this.activeTabId = null;
    this._modules    = {};
  }

  async init(configId, isDemo = false) {
    this._isDemo = isDemo;
    if (isDemo && !configId) configId = 'demo-urban-athlete';
    configId = configId || this._getSavedConfigId() || 'demo-urban-athlete';
    this.config = await loadConfig(configId);
    this._stateManager = new StateManager(configId);
    this.state = this._stateManager.load();

    // Demo mode: pre-fill in-memory only, per archetype — never reads or writes personal data,
    // and never overwrites anything the visitor already changed themselves this browser session.
    if (isDemo) {
      const profile = DEMO_PROFILES[configId] || DEMO_PROFILES['demo-urban-athlete'];
      if (this.config.cycle.type === 'menstrual') {
        const demoStart = new Date();
        demoStart.setDate(demoStart.getDate() - 9);
        if (!this.state.periodStart) {
          this.state.periodStart    = demoStart.toISOString().split('T')[0];
          this.state.cycleLength    = 28;
          this.state.periodDuration = 5;
        }
      } else {
        const today = new Date().toISOString().split('T')[0];
        if (!this.state.todayCheckin || this.state.todayCheckin.date !== today) {
          this.state.todayCheckin = { date: today, ...(profile.demoCheckin || { energyState: 'moderate', symptoms: [] }) };
        }
        if (!this.state.energyPattern) this.state.energyPattern = profile.energyPattern || null;
        if (!this.state.topSymptoms?.length) this.state.topSymptoms = profile.topSymptoms || [];
      }
      if (!this.state.primaryMovement) this.state.primaryMovement = profile.primaryMovement || null;
      if (!this.state.primaryIntellectual) this.state.primaryIntellectual = profile.primaryIntellectual || null;
      if (!this.state.dietPreferences?.length) this.state.dietPreferences = profile.dietPreferences || [];
      if (!this.state.healthData.history.length && profile.healthBaseline) {
        this.state.healthData.history = this._generateDemoHealthHistory(profile.healthBaseline, profile);
      }
    }

    // Migrate defaults from config if state fields are null
    if (!this.state.cycleLength) this.state.cycleLength = this.config.cycle.defaultLength;
    if (!this.state.periodDuration) this.state.periodDuration = this.config.cycle.periodDuration;
    if (!this.state.cycleFocus) this.state.cycleFocus = this.config.activity?.defaultCycleFocus;

    this.phaseEngine = new PhaseEngine(this.config, this.state);
    this._applyTheme(this.config.meta.theme);
    this._buildHeader(this.config.meta.theme, isDemo);
    this._buildTabs(this.config.ui.tabs);
    localStorage.setItem('mcapp_activeConfig', configId);

    // Show default tab
    const defaultTab = this.config.ui.defaultTab || this.config.ui.tabs[0]?.id;
    this.switchTab(defaultTab);
  }

  async switchConfig(configId) {
    this._saveState();
    await this.init(configId, this._isDemo);
    this._updatePhaseBanner();
  }

  switchTab(tabId, forceRerender = false) {
    this.activeTabId = tabId;

    // Update tab button states
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Get or create module instance
    const ModuleClass = MODULE_REGISTRY[tabId];
    if (!ModuleClass) return;
    if (!this._modules[tabId]) this._modules[tabId] = new ModuleClass(this);
    const mod = this._modules[tabId];

    // Inject HTML
    const container = document.getElementById('module-container');
    if (container) {
      container.innerHTML = mod.render();
      mod.onMount();
    }
  }

  // ── Settings mutations ───────────────────────────────────────────────────────

  saveSettings() {
    const ps = document.getElementById('periodStart');
    const cl = document.getElementById('cycleLength');
    const pd = document.getElementById('periodDuration');
    const fe = document.getElementById('fastingEnabled');
    const dt = document.getElementById('dietType');
    if (ps) this.state.periodStart    = ps.value || null;
    if (cl) this.state.cycleLength    = parseInt(cl.value) || 35;
    if (pd) this.state.periodDuration = parseInt(pd.value) || 5;
    if (fe) this.state.fastingEnabled = fe.value !== 'no';
    if (dt) this.state.dietType       = dt.value;
    this.phaseEngine = new PhaseEngine(this.config, this.state);
    this._modules = {}; // force module re-render
    this._saveState();
    this._updatePhaseBanner();
    this.switchTab(this.activeTabId);
  }

  saveEnergyProfile() {
    const ep = document.getElementById('energyPattern');
    if (ep) this.state.energyPattern = ep.value;
    this._saveState();
  }

  toggleTopSymptom(s) {
    const list = this.state.topSymptoms || (this.state.topSymptoms = []);
    const idx = list.indexOf(s);
    if (idx >= 0) list.splice(idx, 1);
    else if (list.length < 3) list.push(s);
    this._saveState();
    this._modules = {};
    this.switchTab(this.activeTabId);
  }

  toggleDietPreference(d) {
    const list = this.state.dietPreferences || (this.state.dietPreferences = []);
    const idx = list.indexOf(d);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(d);
    this._saveState();
    this._modules = {};
    this.switchTab(this.activeTabId);
  }

  saveCycleFocus() {
    const el = document.getElementById('cycleFocus');
    if (el) this.state.cycleFocus = el.value;
    this._saveState();
    const focusEl = document.getElementById('focusNote');
    if (focusEl) {
      const opt = (this.config.activity?.cycleFocusOptions||[]).find(o=>o.value===this.state.cycleFocus);
      if (opt) focusEl.textContent = opt.note;
    }
  }

  savePrimaryMovement() {
    const nameEl = document.getElementById('primaryMovementName');
    const descEl = document.getElementById('primaryMovementDesc');
    const freqEl = document.getElementById('primaryMovementFreq');
    const timeEl = document.getElementById('primaryMovementTime');
    const name = nameEl?.value.trim();
    this.state.primaryMovement = name ? {
      name,
      description: descEl?.value.trim() || '',
      sessionsPerWeek: Math.min(7, Math.max(1, parseInt(freqEl?.value) || 3)),
      preferredTime: timeEl?.value || 'evening'
    } : null;
    this._saveState();
    this._modules = {}; // force re-render so Today/Calendar pick up the change
    this.switchTab(this.activeTabId);
  }

  savePrimaryIntellectual() {
    const nameEl = document.getElementById('primaryIntellectualName');
    const descEl = document.getElementById('primaryIntellectualDesc');
    const freqEl = document.getElementById('primaryIntellectualFreq');
    const timeEl = document.getElementById('primaryIntellectualTime');
    const name = nameEl?.value.trim();
    this.state.primaryIntellectual = name ? {
      name,
      description: descEl?.value.trim() || '',
      sessionsPerWeek: Math.min(7, Math.max(1, parseInt(freqEl?.value) || 4)),
      preferredTime: timeEl?.value || 'morning'
    } : null;
    this._saveState();
    this._modules = {}; // force re-render so Today/Calendar pick up the change
    this.switchTab(this.activeTabId);
  }

  /** Today's phase-mapped guidance for the user's primary movement, or null if not configured. */
  getPrimaryMovementGuidance() {
    return this._phaseGuidance(this.config.activity?.primaryMovementByPhase);
  }

  /** Today's phase-mapped guidance for the user's primary intellectual practice, or null if not configured. */
  getPrimaryIntellectualGuidance() {
    return this._phaseGuidance(this.config.activity?.primaryIntellectualByPhase);
  }

  _phaseGuidance(rules) {
    if (!rules) return null;
    let key = this.phaseEngine.current.key;
    if (key === 'late') key = 'luteal';
    return rules[key] || null;
  }

  /**
   * Builds the next 7 days as phase-aware slots for the user's primary movement +
   * intellectual practices. Picks the best `sessionsPerWeek` days for each practice
   * (ranked by phase intensity/load), so the Calendar tab only schedules real sessions
   * instead of hard-coding one per day.
   */
  buildWeeklyPlan() {
    const isMenstrual = this.config.cycle.type === 'menstrual';
    const cd = this.phaseEngine.cycleDay;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      let phaseKey;
      if (isMenstrual && cd) {
        const ph = this.phaseEngine.phaseForDay(cd + i);
        phaseKey = ph.key === 'late' ? 'luteal' : (ph.key || 'luteal');
      } else {
        // Energy model: no forward prediction, so every day uses today's check-in.
        phaseKey = this.phaseEngine.current.key || 'moderate';
      }
      days.push({ date: d, phaseKey });
    }

    const INTENSITY_ORDER = ['light', 'medium-low', 'medium', 'medium-high', 'high'];
    const LOAD_ORDER = ['low', 'medium-low', 'medium', 'medium-high', 'high'];

    const pickSlots = (rules, metricKey, order, sessionsPerWeek) => {
      const scored = days.map((day, idx) => {
        const r = rules[day.phaseKey];
        if (!r) return { idx, score: -1 };
        if (r.recommended === false) return { idx, score: -1 };
        return { idx, score: order.indexOf((r[metricKey] || '').toLowerCase()) + 1 };
      });
      scored.sort((a, b) => b.score - a.score);
      return new Set(scored.slice(0, sessionsPerWeek).map(s => s.idx));
    };

    const pm = this.state.primaryMovement;
    const pi = this.state.primaryIntellectual;
    const movementRules = this.config.activity?.primaryMovementByPhase || {};
    const intellectualRules = this.config.activity?.primaryIntellectualByPhase || {};
    const movementSlots = pm ? pickSlots(movementRules, 'intensity', INTENSITY_ORDER, pm.sessionsPerWeek || 3) : new Set();
    const intellectualSlots = pi ? pickSlots(intellectualRules, 'load', LOAD_ORDER, pi.sessionsPerWeek || 4) : new Set();

    return days.map((day, idx) => ({
      date: day.date,
      phaseKey: day.phaseKey,
      movement: (pm && movementSlots.has(idx)) ? { name: pm.name, time: pm.preferredTime, ...movementRules[day.phaseKey] } : null,
      intellectual: (pi && intellectualSlots.has(idx)) ? { name: pi.name, time: pi.preferredTime, ...intellectualRules[day.phaseKey] } : null
    }));
  }

  setEnergyState(key) {
    const today = new Date().toISOString().split('T')[0];
    this.state.todayCheckin = { date: today, energyState: key, symptoms: this.state.todayCheckin?.symptoms || [] };
    this._upsertHealthHistory(today, { energyState: key });
    this.phaseEngine = new PhaseEngine(this.config, this.state);
    this._modules = {};
    this._saveState();
    this._updatePhaseBanner();
    this.switchTab(this.activeTabId);
  }

  toggleSymptom(s) {
    const checkin = this.state.todayCheckin || { date: new Date().toISOString().split('T')[0], energyState: 'moderate', symptoms: [] };
    const idx = checkin.symptoms.indexOf(s);
    if (idx >= 0) checkin.symptoms.splice(idx, 1);
    else checkin.symptoms.push(s);
    this.state.todayCheckin = checkin;
    this._upsertHealthHistory(checkin.date, { symptoms: [...checkin.symptoms] });
    this._saveState();
    this.switchTab(this.activeTabId);
  }

  /** Which phase/energy-state a history entry represents — from its own logged energyState
   *  (energy-model archetypes) or computed from its date (menstrual archetypes). Unifies both
   *  data sources so Insights can group "average energy by phase" the same way either archetype. */
  _historyPhaseKey(entry) {
    if (this.config.cycle.type !== 'menstrual') return entry.energyState || null;
    return HabitsEngine._phaseForDate(entry.date, this.state, this.config);
  }

  // ── Fast clock ───────────────────────────────────────────────────────────────

  startFastClock() {
    const startInput = document.getElementById('fast-start-input');
    const goalBtn    = document.querySelector('.fast-goal-btn.active');
    const startMs    = startInput?.value ? new Date(startInput.value).getTime() : Date.now();
    const goalHours  = parseInt(goalBtn?.dataset.hours || '16');
    this.state.fastClock = { startMs, goalHours };
    this._saveState();
    FastClock.start(startMs, goalHours, this.config.fasting?.milestones || []);
  }

  resetFastClock() {
    this.state.fastClock = null;
    this._saveState();
    FastClock.reset();
  }

  // ── CSV parsing ──────────────────────────────────────────────────────────────

  parseHealthCSV(input, type) {
    const file = input.files[0]; if (!file) return;
    const typeConfig = this.config.wearables?.csvTypes?.[type];
    if (!typeConfig) return;
    const statusEl = document.getElementById(`status-${type}`);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = this._parseCSVRows(e.target.result);
        rows.sort((a, b) => new Date(b[typeConfig.fields.timestamp] || 0) - new Date(a[typeConfig.fields.timestamp] || 0));

        if (type === 'cycle') {
          const latest = rows[0];
          if (latest?.[typeConfig.fields.timestamp]) {
            const dateStr = latest[typeConfig.fields.timestamp].split(' ')[0];
            if (!this.state.periodStart) {
              this.state.periodStart = dateStr;
              const el = document.getElementById('periodStart');
              if (el) el.value = dateStr;
            }
          }
          if (statusEl) statusEl.textContent = `✓ Loaded successfully`;
        } else {
          let daysLoaded = 0;
          rows.forEach(r => {
            const ts = r[typeConfig.fields.timestamp];
            if (!ts) return;
            const date = ts.split(' ')[0].split('T')[0];
            const fields = {};
            Object.entries(typeConfig.fields).forEach(([stateKey, csvKey]) => {
              if (stateKey === 'timestamp') return;
              const val = parseFloat(r[csvKey]);
              if (!isNaN(val) && val > 0) fields[stateKey] = val;
            });
            if (Object.keys(fields).length) { this._upsertHealthHistory(date, fields); daysLoaded++; }
          });
          this.state.healthData.lastUpdated = new Date().toISOString();
          if (statusEl) statusEl.textContent = `✓ Loaded ${daysLoaded} days of data`;
        }

        this._saveState();
        // Refresh today tab rings if visible
        if (this.activeTabId === 'today') this.switchTab('today');
      } catch(err) {
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      }
    };
    reader.readAsText(file);
  }

  // ── Health history: prediction + manual entry ─────────────────────────────────

  /** ~2 weeks of demo body-stat history wiggling around a baseline, so the demo's Today rings
   *  show a believable recent trend and Insights has enough spread to chart something real —
   *  instead of one flat repeated number or an empty tab. */
  _generateDemoHealthHistory(baseline, profile) {
    const wiggle = (dateStr, seed) => {
      let h = 0;
      const s = dateStr + seed;
      for (let c = 0; c < s.length; c++) h = (Math.imul(31, h) + s.charCodeAt(c)) | 0;
      return ((h >>> 0) % 25) - 12; // -12..+12
    };
    const clamp = v => Math.max(15, Math.min(95, Math.round(v)));
    const isEnergyModel = this.config.cycle.type !== 'menstrual';
    const history = [];
    const today = new Date();
    for (let i = 14; i >= 1; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const energyScore = clamp(baseline.energyScore + wiggle(dateStr, 'e'));
      const entry = {
        date: dateStr,
        energyScore,
        sleepScore:        clamp(baseline.sleepScore        + wiggle(dateStr, 's')),
        physicalRecovery: clamp(baseline.physicalRecovery + wiggle(dateStr, 'p')),
        mentalRecovery:    clamp(baseline.mentalRecovery    + wiggle(dateStr, 'm'))
      };
      if (isEnergyModel) {
        entry.energyState = energyScore >= 62 ? 'high' : energyScore < 45 ? 'low' : 'moderate';
        if (entry.energyState === 'low' && profile?.topSymptoms?.length) {
          entry.symptoms = profile.topSymptoms.slice(0, 2);
        }
      }
      history.push(entry);
    }
    return history;
  }

  /** Upsert a day's health metrics into history, keyed by date (merges fields, doesn't overwrite unrelated keys). */
  _upsertHealthHistory(date, fields) {
    const history = this.state.healthData.history || (this.state.healthData.history = []);
    let entry = history.find(e => e.date === date);
    if (!entry) { entry = { date }; history.push(entry); }
    Object.assign(entry, fields);
    history.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Returns today's value for a health metric so a number is always shown:
   * today's actual entry if logged, otherwise a prediction averaged from the
   * last 7 days that have data, otherwise a starting baseline if there's no
   * history at all yet for this metric.
   * Shape: { value: number, predicted: boolean, baseline?: boolean }
   */
  getHealthStat(key) {
    const BASELINE = { energyScore: 65, sleepScore: 70, physicalRecovery: 60, mentalRecovery: 65 };
    const history = this.state.healthData?.history || [];
    const today = new Date().toISOString().split('T')[0];
    const todayEntry = history.find(e => e.date === today);
    if (todayEntry && todayEntry[key] != null) return { value: todayEntry[key], predicted: false };

    const recent = history
      .filter(e => e.date !== today && e[key] != null)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);
    if (recent.length) {
      const avg = recent.reduce((sum, e) => sum + e[key], 0) / recent.length;
      return { value: avg, predicted: true };
    }
    return { value: BASELINE[key] ?? 65, predicted: true, baseline: true };
  }

  /** Save whatever the user typed into the "Log today's numbers" form as today's real entry. */
  saveManualHealthEntry() {
    const ids = { energy: 'energyScore', sleep: 'sleepScore', phys: 'physicalRecovery', mental: 'mentalRecovery' };
    const today = new Date().toISOString().split('T')[0];
    const fields = {};
    Object.entries(ids).forEach(([id, key]) => {
      const el = document.getElementById(`manual-${id}`);
      if (el && el.value !== '') {
        const val = Math.max(0, Math.min(100, parseFloat(el.value)));
        if (!isNaN(val)) fields[key] = val;
      }
    });
    if (!Object.keys(fields).length) return;
    this._upsertHealthHistory(today, { ...fields, manual: true });
    this.state.healthData.lastUpdated = new Date().toISOString();
    this._saveState();
    if (this.activeTabId === 'today') this.switchTab('today');
  }

  parseHabitsCSV(input) {
    const file = input.files[0]; if (!file) return;
    const statusEl = document.getElementById('habitsStatus');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = HabitsEngine.parse(e.target.result, this.config.habits?.tracked || []);
        this.state.habitsData = data;
        this._saveState();
        if (statusEl) statusEl.textContent = `✓ Loaded ${data.length} days of data`;
        const notice = document.getElementById('demoDataNotice');
        if (notice) notice.style.display = 'none';
        HabitsEngine.renderAll(data, this.state, this.config);
      } catch(err) {
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      }
    };
    reader.readAsText(file);
  }

  // ── Google Calendar (preview only — no real sync yet) ──────────────────────────

  /** Shows what pushing this week's plan to Google Calendar would look like — same weekly
   *  plan data as the ClickUp sync, formatted as a list of would-be calendar events. */
  previewGoogleCalendar() {
    const el = document.getElementById('gcalPreview');
    if (!el) return;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const timeRange = { morning: '7–8 AM', afternoon: '1–2 PM', evening: '6–7 PM' };
    const plan = this.buildWeeklyPlan();

    const events = [];
    plan.forEach(day => {
      const dayLabel = dayNames[day.date.getDay()];
      if (day.movement) events.push({ day: dayLabel, time: timeRange[day.movement.time] || 'TBD', label: `Primary movement (${day.movement.name})` });
      if (day.intellectual) events.push({ day: dayLabel, time: timeRange[day.intellectual.time] || 'TBD', label: `Focus block (${day.intellectual.name})` });
    });

    if (!events.length) {
      el.innerHTML = `<p style="font-size:0.8rem;color:var(--text-soft);">Set your primary movement and intellectual practices in Settings to preview events.</p>`;
    } else {
      el.innerHTML = `
        <div style="font-size:0.72rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--gold-light);margin-bottom:10px;">Preview calendar events</div>
        ${events.map(e => `
          <div class="session-row">
            <div class="session-time">${e.day}</div>
            <div class="session-detail">${e.time}: ${e.label}</div>
          </div>`).join('')}
      `;
    }
    el.style.display = 'block';
    this._showGcalModal();
  }

  /** "Not live yet" CTA modal — turns the click into a warm sales lead instead of a dead end. */
  _showGcalModal() {
    document.getElementById('gcalModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'gcalModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-box">
        <h3>Google Calendar sync isn't live yet</h3>
        <p>In the full version, this will push your Lunarly movement and focus blocks into your Google Calendar. If you want this working for your life or your clients today, email Sanyuja to get a personalized Lunarly setup with Google Calendar wired in.</p>
        <div class="modal-actions">
          <a class="modal-btn-primary" href="mailto:sanyujadesai@gmail.com?subject=Lunarly%20setup%20with%20Google%20Calendar">Email Sanyuja</a>
          <button class="modal-btn-secondary" onclick="document.getElementById('gcalModal').remove()">Close</button>
        </div>
      </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }

  // ── ClickUp sync ──────────────────────────────────────────────────────────────

  /** Pushes this week's phase-aware movement + intellectual sessions as generic ClickUp tasks. */
  async syncWeeklyPlan() {
    const cu = this.config.integrations?.clickup;
    if (!cu?.enabled) return;
    const token = this.state.clickupToken;
    const log   = document.getElementById('syncLog');
    if (!log) return;
    log.style.display = 'block';
    if (!token) { log.textContent = '❌ Paste your pk_ API token first.'; return; }
    if (!this.state.primaryMovement && !this.state.primaryIntellectual) { log.textContent = '❌ Set a primary movement or intellectual practice in Settings first.'; return; }

    const wl = cu.lists?.workouts;
    if (!wl) { log.textContent = '❌ No ClickUp list configured for this archetype.'; return; }
    log.textContent = 'Verifying token & list...\n';
    const check = await fetch(`https://api.clickup.com/api/v2/list/${wl.id}`, { headers: { Authorization: token } });
    const checkData = await check.json();
    if (!check.ok) { log.textContent += `❌ ${check.status}: ${checkData.err || 'Error'}`; return; }
    log.textContent += `✓ Connected to: "${checkData.name}"\nCreating tasks...\n`;

    const windowFor = (pref) => {
      const AM = cu.schedule?.workouts?.AM || { startHour: 7, endHour: 9 };
      const PM = cu.schedule?.workouts?.PM || { startHour: 17, endHour: 19 };
      if (pref === 'morning') return AM;
      if (pref === 'afternoon') return { startHour: 12, endHour: 14 };
      return PM;
    };

    const plan = this.buildWeeklyPlan();
    let ok = 0, err = 0;

    for (const day of plan) {
      const sessions = [
        day.movement ? { kind: 'Movement', session: day.movement } : null,
        day.intellectual ? { kind: 'Focus', session: day.intellectual } : null
      ].filter(Boolean);

      for (const { kind, session } of sessions) {
        const win = windowFor(session.time);
        const startMs = new Date(day.date).setHours(win.startHour, 0, 0, 0);
        const dueMs   = new Date(day.date).setHours(win.endHour, 0, 0, 0);
        const metric  = session.intensity || session.load || '';
        const body = {
          name: `${kind}: ${session.name}${metric ? ` (${metric})` : ''}`,
          description: `Phase: ${day.phaseKey}\n${session.note || ''}`,
          status: wl.status, start_date: startMs, start_date_time: true, due_date: dueMs, due_date_time: true,
          assignees: [wl.assigneeId], tags: [day.phaseKey, kind.toLowerCase()]
        };
        const res = await fetch(`https://api.clickup.com/api/v2/list/${wl.id}/task`, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { ok++; log.textContent += `✓ ${kind} — ${day.date.toLocaleDateString()}\n`; }
        else { err++; const e = await res.json(); log.textContent += `✗ ${kind} — ${day.date.toLocaleDateString()}: ${e.err || res.status}\n`; }
      }
    }
    log.textContent += `\nDone. ${ok} created, ${err} errors.`;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  _getSavedConfigId() {
    return localStorage.getItem('mcapp_activeConfig');
  }

  _saveState() {
    this._stateManager?.save(this.state);
  }

  _hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 212, g: 175, b: 90 };
  }

  _hexToRgba(hex, alpha) {
    const { r, g, b } = this._hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  _lighten(hex, amt) {
    const { r, g, b } = this._hexToRgb(hex);
    const mix = (c) => Math.round(c + (255 - c) * amt);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  _applyTheme(theme) {
    const root = document.documentElement;
    const gold = theme.goldColor || '#d4af5a';
    root.style.setProperty('--primary',    theme.primaryColor || '#c9b8e8');
    root.style.setProperty('--accent',     theme.accentColor || '#7c5cbf');
    root.style.setProperty('--gold',       gold);
    root.style.setProperty('--gold-light', theme.goldLightColor || this._lighten(gold, 0.35));
    root.style.setProperty('--gold-glow',  this._hexToRgba(gold, 0.35));
    root.style.setProperty('--card-border',this._hexToRgba(gold, 0.16));
    root.style.setProperty('--rose',       theme.roseColor || '#f4a0b5');
    root.style.setProperty('--teal',       theme.tealColor || '#80cbc4');
    root.style.setProperty('--text',       theme.textColor || '#e0d4f7');
    root.style.setProperty('--text-soft',  theme.textSoft || '#b8aad4');
    root.style.setProperty('--card',       theme.cardBackground || 'rgba(255,255,255,0.09)');
    root.style.setProperty('--bg',         theme.background);

    // Display serif for brand/headings; clean sans for everything else (readability)
    root.style.setProperty('--font-display', `'${theme.font}', Georgia, serif`);
    root.style.setProperty('--font-body',    `'${theme.bodyFont || 'Inter'}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`);
    root.style.setProperty('--font',         'var(--font-body)');
    document.body.style.background = theme.background;

    // Load Google Font dynamically
    if (theme.fontUrl && !document.getElementById('app-font')) {
      const link = Object.assign(document.createElement('link'), { id:'app-font', rel:'stylesheet', href:theme.fontUrl });
      document.head.appendChild(link);
    }

    // Stars background
    document.body.dataset.stars = theme.stars ? 'true' : 'false';
  }

  _buildHeader(theme, isDemo = false) {
    const h = document.getElementById('app-header');
    if (!h) return;
    h.innerHTML = `
      ${theme.logo ? `<img src="${theme.logo}" alt="Lunarly logo" class="header-logo"/>` : `<div class="moon-icon">🌙</div>`}
      <h1>Lunarly</h1>
      ${theme.edition ? `<div class="edition">${theme.edition}</div>` : ''}
      <div class="subtitle">${theme.appSubtitle || ''}</div>
    `;

    const navBrand = document.getElementById('navBrand');
    if (navBrand) navBrand.textContent = theme.edition ? `Lunarly · ${theme.edition}` : 'Lunarly';

    const aboutLogo = document.getElementById('aboutLogo');
    if (aboutLogo && theme.logo) aboutLogo.src = theme.logo;

    // Demo banner — injected once after the header, removed if demo flag is cleared
    const existing = document.getElementById('demoBanner');
    if (isDemo && !existing) {
      const banner = document.createElement('div');
      banner.id = 'demoBanner';
      banner.style.cssText = 'background:rgba(212,175,90,0.12);border-bottom:1px solid rgba(212,175,90,0.3);padding:9px 20px;text-align:center;font-size:0.77rem;color:#d4af5a;letter-spacing:0.04em;';
      banner.innerHTML = '✦ Demo — generic phase shown. Your personal data never leaves your browser.';
      h.insertAdjacentElement('afterend', banner);
    } else if (!isDemo && existing) {
      existing.remove();
    }
  }

  _buildTabs(tabs) {
    const container = document.getElementById('tabs-container');
    if (!container) return;
    container.innerHTML = tabs.map(tab =>
      `<button class="tab-btn" data-tab="${tab.id}" onclick="app.switchTab('${tab.id}')">${tab.label}</button>`
    ).join('');
  }

  _updatePhaseBanner() {
    const ph = this.phaseEngine.current;
    const banner = document.getElementById('phaseBanner');
    if (!banner) return;

    // First-time (no cycle configured yet) — prominent "start here" CTA instead of the compact phase banner.
    if (ph.key === null) {
      banner.className = 'setup-card';
      banner.innerHTML = `
        <div class="setup-icon">${ph.icon || '🌑'}</div>
        <h2>Start here: Set up your cycle</h2>
        <p class="setup-why">Once you enter your last period date, Lunarly can calculate phases and personalize everything.</p>
        <button class="setup-btn" onclick="app.switchTab('settings')">Open Settings</button>
      `;
      return;
    }

    let dayText;
    if (this.config.cycle.type === 'menstrual') {
      const cd = this.phaseEngine.cycleDay;
      const cl = this.state.cycleLength;
      dayText = ph.isLate
        ? `${cd-cl} DAY${cd-cl>1?'S':''} LATE — AVG CYCLE ${cl} DAYS`
        : `CYCLE DAY ${cd} OF ${cl}`;
    } else {
      dayText = ph.label?.toUpperCase() || '';
    }

    banner.className = `phase-banner ${ph.colorClass || ''}`;
    banner.innerHTML = `
      <div class="phase-icon" id="phaseIcon">${ph.icon || '🌙'}</div>
      <div class="phase-info">
        <h2 id="phaseName">${ph.label || 'Cycle Planner'}</h2>
        <div class="phase-day" id="phaseDay">${dayText}</div>
        <div class="phase-desc" id="phaseDesc">${ph.desc || ''}</div>
      </div>
    `;
  }

  _parseCSVRows(text) {
    const lines = text.replace(/^﻿/, '').split('\n');
    const headerLine = 1;
    const headers = lines[headerLine]?.split(',').map(h => h.trim()) || [];
    const rows = [];
    for (let i = headerLine+1; i < lines.length; i++) {
      if (!lines[i]?.trim()) continue;
      const vals = lines[i].split(',');
      const row = {};
      headers.forEach((h, idx) => { row[h] = (vals[idx]||'').trim(); });
      rows.push(row);
    }
    return rows;
  }
}

// ─── HABITS ENGINE ──────────────────────────────────────────────────────────
// Turns an uploaded Checkmarks.csv into streaks, a heatmap, phase correlation,
// and a wellness trend. Never leaves a card looking empty: any day without a
// logged value is filled in from that habit's historical base rate rather
// than rendered as a gap, the same "predict from history" approach used for
// Today's Body Stats.

const HabitsEngine = {
  _hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    const { r, g, b } = m ? { r: parseInt(m[1],16), g: parseInt(m[2],16), b: parseInt(m[3],16) } : { r: 201, g: 184, b: 232 };
    return `rgba(${r},${g},${b},${alpha})`;
  },

  /** Small deterministic string-seeded PRNG — same inputs always produce the same demo data. */
  _seededRandom(seedStr) {
    let h = 0;
    for (let i=0; i<seedStr.length; i++) h = (Math.imul(31, h) + seedStr.charCodeAt(i)) | 0;
    return () => {
      h = Math.imul(h ^ (h >>> 15), h | 1);
      h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
      return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
    };
  },

  // Curated, presentable habit lists for the demo — deliberately NOT the maintainer's real
  // config.habits.tracked list. One set per public archetype, so each demo's Insights tab
  // reflects what that persona would actually track. Anyone's real upload still uses their
  // own config's habits regardless of these.
  _demoHabits: ['Strength Training', 'Yoga', 'Sugar', 'Alcohol', 'Protein', 'Salad', 'Read', 'Fast', 'Dry brush'],
  _demoWellness: ['Strength Training', 'Yoga', 'Protein', 'Salad', 'Read', 'Fast', 'Dry brush'],
  _demoLimit: ['Sugar', 'Alcohol'],
  // Per-habit target completion rate overrides — Alcohol should read as occasional, not a habit.
  _demoRateOverrides: { 'Alcohol': 0.08 },

  _demoHabitsMenopausal: ['Walk', 'Riyaz (singing)', 'Iron-rich meal', 'Calcium', 'Sleep 7h+', 'Meditation', 'Stretching', 'Tea after meals'],
  _demoWellnessMenopausal: ['Walk', 'Riyaz (singing)', 'Iron-rich meal', 'Calcium', 'Sleep 7h+', 'Stretching'],
  _demoLimitMenopausal: ['Tea after meals'],
  _demoRateOverridesMenopausal: { 'Tea after meals': 0.25 },

  /**
   * Deterministic, purely synthetic habit log used only when nothing has been uploaded yet —
   * so the Insights tab shows what it looks like instead of sitting empty. Never derived from
   * or containing any real personal data.
   */
  generateSeedData(days = 45, habits = this._demoHabits, rateOverrides = this._demoRateOverrides) {
    const habitRate = {};
    habits.forEach(h => {
      const override = rateOverrides[h];
      habitRate[h] = override != null ? override : 0.35 + this._seededRandom('rate:'+h)() * 0.5;
    });
    const data = [];
    const today = new Date();
    for (let i = days-1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate()-i);
      const dateStr = d.toISOString().split('T')[0];
      const row = { Date: dateStr };
      habits.forEach(h => {
        const r = this._seededRandom('day:'+h+':'+dateStr)();
        row[h] = r < 0.08 ? 'UNKNOWN' : (r < habitRate[h] + 0.08 ? 'YES_MANUAL' : 'NO');
      });
      data.push(row);
    }
    return data;
  },

  parse(csvText, trackedHabits) {
    // Parse Checkmarks CSV format: date column + one column per habit
    const lines = csvText.replace(/^﻿/,'').split('\n').filter(l=>l.trim());
    const headers = lines[0].split(',').map(h=>h.trim().replace(/"/g,''));
    const data = [];
    for (let i=1; i<lines.length; i++) {
      const vals = lines[i].split(',').map(v=>v.trim().replace(/"/g,''));
      const row = {};
      headers.forEach((h,idx) => { row[h]=vals[idx]||''; });
      data.push(row);
    }
    return data;
  },

  // ── Value / column normalization ──────────────────────────────────────────

  /** "YES_MANUAL"/positive number -> true, "NO" -> false, "UNKNOWN"/blank -> null (not logged). */
  _valueToState(v) {
    if (v === 'YES_MANUAL') return true;
    if (v === 'NO') return false;
    if (v == null || v === '' || v === 'UNKNOWN') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : n > 0;
  },

  _normalizeKey(s) { return (s || '').toLowerCase().replace(/[^a-z]/g, ''); },

  /** CSV headers carry emoji/decoration ("Alcohol 🍸", "🥗 salad") — match loosely against config habit names. */
  _findColumn(row, habitName) {
    const target = this._normalizeKey(habitName);
    if (!target) return null;
    return Object.keys(row).find(k => {
      const nk = this._normalizeKey(k);
      return nk && (nk.includes(target) || target.includes(nk));
    }) || null;
  },

  _dateKey(row) { return (row.Date || row.date || '').trim(); },

  /** { columnMap: {habit: csvHeader}, byDate: {dateStr: {habit: true|false|null}}, dates: [sorted desc] } */
  _buildDayMap(data, trackedHabits) {
    const columnMap = {};
    if (data.length) trackedHabits.forEach(h => { columnMap[h] = this._findColumn(data[0], h); });
    const byDate = {};
    data.forEach(row => {
      const date = this._dateKey(row);
      if (!date) return;
      const states = {};
      trackedHabits.forEach(h => {
        const col = columnMap[h];
        states[h] = col ? this._valueToState(row[col]) : null;
      });
      byDate[date] = states;
    });
    const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));
    return { columnMap, byDate, dates };
  },

  /** Overall completion rate for a habit across all logged (non-null) days — the fallback for unlogged days. */
  _baseRate(byDate, dates, habit) {
    let yes=0, known=0;
    dates.forEach(d => { const v = byDate[d][habit]; if (v !== null) { known++; if (v) yes++; } });
    return known ? yes/known : 0.5; // no data anywhere yet — neutral 50/50 guess
  },

  /** Which cycle phase a historical date fell in, given the CURRENT periodStart/cycleLength (best-effort, modular). */
  _phaseForDate(dateStr, state, config) {
    if (!state.periodStart) return null;
    const cl = state.cycleLength || config.cycle.defaultLength;
    const pd = state.periodDuration || config.cycle.periodDuration;
    const start = new Date(state.periodStart); start.setHours(0,0,0,0);
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    if (isNaN(d.getTime())) return null;
    const diffDays = Math.floor((d - start) / 86400000);
    const cycleDay = ((diffDays % cl) + cl) % cl + 1;
    const ovuStart = Math.round(cl*0.43), ovuEnd = Math.round(cl*0.50);
    if (cycleDay <= pd) return 'menstrual';
    if (cycleDay < ovuStart) return 'follicular';
    if (cycleDay <= ovuEnd) return 'ovulatory';
    return 'luteal';
  },

  /** Which energy state was logged for a historical date, from the unified healthData.history
   *  (set by setEnergyState() at check-in time) — the energy-model equivalent of _phaseForDate. */
  _energyStateForDate(dateStr, state) {
    return (state.healthData?.history || []).find(e => e.date === dateStr)?.energyState || null;
  },

  /** Unified "what bucket did this date fall into" lookup — cycle phase for menstrual archetypes,
   *  logged energy state for energy-model archetypes. Every habit-correlation function should go
   *  through this instead of calling _phaseForDate directly, so it works for both archetype kinds. */
  _phaseKeyForDate(dateStr, state, config) {
    return config.cycle.type === 'menstrual' ? this._phaseForDate(dateStr, state, config) : this._energyStateForDate(dateStr, state);
  },

  /** Ordered list of { key, label, color } buckets to correlate habits against — the four cycle
   *  phases for menstrual archetypes, or the archetype's own energy states (high/moderate/low,
   *  in whatever order the config defines) for energy-model archetypes. Colors come straight from
   *  config so this never hardcodes an archetype-specific palette. */
  _phaseList(config) {
    if (config.cycle.type === 'menstrual') {
      const p = config.cycle.phases || {};
      return ['menstrual','follicular','ovulatory','luteal'].filter(k => p[k]).map(k => ({ key: k, label: p[k].shortLabel || p[k].label || k, color: p[k].color || '#c9b8e8' }));
    }
    const states = config.cycle.energyModel?.states || {};
    return Object.entries(states).map(([key, s]) => ({ key, label: s.shortLabel || s.label || key, color: s.color || '#c9b8e8' }));
  },

  renderAll(data, state, config) {
    const trackedHabits = config.habits?.tracked || [];
    const { byDate, dates } = this._buildDayMap(data, trackedHabits);
    if (!dates.length) return;

    ['streakCard','heatmapCard','phaseCorrelCard','wellnessCard'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'block';
    });
    const patternEl = document.getElementById('patternInsights');
    if (patternEl) patternEl.style.display = 'block';

    const limitHabits = config.habits?.limit || [];
    this._renderStreaks(byDate, dates, trackedHabits, limitHabits);
    this._renderHeatmap(byDate, dates, trackedHabits, state, config);
    this._renderPhaseCorrelation(byDate, dates, trackedHabits, state, config);
    this._renderWellness(byDate, dates, config);
    this._renderPatternInsights(byDate, dates, trackedHabits, limitHabits, state, config);
  },

  // ── Streaks ────────────────────────────────────────────────────────────────

  _renderStreaks(byDate, dates, trackedHabits, limitHabits) {
    const grid = document.getElementById('streakGrid');
    if (!grid) return;
    grid.innerHTML = trackedHabits.map(h => {
      const isLimit = limitHabits.includes(h);
      // For habits you're trying to do LESS of (Alcohol, Sugar...), a "streak" of doing them
      // isn't a win — count consecutive days WITHOUT it instead, framed as clear/clean days.
      let streak = 0;
      for (const d of dates) {
        const v = byDate[d][h];
        if (isLimit ? v === false : v === true) streak++;
        else break; // opposite value or null (unlogged) ends the current streak
      }
      const rate = Math.round(this._baseRate(byDate, dates, h) * 100); // % of days the habit happened
      const rateLabel = isLimit ? `${100-rate}% clear` : `${rate}% overall`;
      const streakLabel = streak > 0 ? (isLimit ? `✅ ${streak}` : `🔥 ${streak}`) : '—';
      return `
        <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(212,175,90,0.2);border-radius:12px;padding:12px 14px;">
          <div style="font-size:0.78rem;font-weight:700;color:var(--text);margin-bottom:4px;">${h}</div>
          <div style="font-size:1.3rem;font-weight:bold;color:${streak>0?'var(--gold-light)':'var(--text-soft)'}">${streakLabel}</div>
          <div style="font-size:0.68rem;color:var(--text-soft);margin-top:2px;">${rateLabel}</div>
        </div>`;
    }).join('');
  },

  // ── Heatmap ────────────────────────────────────────────────────────────────

  _renderHeatmap(byDate, dates, trackedHabits, state, config) {
    const canvas = document.getElementById('heatmapChart');
    if (!canvas) return;
    const days = (dates.slice(0, config.habits?.heatmapDays || 30)).reverse(); // oldest -> newest, left to right
    const habits = trackedHabits;
    const dpr = window.devicePixelRatio || 1;
    const rowH = 20, labelW = 90, cellGap = 2;
    const W = canvas.offsetWidth || 600, H = habits.length * rowH + 24;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const plotW = W - labelW;
    const cellW = plotW / days.length;

    // Phase/energy-state bands behind the grid — colors pulled straight from this archetype's config.
    const bandColors = {};
    this._phaseList(config).forEach(p => { bandColors[p.key] = this._hexToRgba(p.color, 0.1); });
    let bandStart = 0, bandPhase = this._phaseKeyForDate(days[0], state, config);
    days.forEach((d, i) => {
      const ph = this._phaseKeyForDate(d, state, config);
      if (ph !== bandPhase || i === days.length-1) {
        const end = i === days.length-1 ? i+1 : i;
        if (bandPhase) {
          ctx.fillStyle = bandColors[bandPhase] || 'transparent';
          ctx.fillRect(labelW + bandStart*cellW, 0, (end-bandStart)*cellW, habits.length*rowH);
        }
        bandStart = i; bandPhase = ph;
      }
    });

    habits.forEach((h, ri) => {
      const rate = this._baseRate(byDate, dates, h);
      ctx.fillStyle = 'rgba(224,212,247,0.7)';
      ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(h.length > 12 ? h.slice(0,11)+'…' : h, 0, ri*rowH + rowH/2);

      days.forEach((d, ci) => {
        const v = byDate[d]?.[h] ?? null;
        const x = labelW + ci*cellW, y = ri*rowH;
        let fill;
        if (v === true) fill = 'rgba(128,203,196,0.85)';
        else if (v === false) fill = 'rgba(244,160,181,0.35)';
        else fill = `rgba(201,184,232,${0.12 + rate*0.28})`; // unlogged: shaded by historical base rate, not blank
        ctx.fillStyle = fill;
        if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y+2, cellW-cellGap, rowH-4, 3); ctx.fill(); }
        else ctx.fillRect(x, y+2, cellW-cellGap, rowH-4);
      });
    });
  },

  // ── Phase correlation ─────────────────────────────────────────────────────

  _renderPhaseCorrelation(byDate, dates, trackedHabits, state, config) {
    const canvas = document.getElementById('phaseCorrelChart');
    if (!canvas) return;
    const phases = this._phaseList(config);
    const habits = trackedHabits;
    const dpr = window.devicePixelRatio || 1;
    const rowH = 26, labelW = 90;
    const W = canvas.offsetWidth || 600, H = habits.length * rowH + 20;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const plotW = W - labelW - 8;

    habits.forEach((h, ri) => {
      const overall = this._baseRate(byDate, dates, h);
      ctx.fillStyle = 'rgba(224,212,247,0.7)';
      ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(h.length > 12 ? h.slice(0,11)+'…' : h, 0, ri*rowH + rowH/2);

      const segW = plotW / phases.length;
      phases.forEach((ph, pi) => {
        let yes=0, known=0;
        dates.forEach(d => {
          if (this._phaseKeyForDate(d, state, config) !== ph.key) return;
          const v = byDate[d][h];
          if (v !== null) { known++; if (v) yes++; }
        });
        // No logged days in this phase yet -> fall back to the habit's overall rate rather than an empty/zero bar.
        const rate = known ? yes/known : overall;
        const x = labelW + pi*segW, barMaxW = segW - 6;
        const barW = Math.max(3, rate * barMaxW);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x, ri*rowH+4, barMaxW, rowH-10);
        ctx.fillStyle = known ? ph.color : ph.color + '66';
        ctx.fillRect(x, ri*rowH+4, barW, rowH-10);
      });
    });

    // Phase legend
    const legendY = H - 4;
    ctx.font = '9px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    let lx = labelW;
    phases.forEach(ph => {
      ctx.fillStyle = ph.color; ctx.fillRect(lx, legendY-16, 8, 8);
      ctx.fillStyle = 'rgba(224,212,247,0.6)'; ctx.fillText(ph.label, lx+11, legendY-9);
      lx += ph.label.length*5 + 26;
    });
  },

  // ── Wellness trend ─────────────────────────────────────────────────────────

  _renderWellness(byDate, dates, config) {
    const canvas = document.getElementById('wellnessChart');
    if (!canvas) return;
    const wellnessHabits = config.habits?.wellness || config.habits?.tracked || [];
    const windowDays = config.habits?.wellnessTrendDays || 60;
    const days = dates.slice(0, windowDays).reverse(); // oldest -> newest
    if (!days.length || !wellnessHabits.length) return;

    // Per-day score = % of wellness habits completed that day; days with zero logged
    // habits fall back to a 7-day rolling average so the line never drops to a false zero.
    const rawScores = days.map(d => {
      let yes=0, known=0;
      wellnessHabits.forEach(h => { const v = byDate[d][h]; if (v !== null) { known++; if (v) yes++; } });
      return known ? (yes/known)*100 : null;
    });
    const scores = rawScores.map((s, i) => {
      if (s !== null) return s;
      const window = rawScores.slice(Math.max(0,i-6), i+1).filter(v => v !== null);
      if (window.length) return window.reduce((a,b)=>a+b,0)/window.length;
      const known = rawScores.filter(v => v !== null);
      return known.length ? known.reduce((a,b)=>a+b,0)/known.length : 50;
    });

    const dpr = window.devicePixelRatio || 1;
    const pad = { top: 16, right: 12, bottom: 20, left: 30 };
    const W = canvas.offsetWidth || 600, H = 160;
    canvas.width = W*dpr; canvas.height = H*dpr; canvas.style.height = H+'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    ctx.clearRect(0,0,W,H);
    const plotW = W-pad.left-pad.right, plotH = H-pad.top-pad.bottom;

    ctx.strokeStyle = 'rgba(201,184,232,0.15)';
    [0,50,100].forEach(v => {
      const y = pad.top + plotH - (v/100)*plotH;
      ctx.beginPath(); ctx.setLineDash([3,4]); ctx.moveTo(pad.left,y); ctx.lineTo(pad.left+plotW,y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(224,212,247,0.6)'; ctx.font = '8px Georgia'; ctx.textAlign = 'right';
      ctx.fillText(v, pad.left-5, y+3);
    });

    const points = scores.map((v,i) => ({ x: pad.left + (i/(Math.max(scores.length-1,1)))*plotW, y: pad.top+plotH-(v/100)*plotH }));
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i=1; i<points.length-1; i++) {
      const mx=(points[i].x+points[i+1].x)/2, my=(points[i].y+points[i+1].y)/2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    if (points.length>1) { const p1=points[points.length-2], p2=points[points.length-1]; ctx.quadraticCurveTo(p1.x,p1.y,p2.x,p2.y); }
    ctx.lineTo(pad.left+plotW, pad.top+plotH); ctx.lineTo(pad.left, pad.top+plotH); ctx.closePath();
    ctx.fillStyle = 'rgba(212,175,90,0.1)'; ctx.fill();

    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i=1; i<points.length-1; i++) {
      const mx=(points[i].x+points[i+1].x)/2, my=(points[i].y+points[i+1].y)/2;
      ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
    }
    if (points.length>1) { const p1=points[points.length-2], p2=points[points.length-1]; ctx.quadraticCurveTo(p1.x,p1.y,p2.x,p2.y); }
    ctx.strokeStyle = 'rgba(212,175,90,0.95)'; ctx.lineWidth = 2.2; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();

    ctx.fillStyle = 'rgba(224,212,247,0.55)'; ctx.font = '9px Georgia'; ctx.textAlign = 'center';
    ctx.fillText(new Date(days[0]).toLocaleDateString('en-US',{month:'short',day:'numeric'}), pad.left, H-4);
    ctx.fillText(new Date(days[days.length-1]).toLocaleDateString('en-US',{month:'short',day:'numeric'}), pad.left+plotW, H-4);
  },

  // ── Pattern insights ───────────────────────────────────────────────────────

  _renderPatternInsights(byDate, dates, trackedHabits, limitHabits, state, config) {
    const el = document.getElementById('patternInsights');
    if (!el) return;
    // Build habits (Workout, Read...) are good done MORE; limit habits (Alcohol, Sugar...) are
    // good done LESS — a low rate on a limit habit is a win, not something "hardest to keep up".
    const buildHabits = trackedHabits.filter(h => !limitHabits.includes(h));
    const rates = buildHabits.map(h => ({ h, rate: this._baseRate(byDate, dates, h) }));
    rates.sort((a,b) => b.rate - a.rate);
    const insights = [];
    if (rates.length) {
      const best = rates[0];
      insights.push(`<strong>${best.h}</strong> is your most consistent habit — done ${Math.round(best.rate*100)}% of logged days.`);
    }
    if (rates.length > 1) {
      const worst = rates[rates.length-1];
      if (worst.rate < 0.4) insights.push(`<strong>${worst.h}</strong> is the hardest to keep up — only ${Math.round(worst.rate*100)}% of days.`);
    }
    if (limitHabits.length) {
      const limitRates = limitHabits.map(h => ({ h, rate: this._baseRate(byDate, dates, h) })).filter(r => trackedHabits.includes(r.h));
      const bestLimit = limitRates.sort((a,b) => a.rate - b.rate)[0];
      if (bestLimit) {
        if (bestLimit.rate <= 0.25) insights.push(`<strong>${bestLimit.h}</strong> is well managed — only ${Math.round(bestLimit.rate*100)}% of days.`);
        else if (bestLimit.rate >= 0.5) insights.push(`<strong>${bestLimit.h}</strong> is showing up often — ${Math.round(bestLimit.rate*100)}% of days. Worth keeping an eye on.`);
      }
    }
    const isMenstrual = config.cycle.type === 'menstrual';
    const hasCorrelationSource = isMenstrual ? !!state.periodStart : (state.healthData?.history || []).some(e => e.energyState);
    if (hasCorrelationSource) {
      const phaseKeys = this._phaseList(config);
      const phaseLabel = key => phaseKeys.find(p => p.key === key)?.label || key;
      let biggest = null;
      trackedHabits.forEach(h => {
        const byPhase = {};
        phaseKeys.forEach(({key: ph}) => {
          let yes=0, known=0;
          dates.forEach(d => { if (this._phaseKeyForDate(d,state,config)===ph) { const v=byDate[d][h]; if (v!==null){known++; if(v) yes++;} } });
          if (known >= 3) byPhase[ph] = yes/known;
        });
        const vals = Object.entries(byPhase);
        if (vals.length < 2) return;
        const [hiPh, hiVal] = vals.reduce((a,b) => b[1]>a[1]?b:a);
        const [loPh, loVal] = vals.reduce((a,b) => b[1]<a[1]?b:a);
        const swing = hiVal - loVal;
        if (!biggest || swing > biggest.swing) biggest = { h, hiPh, hiVal, loPh, loVal, swing };
      });
      if (biggest && biggest.swing > 0.25) {
        const suffix = isMenstrual ? 'phase' : 'days';
        insights.push(`<strong>${biggest.h}</strong> happens ${Math.round(biggest.swing*100)}pp more often on your <strong>${phaseLabel(biggest.hiPh)}</strong> ${suffix} than your <strong>${phaseLabel(biggest.loPh)}</strong> ${suffix}.`);
      }
    } else {
      insights.push(isMenstrual
        ? `Set your period start date in Settings to unlock cycle-phase correlations for these habits.`
        : `Log a few daily energy check-ins on the Today tab to unlock energy-state correlations for these habits.`);
    }
    el.innerHTML = `
      <div class="card">
        <h3>Patterns Worth Knowing</h3>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${insights.map(i => `<div style="font-size:0.82rem;color:var(--text);line-height:1.5;background:rgba(255,255,255,0.05);border-radius:10px;padding:10px 12px;">${i}</div>`).join('')}
        </div>
      </div>`;
  }
};

// ─── BOOT ─────────────────────────────────────────────────────────────────────

const app = new MoonCycleApp();

window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isDemo   = window.location.hostname.includes('vercel.app') || urlParams.has('demo');
  const configId = urlParams.get('config') || (isDemo ? 'demo-urban-athlete' : null);
  app.init(configId, isDemo).then(() => {
    app._updatePhaseBanner();
  }).catch(err => {
    console.error('Failed to initialize app:', err);
    document.getElementById('module-container').innerHTML =
      `<div class="card"><h3>⚠️ Load Error</h3><p style="color:var(--text-soft)">${err.message}</p></div>`;
  });
});
