/* ================================================================
   RMZS Weapon Wiki — app.js
   ================================================================ */

'use strict';

// ================================================================
//  CONFIG
// ================================================================
const STAT_DEFS = [
  { key: 'damage',   label: 'Урон',      unit: ''  },
  { key: 'clipSize', label: 'Магазин',   unit: ''  },
  { key: 'delay',    label: 'Задержка',  unit: 'с' },
  { key: 'reload',   label: 'Перезаряд', unit: 'с' },
  { key: 'dps',      label: 'DPS',       unit: ''  },
];

const AMMO_LABELS = {
  '357':        '.357',
  'XBowBolt':   'Болт',
  'ar2':        'AR2',
  'buckshot':   'Дробь',
  'chemical':   'Хим',
  'impactmine': 'Мина',
  'pistol':     'Пист.',
  'pulse':      'Импульс',
  'scrap':      'Лом',
  'smg1':       'SMG',
};

const AMMO_COLORS = {
  '357':        '#f87171',
  'XBowBolt':   '#e879f9',
  'ar2':        '#34d399',
  'buckshot':   '#fb923c',
  'chemical':   '#86efac',
  'impactmine': '#fbbf24',
  'pistol':     '#94a3b8',
  'pulse':      '#818cf8',
  'scrap':      '#d6d3d1',
  'smg1':       '#60a5fa',
};

const VARIANT_LABELS = {
  'base':     'Базовое',
  'branch_1': 'Ветка 1',
  'branch_2': 'Ветка 2',
  'branch_3': 'Ветка 3',
  'branch_4': 'Ветка 4',
};

// ================================================================
//  STATE
// ================================================================
let weaponsData  = [];
let changelogData = [];
let familyMap    = new Map();   // family → sorted variants[]
let allHistory   = {};          // "family:vtype:stat" → [{patch,date,old,new}, …]
let latestChange = {};          // "family:vtype:stat" → {patch,date,old,new}  (most recent patch that touched it)
let latestPatch  = null;        // the changelog entry with the most recent date

const filters = { search: '', tier: 'all', ammo: 'all' };

// ================================================================
//  INIT
// ================================================================
async function init() {
  try {
    [weaponsData, changelogData] = await Promise.all([
      fetch('data/weapons.json').then(r => { if (!r.ok) throw new Error('weapons.json not found'); return r.json(); }),
      fetch('data/changelog.json').then(r => { if (!r.ok) throw new Error('changelog.json not found'); return r.json(); }),
    ]);
    buildFamilyMap();
    buildChangesIndex();
    setupEvents();
    handleRoute();
  } catch (err) {
    document.getElementById('app').innerHTML = `
      <div class="empty-state">
        <h3>Ошибка загрузки</h3>
        <p>${err.message}</p>
        <p style="margin-top:8px;font-size:11px">Запустите сервер: <code>python -m http.server 8080</code></p>
      </div>`;
  }
}

// ================================================================
//  DATA PROCESSING
// ================================================================
function buildFamilyMap() {
  familyMap.clear();
  for (const w of weaponsData) {
    if (!familyMap.has(w.family)) familyMap.set(w.family, []);
    familyMap.get(w.family).push(w);
  }
  // base first, then branch_1, branch_2 …
  for (const variants of familyMap.values()) {
    variants.sort((a, b) => a.variantNum - b.variantNum);
  }
}

function buildChangesIndex() {
  allHistory   = {};
  latestChange = {};

  // Sort changelog oldest→newest so we can build correct timelines
  const sorted = [...changelogData].sort((a, b) => new Date(a.date) - new Date(b.date));
  latestPatch  = sorted.length ? sorted[sorted.length - 1] : null;

  for (const patch of sorted) {
    if (!patch.changes?.length) continue;
    for (const ch of patch.changes) {
      const base = `${ch.family}:${ch.variantType}`;
      for (const [stat, vals] of Object.entries(ch.stats)) {
        const key = `${base}:${stat}`;
        if (!allHistory[key]) allHistory[key] = [];
        const entry = { patch: patch.patch, date: patch.date, old: vals.old, new: vals.new };
        allHistory[key].push(entry);
        latestChange[key] = entry;   // overwrite → keeps the most recent
      }
    }
  }
}

// ================================================================
//  ROUTER
// ================================================================
function handleRoute() {
  const hash = location.hash || '#weapons';
  const tabW  = document.getElementById('tab-weapons');
  const tabCL = document.getElementById('tab-changelog');

  if (hash === '#changelog') {
    tabW.classList.remove('active');
    tabCL.classList.add('active');
    renderChangelog();
  } else if (hash.startsWith('#family/')) {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderFamilyDetail(decodeURIComponent(hash.slice(8)));
  } else {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderWeapons();
  }
}

// ================================================================
//  EVENT DELEGATION
// ================================================================
function setupEvents() {
  window.addEventListener('hashchange', handleRoute);

  // Search
  document.getElementById('search-input').addEventListener('input', e => {
    filters.search = e.target.value.trim().toLowerCase();
    if (!location.hash.startsWith('#family/') && location.hash !== '#changelog') {
      renderWeapons();
    } else if (filters.search) {
      location.hash = '#weapons';   // navigate back; hashchange will renderWeapons()
    }
  });

  // Global delegation
  document.addEventListener('click', e => {
    // Modal overlay backdrop
    if (e.target.id === 'modal-overlay') { closeModal(); return; }
    if (e.target.id === 'modal-close-btn') { closeModal(); return; }

    // Filter chips
    const chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.tier !== undefined) toggleFilter('tier', chip.dataset.tier);
      else if (chip.dataset.ammo !== undefined) toggleFilter('ammo', chip.dataset.ammo);
      return;
    }

    // Stat cell with history → open modal (checked BEFORE card navigation)
    const statEl = e.target.closest('[data-stat]');
    if (statEl) {
      e.stopPropagation();
      openStatHistory(
        statEl.dataset.family,
        statEl.dataset.vtype,
        statEl.dataset.stat,
        statEl.dataset.label,
        statEl.dataset.wname,
      );
      return;
    }

    // Family card → navigate
    const card = e.target.closest('.family-card[data-family]');
    if (card) {
      location.hash = '#family/' + encodeURIComponent(card.dataset.family);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

function toggleFilter(type, value) {
  filters[type] = filters[type] === value ? 'all' : value;
  // Sync chip states
  document.querySelectorAll(`.chip[data-${type}]`).forEach(c => {
    c.classList.toggle('active', c.dataset[type] === filters[type]);
  });
  renderWeapons();
}

// ================================================================
//  VIEW: WEAPONS LIST
// ================================================================
function renderWeapons() {
  const allTiers = [...new Set(weaponsData.map(w => w.tier).filter(t => t != null))].sort((a, b) => a - b);
  const allAmmos = [...new Set(weaponsData.map(w => w.ammo))].sort();

  // Filter families
  const results = [];
  for (const [family, variants] of familyMap) {
    const base = variants.find(v => v.variantType === 'base') || variants[0];

    if (filters.tier !== 'all' && String(base.tier) !== filters.tier) continue;
    if (filters.ammo !== 'all' && !variants.some(v => v.ammo === filters.ammo)) continue;
    if (filters.search) {
      const q = filters.search;
      const hit = family.toLowerCase().includes(q)
        || variants.some(v => v.name.toLowerCase().includes(q));
      if (!hit) continue;
    }
    results.push({ family, variants, base });
  }

  // Sort: tier asc, then alphabetical
  results.sort((a, b) =>
    ((a.base.tier ?? 99) - (b.base.tier ?? 99)) || a.family.localeCompare(b.family)
  );

  document.getElementById('app').innerHTML = `
    <div class="filters-bar">
      <div class="filter-group">
        <span class="filter-label">Тир</span>
        <div class="filter-chips">
          ${allTiers.map(t => `
            <button class="chip${filters.tier === String(t) ? ' active' : ''}" data-tier="${t}">T${t}</button>
          `).join('')}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Патроны</span>
        <div class="filter-chips">
          ${allAmmos.map(a => `
            <button class="chip${filters.ammo === a ? ' active' : ''}" data-ammo="${a}">
              ${AMMO_LABELS[a] ?? a}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
    <div class="results-info">
      Показано семейств: <strong>${results.length}</strong> из <strong>${familyMap.size}</strong>
    </div>
    ${results.length === 0
      ? `<div class="empty-state"><h3>Ничего не найдено</h3><p>Попробуйте другой запрос или сбросьте фильтры</p></div>`
      : `<div class="weapons-grid">${results.map(r => renderFamilyCard(r)).join('')}</div>`
    }
  `;
}

function renderFamilyCard({ family, variants, base }) {
  const tier     = base.tier;
  const ammo     = base.ammo;
  const ammoClr  = AMMO_COLORS[ammo] ?? '#888';
  const ammoLbl  = AMMO_LABELS[ammo] ?? ammo;
  const varCount = variants.length - 1;

  const statsHtml = STAT_DEFS.map(s => {
    const val = base[s.key];
    const ci  = changeIndicatorHtml(family, 'base', s.key);
    const hasHist = !!allHistory[`${family}:base:${s.key}`];
    const attrs   = hasHist
      ? `data-stat="${s.key}" data-family="${esc(family)}" data-vtype="base" data-label="${s.label}" data-wname="${esc(base.name)}"`
      : '';
    const valHtml = val != null
      ? `${val}${s.unit ? `<span class="stat-unit">${s.unit}</span>` : ''}${ci}`
      : `<span class="stat-na">—</span>`;
    return `
      <div class="stat-cell">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value" ${attrs}>${valHtml}</div>
      </div>`;
  }).join('');

  return `
    <div class="family-card ${tc(tier)}" data-family="${esc(family)}">
      <div class="card-header">
        <div class="card-header-info">
          <div class="family-name">${family}</div>
          <div class="base-weapon-name">${base.name}</div>
        </div>
        <div class="card-badges">
          <span class="tier-badge ${tc(tier)}">${tl(tier)}</span>
          <span class="ammo-badge" style="color:${ammoClr};border-color:${ammoClr}30;background:${ammoClr}12">${ammoLbl}</span>
        </div>
      </div>
      <div class="card-divider"></div>
      <div class="card-stats">${statsHtml}</div>
      <div class="card-footer">
        <span class="variants-label">
          ${varCount > 0
            ? `<strong>${varCount}</strong> ${pluralVariant(varCount)}`
            : 'Нет альтернатив'}
        </span>
        <span class="card-arrow">Подробнее →</span>
      </div>
    </div>`;
}

// ================================================================
//  VIEW: FAMILY DETAIL
// ================================================================
function renderFamilyDetail(family) {
  const variants = familyMap.get(family);
  if (!variants) { location.hash = '#weapons'; return; }

  const base = variants.find(v => v.variantType === 'base') || variants[0];
  const tier = base.tier;

  // Column headers
  const colHeaders = variants.map(v => {
    const ammoClr = AMMO_COLORS[v.ammo] ?? '#888';
    const ammoLbl = AMMO_LABELS[v.ammo] ?? v.ammo;
    const isBase  = v.variantType === 'base';
    const vtag    = VARIANT_LABELS[v.variantType] ?? v.variantType;
    return `
      <th>
        <div class="col-header">
          <div class="col-weapon-name">${v.name}</div>
          <div class="col-badges">
            <span class="variant-tag ${isBase ? 'base' : 'branch'}">${vtag}</span>
            <span class="ammo-badge" style="color:${ammoClr};border-color:${ammoClr}30;background:${ammoClr}12;font-size:9px">${ammoLbl}</span>
          </div>
        </div>
      </th>`;
  }).join('');

  // Stat rows
  const statRows = STAT_DEFS.map(s => {
    const cells = variants.map(v => {
      const val     = v[s.key];
      const hasHist = !!allHistory[`${family}:${v.variantType}:${s.key}`];
      const ci      = changeIndicatorHtml(family, v.variantType, s.key);
      const valHtml = val != null
        ? `${val}${s.unit ? `<span class="stat-unit"> ${s.unit}</span>` : ''}${ci}`
        : `<span class="stat-na">—</span>`;
      const attrs = hasHist
        ? `data-stat="${s.key}" data-family="${esc(family)}" data-vtype="${v.variantType}" data-label="${s.label}" data-wname="${esc(v.name)}"`
        : '';
      return `<td><div class="table-stat" ${attrs}>${valHtml}</div></td>`;
    }).join('');
    return `<tr><td><div class="row-label">${s.label}</div></td>${cells}</tr>`;
  }).join('');

  // File row
  const fileRow = `
    <tr>
      <td><div class="row-label">Файл</div></td>
      ${variants.map(v => `<td><span class="file-name">${v.file}</span></td>`).join('')}
    </tr>`;

  const patchTag = latestPatch
    ? `<span class="detail-patch-tag">${latestPatch.patch}</span>
       <span class="dot">·</span>
       <span>Актуально на ${fmtDate(latestPatch.date)}</span>`
    : '';

  document.getElementById('app').innerHTML = `
    <a class="back-btn" href="#weapons">← К списку оружия</a>
    <div class="detail-title-row">
      <span class="detail-title">${family}</span>
      <span class="tier-badge ${tc(tier)}">Tier ${tl(tier)}</span>
    </div>
    <div class="detail-meta">
      <span>${variants.length} ${pluralVariantFull(variants.length)}</span>
      <span class="dot">·</span>
      <span>${AMMO_LABELS[base.ammo] ?? base.ammo}</span>
      ${patchTag ? `<span class="dot">·</span>${patchTag}` : ''}
    </div>
    <div class="table-wrapper">
      <table class="comparison-table">
        <thead>
          <tr>
            <th>Параметр</th>
            ${colHeaders}
          </tr>
        </thead>
        <tbody>
          ${statRows}
          ${fileRow}
        </tbody>
      </table>
    </div>`;
}

// ================================================================
//  VIEW: CHANGELOG
// ================================================================
function renderChangelog() {
  const sorted = [...changelogData].sort((a, b) => new Date(b.date) - new Date(a.date));

  document.getElementById('app').innerHTML = `
    <div class="changelog-wrap">
      ${sorted.length === 0
        ? `<div class="empty-state"><h3>Changelog пуст</h3><p>Появится после первого патча</p></div>`
        : sorted.map(renderPatchCard).join('')
      }
    </div>`;
}

function renderPatchCard(patch) {
  const changes = patch.changes ?? [];
  const changesHtml = changes.length === 0
    ? '<p class="no-changes">Первоначальная публикация — изменений нет.</p>'
    : changes.map(renderChangeCard).join('');

  return `
    <div class="patch-card">
      <div class="patch-head">
        <span class="patch-version">${patch.patch}</span>
        <span class="patch-date">${fmtDate(patch.date)}</span>
        ${patch.description ? `<span class="patch-desc">${patch.description}</span>` : ''}
        ${changes.length ? `<span class="patch-change-count">${changes.length} изм.</span>` : ''}
      </div>
      <div class="patch-body">${changesHtml}</div>
    </div>`;
}

function renderChangeCard(ch) {
  const variants  = familyMap.get(ch.family) ?? [];
  const weapon    = variants.find(v => v.variantType === ch.variantType);
  const wname     = ch.weaponName ?? weapon?.name ?? ch.family;
  const tier      = weapon?.tier;
  const vtag      = VARIANT_LABELS[ch.variantType] ?? ch.variantType;

  const diffs = Object.entries(ch.stats).map(([stat, vals]) => {
    const def  = STAT_DEFS.find(s => s.key === stat);
    const lbl  = def?.label ?? stat;
    const unit = def?.unit ?? '';
    const num  = typeof vals.new === 'number' && typeof vals.old === 'number';
    const isBuff = num && vals.new > vals.old;
    const isNerf = num && vals.new < vals.old;
    const cls  = isBuff ? 'buff' : isNerf ? 'nerf' : 'neutral';
    const delta = num ? (isBuff ? `+${r2(vals.new - vals.old)}` : `${r2(vals.new - vals.old)}`) : '';
    return `
      <div class="diff-chip ${cls}">
        <span class="diff-stat-name">${lbl}</span>
        <span class="diff-old">${vals.old}${unit}</span>
        <span class="diff-arrow">→</span>
        <span class="diff-new ${cls}">${vals.new}${unit}</span>
        ${delta ? `<span class="diff-delta ${cls}">(${delta})</span>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="change-card">
      <div class="change-head">
        ${tier != null ? `<span class="tier-badge ${tc(tier)}">${tl(tier)}</span>` : ''}
        <div>
          <span class="change-weapon-name">${wname}</span>
          <span class="change-family-tag">${ch.family} · ${vtag}</span>
        </div>
      </div>
      <div class="change-diffs">${diffs}</div>
      ${ch.note ? `<div class="change-note">${ch.note}</div>` : ''}
    </div>`;
}

// ================================================================
//  STAT HISTORY MODAL
// ================================================================
function openStatHistory(family, vtype, statKey, statLabel, weaponName) {
  const key     = `${family}:${vtype}:${statKey}`;
  const history = allHistory[key] ?? [];
  const def     = STAT_DEFS.find(s => s.key === statKey);
  const unit    = def?.unit ?? '';

  // Current value from weapon data
  const weapon  = (familyMap.get(family) ?? []).find(v => v.variantType === vtype);
  const curVal  = weapon?.[statKey];

  // Baseline = value before the first recorded change (or current if no history)
  const baseline = history.length ? history[0].old : curVal;

  let rows = '';

  // Baseline row
  rows += `
    <div class="history-row">
      <span class="h-patch">v1.0</span>
      <span class="h-date">Изначально</span>
      <div class="h-change"><span class="h-value-only">${baseline}${unit}</span></div>
      <span class="h-tag-base">База</span>
    </div>`;

  // Each recorded change
  history.forEach((h, i) => {
    const num    = typeof h.new === 'number' && typeof h.old === 'number';
    const isBuff = num && h.new > h.old;
    const isNerf = num && h.new < h.old;
    const dir    = isBuff ? 'buff' : isNerf ? 'nerf' : 'neutral';
    const rowCls = isBuff ? 'buff-row' : isNerf ? 'nerf-row' : '';
    const delta  = num ? (isBuff ? `+${r2(h.new - h.old)}` : `${r2(h.new - h.old)}`) : '';
    const isCur  = i === history.length - 1;

    rows += `
      <div class="history-row ${rowCls} ${isCur ? 'is-current' : ''}">
        <span class="h-patch">${h.patch}</span>
        <span class="h-date">${fmtDate(h.date)}</span>
        <div class="h-change">
          <span class="h-old">${h.old}${unit}</span>
          <span class="h-arrow">→</span>
          <span class="h-new ${dir}">${h.new}${unit}</span>
          ${delta ? `<span class="h-delta ${dir}">(${delta})</span>` : ''}
        </div>
        ${isCur ? '<span class="h-tag-current">Текущее</span>' : ''}
      </div>`;
  });

  // If no history yet, show current as baseline+current
  if (history.length === 0) {
    rows = `
      <div class="history-row is-current">
        <span class="h-patch">v1.0</span>
        <span class="h-date">Изначально</span>
        <div class="h-change"><span class="h-value-only">${curVal ?? '—'}${unit}</span></div>
        <span class="h-tag-current">Текущее</span>
      </div>
      <p class="history-no-changes">Изменений не зафиксировано</p>`;
  }

  document.getElementById('modal-title').textContent    = `${statLabel} — история изменений`;
  document.getElementById('modal-subtitle').textContent = weaponName;
  document.getElementById('modal-body').innerHTML       = `<div class="history-list">${rows}</div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ================================================================
//  HELPERS
// ================================================================
/** Change indicator arrow for a given stat (only from the single LATEST patch) */
function changeIndicatorHtml(family, vtype, stat) {
  const ch = latestChange[`${family}:${vtype}:${stat}`];
  if (!ch || !latestPatch || ch.patch !== latestPatch.patch) return '';
  if (typeof ch.new !== 'number' || typeof ch.old !== 'number') return '';
  const dir = ch.new > ch.old ? 'up' : ch.new < ch.old ? 'down' : null;
  if (!dir) return '';
  return `<span class="ci ${dir}" title="${ch.patch}: ${ch.old} → ${ch.new}">${dir === 'up' ? '▲' : '▼'}</span>`;
}

/** Safe tier CSS class: t1..t6, or 'tx' for unknown */
function tc(tier) { return tier != null ? `t${tier}` : 'tx'; }
/** Safe tier display label */
function tl(tier) { return tier != null ? `T${tier}` : '?'; }

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function r2(n) { return Math.round(n * 100) / 100; }

/** Escape for use inside HTML attribute values */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function pluralVariant(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'альтернатива';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'альтернативы';
  return 'альтернатив';
}

function pluralVariantFull(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'вариант';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'варианта';
  return 'вариантов';
}

// ================================================================
//  START
// ================================================================
init();
