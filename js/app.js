/* ================================================================
   RMZS Weapon Wiki — app.js
   ================================================================ */

'use strict';

// ================================================================
//  CONFIG
// ================================================================
const STAT_DEFS = [
  { key: 'damage', label: 'Урон', unit: '' },
  { key: 'clipSize', label: 'Магазин', unit: '' },
  { key: 'delay', label: 'Задержка', unit: 'с' },
  { key: 'reload', label: 'Перезаряд', unit: 'с' },
  { key: 'dps', label: 'DPS', unit: '' },
];

const AMMO_LABELS = {
  '357': '.357',
  'XBowBolt': 'Болт',
  'ar2': 'AR2',
  'buckshot': 'Дробь',
  'chemical': 'Хим',
  'impactmine': 'Мина',
  'pistol': 'Пист.',
  'pulse': 'Импульс',
  'scrap': 'Лом',
  'smg1': 'SMG',
};

const AMMO_COLORS = {
  '357': '#c2845c',
  'XBowBolt': '#facc15',
  'ar2': '#02f7ae',
  'buckshot': '#ef4444',
  'chemical': '#86efac',
  'impactmine': '#f97316',
  'pistol': '#fef08a',
  'pulse': '#818cf8',
  'scrap': '#d6d3d1',
  'smg1': '#60a5fa',
};

const VARIANT_LABELS = {
  'base': 'Базовое',
  'branch_1': 'Ветка 1',
  'branch_2': 'Ветка 2',
  'branch_3': 'Ветка 3',
  'branch_4': 'Ветка 4',
};

// ================================================================
//  STATE
// ================================================================
let weaponsData = [];
let changelogData = [];
let familyMap = new Map();   // family → sorted variants[]
let allHistory = {};          // "family:vtype:stat" → [{patch,date,old,new}, …]
let latestChange = {};          // "family:vtype:stat" → {patch,date,old,new}  (most recent patch that touched it)
let latestPatch = null;        // the changelog entry with the most recent date
let compareList = [];         // selected weapon families for side-by-side comparison

const filters = { search: '', tiers: new Set(), ammos: new Set(), sortBy: 'default', sortOrder: 'asc' };
function hasFiltersActive() {
  return filters.tiers.size > 0 || filters.ammos.size > 0 || filters.sortBy !== 'default';
}
function resetFilters() {
  filters.tiers.clear();
  filters.ammos.clear();
  filters.sortBy = 'default';
  filters.sortOrder = 'asc';
  renderWeapons();
}

// ================================================================
//  INIT
// ================================================================
async function init() {
  try {
    const scriptSrc = document.currentScript ? document.currentScript.src : '';
    const urlParams = new URLSearchParams(scriptSrc.split('?')[1] || '');
    const ver = urlParams.get('v') || Date.now();

    [weaponsData, changelogData] = await Promise.all([
      fetch(`data/weapons.json?v=${ver}`).then(r => { if (!r.ok) throw new Error('weapons.json not found'); return r.json(); }),
      fetch(`data/changelog.json?v=${ver}`).then(r => { if (!r.ok) throw new Error('changelog.json not found'); return r.json(); }),
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
        <p style="margin-top:8px;font-size:11px">Запустите сервер: <code>python -m http.server 8000</code></p>
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

function findWeaponForChange(ch) {
  if (!ch.file) return null;
  const candidates = weaponsData.filter(w => w.file === ch.file);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const vtype = ch.variantType || (ch.variantNum !== undefined ? `branch_${ch.variantNum}` : (ch.variant !== undefined ? `branch_${ch.variant}` : null));
  if (vtype) {
    const match = candidates.find(w => w.variantType === (vtype === 'branch_0' ? 'base' : vtype) || w.variantType === vtype);
    if (match) return match;
  }
  if (ch.weaponName) {
    const match = candidates.find(w => w.name === ch.weaponName);
    if (match) return match;
  }

  return candidates[0];
}

function buildChangesIndex() {
  allHistory = {};
  latestChange = {};

  // Calculate initial DPS dynamically based on projectileCount
  for (const w of weaponsData) {
    w.projectileCount = w.projectileCount ?? 1;
    if (w.damage && w.delay) {
      w.dps = Math.round((w.damage * w.projectileCount) / w.delay);
    } else {
      w.dps = 0;
    }
  }

  // Sort changelog oldest→newest so we can build correct timelines
  const sorted = [...changelogData].sort((a, b) => new Date(a.date) - new Date(b.date));
  latestPatch = sorted.length ? sorted[sorted.length - 1] : null;

  for (const patch of sorted) {
    if (!patch.changes?.length) continue;
    for (const ch of patch.changes) {
      const weapon = findWeaponForChange(ch);
      if (!weapon) {
        console.warn('Weapon not found for changelog entry:', ch);
        continue;
      }

      const base = `${weapon.family}:${weapon.variantType}`;
      let hasDmgOrDlyChange = false;

      for (const [stat, val] of Object.entries(ch.stats)) {
        if (stat === 'damage' || stat === 'delay') {
          hasDmgOrDlyChange = true;
        }

        const key = `${base}:${stat}`;
        if (!allHistory[key]) allHistory[key] = [];

        const oldVal = weapon[stat];
        const newVal = val;

        const entry = { patch: patch.patch, date: patch.date, old: oldVal, new: newVal };
        allHistory[key].push(entry);
        latestChange[key] = entry;   // overwrite → keeps the most recent

        // Update the weapon's state in-place to the new value
        weapon[stat] = newVal;
      }

      // Automatically recalculate and override DPS if damage or delay changed
      if (hasDmgOrDlyChange) {
        if (weapon.damage && weapon.delay) {
          const newDps = Math.round((weapon.damage * weapon.projectileCount) / weapon.delay);
          const oldDps = weapon.dps;
          
          if (newDps !== oldDps) {
            const key = `${base}:dps`;
            if (!allHistory[key]) allHistory[key] = [];

            const entry = { patch: patch.patch, date: patch.date, old: oldDps, new: newDps };
            allHistory[key].push(entry);
            latestChange[key] = entry;   // overwrite → keeps the most recent

            weapon.dps = newDps;
          }
        }
      }
    }
  }
}

// ================================================================
//  ROUTER
// ================================================================
function handleRoute() {
  updateCompareWidget();
  const hash = location.hash || '#weapons';
  const tabW = document.getElementById('tab-weapons');
  const tabCL = document.getElementById('tab-changelog');

  if (hash === '#changelog' || hash.startsWith('#patch-')) {
    tabW.classList.remove('active');
    tabCL.classList.add('active');
    renderChangelog();

    if (hash.startsWith('#patch-')) {
      const patchId = decodeURIComponent(hash.slice(1));
      setTimeout(() => {
        const targetEl = document.getElementById(patchId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          targetEl.classList.add('highlight-flash');
          setTimeout(() => targetEl.classList.remove('highlight-flash'), 2000);
        }
      }, 50);
    }
  } else if (hash.startsWith('#family/')) {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderFamilyDetail(decodeURIComponent(hash.slice(8)));
  } else if (hash === '#compare') {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderComparePage();
  } else {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderWeapons();
  }
}

// ================================================================
//  COMPARE MODE
// ================================================================
function toggleCompare(wkey) {
  const idx = compareList.indexOf(wkey);
  if (idx > -1) {
    compareList.splice(idx, 1);
  } else {
    if (compareList.length >= 5) {
      alert("Можно сравнивать не более 5 видов оружия одновременно!");
      return;
    }
    compareList.push(wkey);
  }
  updateCompareWidget();
  
  // Re-render based on current route to reflect compare badges
  const hash = location.hash || '#weapons';
  if (hash === '#weapons') {
    renderWeapons();
  } else if (hash === '#compare') {
    renderComparePage();
  } else if (hash.startsWith('#family/')) {
    renderFamilyDetail(decodeURIComponent(hash.slice(8)));
  }
}

function updateCompareWidget() {
  const widget = document.getElementById('compare-widget');
  if (!widget) return;
  
  const hash = location.hash || '#weapons';
  if (compareList.length === 0 || hash === '#compare') {
    widget.classList.add('hidden');
    return;
  }
  
  widget.classList.remove('hidden');
  widget.innerHTML = `
    <div class="compare-widget-title">⚖ Сравнение (${compareList.length}/5)</div>
    <div class="compare-widget-items">
      ${compareList.map(key => {
        const [fam, vtype] = key.split(':');
        const variants = familyMap.get(fam) || [];
        const w = variants.find(v => v.variantType === vtype) || {};
        const name = w.name || fam;
        return `
          <div class="compare-widget-item">
            <span style="font-weight:600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 170px;">${name}</span>
            <button onclick="toggleCompare('${esc(key)}')">×</button>
          </div>
        `;
      }).join('')}
    </div>
    <button onclick="goCompare()" class="compare-widget-go-btn" style="border:none; cursor:pointer; width:100%; display:block;">Сравнить</button>
  `;
}

function goCompare() {
  if (compareList.length < 2) {
    alert("Выберите как минимум 2 оружия для сравнения!");
    return;
  }
  location.hash = '#compare';
}

function openHelpModal() {
  const body = `
    <div class="help-content" style="display: flex; flex-direction: column; gap: 20px; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.6; color: var(--text-2);">
      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">🔍 Поиск, сортировка и фильтры</h4>
        <p>Вы можете искать оружие по названию или по имени lua-файла. Доступны фильтры по <strong>тирам (T1-T6)</strong> и <strong>типам патронов</strong>.</p>
        <p>Клик по кнопке сортировки (Урон, DPS, Задержка, Перезарядка) упорядочит список. Повторный клик по тому же критерию изменит направление сортировки (по возрастанию / убыванию), что отмечается стрелкой на кнопке.</p>
      </div>
      
      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">⚖ Сравнение оружия</h4>
        <p>Иконка весов <strong>⚖</strong> на карточке оружия добавляет его в список сравнения (до <strong>5 единиц одновременно</strong>). В виджете в углу нажмите кнопку <strong>«Сравнить»</strong> для перехода к детальной таблице.</p>
        <p>В таблице лучшие характеристики подсвечиваются зелёным цветом, а под таблицей выводится блок с наглядными прогресс-барами для быстрой оценки параметров веток.</p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">📈 История изменений и индикаторы патчей</h4>
        <p>Клик по любой числовой характеристике откроет окно с полной историей её изменений. Рядом с изменёнными параметрами выводятся цветные стрелки: <span style="color: var(--buff);">▲ (бафф)</span> и <span style="color: var(--nerf);">▼ (нерф)</span>.</p>
        <p><strong>Клик по стрелке</strong> перенесёт вас во вкладку <strong>Changelog</strong> к конкретному патчу, в котором это изменение было выпущено. Патч автоматически прокрутится на экран и подсветится кратковременной вспышкой.</p>
        <p><em>Примечание: если числовая характеристика не кликается при наведении курсора, значит, у неё нет истории изменений (параметр оставался неизменным с момента версии 1.0).</em></p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">🔗 Умная навигация и закладки</h4>
        <p>Все переходы внутри Wiki (просмотр карточек, вкладка изменений, окно сравнения и даже ссылки на конкретные патчи) отображаются в URL-адресе в виде хешей (например, <code>#compare</code>, <code>#family/Scattershot</code>, <code>#patch-v1.2</code>).</p>
        <p>Вы можете свободно копировать адресную строку, делиться ссылками с другими или сохранять их в закладки — Wiki откроется ровно в том состоянии, на котором вы её оставили.</p>
      </div>
    </div>
  `;

  document.getElementById('modal-title').textContent = `Справка по использованию Wiki`;
  document.getElementById('modal-subtitle').textContent = `Подробное руководство`;
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

// ================================================================
//  EVENT DELEGATION
// ================================================================
function setupEvents() {
  window.addEventListener('hashchange', handleRoute);

  // Desktop search
  document.getElementById('search-input').addEventListener('input', e => {
    applySearch(e.target.value);
  });

  // Mobile search toggle button
  const searchToggleBtn = document.getElementById('search-toggle-btn');
  const mobileSearchPanel = document.getElementById('mobile-search-panel');
  const mobileSearchInput = document.getElementById('mobile-search-input');
  const mobileSearchClose = document.getElementById('mobile-search-close');

  function openMobileSearch() {
    mobileSearchPanel.classList.remove('hidden');
    requestAnimationFrame(() => {
      mobileSearchPanel.classList.add('open');
      searchToggleBtn.classList.add('active');
      mobileSearchInput.focus();
    });
  }

  function closeMobileSearch() {
    mobileSearchPanel.classList.remove('open');
    searchToggleBtn.classList.remove('active');
    setTimeout(() => mobileSearchPanel.classList.add('hidden'), 200);
    mobileSearchInput.value = '';
    applySearch('');
  }

  searchToggleBtn.addEventListener('click', () => {
    if (mobileSearchPanel.classList.contains('open')) {
      closeMobileSearch();
    } else {
      openMobileSearch();
    }
  });

  mobileSearchClose.addEventListener('click', closeMobileSearch);

  mobileSearchInput.addEventListener('input', e => {
    applySearch(e.target.value);
  });

  // Close mobile search on navigation
  window.addEventListener('hashchange', () => {
    if (mobileSearchPanel.classList.contains('open')) {
      closeMobileSearch();
    }
  });

  // Help button
  document.getElementById('help-btn').addEventListener('click', openHelpModal);

  // Global delegation
  document.addEventListener('click', e => {
    // Modal overlay backdrop
    if (e.target.id === 'modal-overlay') { closeModal(); return; }
    if (e.target.id === 'modal-close-btn') { closeModal(); return; }

    // Close modal when clicking links inside it (e.g. patch links)
    if (e.target.closest('[data-close-modal]')) {
      closeModal();
    }

    // Filter chips / Sort chips
    const chip = e.target.closest('.chip');
    if (chip) {
      if (chip.dataset.tier !== undefined) {
        toggleFilter('tier', chip.dataset.tier);
      } else if (chip.dataset.ammo !== undefined) {
        toggleFilter('ammo', chip.dataset.ammo);
      } else if (chip.dataset.sort !== undefined) {
        toggleSort(chip.dataset.sort);
      }
      return;
    }

    // Change indicator arrow click -> navigate to patch
    const ciEl = e.target.closest('[data-patch]');
    if (ciEl) {
      e.stopPropagation();
      closeModal();
      location.hash = '#patch-' + encodeURIComponent(ciEl.dataset.patch);
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

    // Compare badge click
    const compBadge = e.target.closest('.compare-card-badge');
    if (compBadge) {
      e.stopPropagation();
      e.preventDefault();
      toggleCompare(compBadge.dataset.wkey);
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

function applySearch(value) {
  filters.search = value.trim().toLowerCase();
  if (!location.hash.startsWith('#family/') && location.hash !== '#changelog') {
    renderWeapons();
  } else if (filters.search) {
    location.hash = '#weapons';
  }
}

function toggleFilter(type, value) {
  // type is 'tier' or 'ammo', maps to filters.tiers / filters.ammos
  const setKey = type === 'tier' ? 'tiers' : 'ammos';
  const set = filters[setKey];
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
  renderWeapons();
}

function toggleSort(value) {
  if (filters.sortBy === value) {
    if (value !== 'default') {
      filters.sortOrder = filters.sortOrder === 'asc' ? 'desc' : 'asc';
    }
  } else {
    filters.sortBy = value;
    if (value === 'default' || value === 'delay' || value === 'reload') {
      filters.sortOrder = 'asc';
    } else {
      filters.sortOrder = 'desc';
    }
  }
  renderWeapons();
}

// ================================================================
//  VIEW: WEAPONS LIST
// ================================================================
function renderWeapons() {
  const allTiers = [...new Set(weaponsData.map(w => w.tier).filter(t => t != null))].sort((a, b) => a - b);
  const allAmmos = [...new Set(weaponsData.map(w => w.ammo))].sort();

  // Filter individual weapons (all variants, not just base)
  const filteredWeapons = weaponsData.filter(w => {
    if (filters.tiers.size > 0 && !filters.tiers.has(String(w.tier))) return false;
    if (filters.ammos.size > 0 && !filters.ammos.has(w.ammo)) return false;
    if (filters.search) {
      const q = filters.search;
      return w.family.toLowerCase().includes(q) || w.name.toLowerCase().includes(q);
    }
    return true;
  });

  // Sort:
  if (filters.sortBy === 'default') {
    filteredWeapons.sort((a, b) => {
      return ((a.tier ?? 99) - (b.tier ?? 99)) ||
        a.family.localeCompare(b.family) ||
        (a.variantNum - b.variantNum);
    });
  } else {
    const key = filters.sortBy;
    const isAsc = filters.sortOrder === 'asc';
    filteredWeapons.sort((a, b) => {
      const valA = a[key] ?? (isAsc ? 999999 : -999999);
      const valB = b[key] ?? (isAsc ? 999999 : -999999);
      if (valA === valB) {
        return a.family.localeCompare(b.family) || (a.variantNum - b.variantNum);
      }
      return isAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });
  }

  const resetBtn = hasFiltersActive()
    ? `<button class="reset-filters-btn" onclick="resetFilters()">✕ Сбросить фильтры</button>`
    : '';

  document.getElementById('app').innerHTML = `
    <div class="filters-bar">
      <div class="filter-group">
        <span class="filter-label">Тир</span>
        <div class="filter-chips">
          ${allTiers.map(t => `
            <button class="chip${filters.tiers.has(String(t)) ? ' active' : ''}" data-tier="${t}">T${t}</button>
          `).join('')}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Патроны</span>
        <div class="filter-chips">
          ${allAmmos.map(a => {
            const isActive = filters.ammos.has(a);
            const ammoClr = AMMO_COLORS[a] ?? '#888';
            const styleAttr = isActive ? `style="color: ${ammoClr}; border-color: ${ammoClr}; background: ${ammoClr}26;"` : '';
            return `
              <button class="chip${isActive ? ' active' : ''}" data-ammo="${a}" ${styleAttr}>
                ${AMMO_LABELS[a] ?? a}
              </button>
            `;
          }).join('')}
        </div>
      </div>
      <div class="filter-group">
        <span class="filter-label">Сортировка</span>
        <div class="filter-chips">
          <button class="chip${filters.sortBy === 'default' ? ' active' : ''}" data-sort="default">
            По умолчанию
          </button>
          <button class="chip${filters.sortBy === 'damage' ? ' active' : ''}" data-sort="damage">
            Урон ${filters.sortBy === 'damage' ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
          <button class="chip${filters.sortBy === 'dps' ? ' active' : ''}" data-sort="dps">
            DPS ${filters.sortBy === 'dps' ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
          <button class="chip${filters.sortBy === 'clipSize' ? ' active' : ''}" data-sort="clipSize">
            Магазин ${filters.sortBy === 'clipSize' ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
          <button class="chip${filters.sortBy === 'delay' ? ' active' : ''}" data-sort="delay">
            Задержка ${filters.sortBy === 'delay' ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
          <button class="chip${filters.sortBy === 'reload' ? ' active' : ''}" data-sort="reload">
            Перезарядка ${filters.sortBy === 'reload' ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
        </div>
      </div>
      ${resetBtn}
    </div>
    <div class="results-info">
      Показано оружия: <strong>${filteredWeapons.length}</strong> из <strong>${weaponsData.length}</strong>
    </div>
    ${filteredWeapons.length === 0
      ? `<div class="empty-state"><h3>Ничего не найдено</h3><p>Попробуйте другой запрос или сбросьте фильтры</p></div>`
      : `<div class="weapons-grid">${filteredWeapons.map(renderWeaponCard).join('')}</div>`
    }
  `;
}

function renderWeaponCard(w) {
  const family = w.family;
  const tier = w.tier;
  const ammo = w.ammo;
  const ammoClr = AMMO_COLORS[ammo] ?? '#888';
  const ammoLbl = AMMO_LABELS[ammo] ?? ammo;
  const vtag = VARIANT_LABELS[w.variantType] ?? w.variantType;

  // Find other variants in this family to know the branch count
  const variants = familyMap.get(family) || [];
  const varCount = variants.length - 1;

  const baseW = variants.find(v => v.variantType === 'base') || w;
  const baseMainName = parseWeaponName(baseW.name);

  const statsHtml = STAT_DEFS.map(s => {
    const val = w[s.key];
    const ci = changeIndicatorHtml(family, w.variantType, s.key);
    const hasHist = !!allHistory[`${family}:${w.variantType}:${s.key}`];
    const attrs = hasHist
      ? `data-stat="${s.key}" data-family="${esc(family)}" data-vtype="${w.variantType}" data-label="${s.label}" data-wname="${esc(w.name)}"`
      : '';
    const valHtml = val != null
      ? `${val}${s.unit ? `<span class="stat-unit">${s.unit}</span>` : ''}${ci}`
      : `<span class="stat-na">—</span>`;
      
    let labelHtml = s.label;
    if (s.key === 'dps') {
      labelHtml = `
        <span class="dps-label-container">
          ${s.label}
          <span class="info-tooltip-trigger">
            <svg class="info-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span class="info-tooltip-content">
              <span class="tooltip-title">Формула:</span>
              <span class="formula-fraction">
                <span class="fraction-numerator">Урон × Снарядов за выстрел</span>
                <span class="fraction-denominator">Задержка</span>
              </span>
            </span>
          </span>
        </span>
      `;
    }

    return `
      <div class="stat-cell">
        <div class="stat-label">${labelHtml}</div>
        <div class="stat-value" ${attrs}>${valHtml}</div>
      </div>`;
  }).join('');

  return `
    <div class="family-card ${tc(tier)}" data-family="${esc(family)}">
      <div class="card-header">
        <div class="card-header-info">
          <div class="family-name">${w.name}</div>
          <div class="base-weapon-name">${baseMainName} · ${vtag}</div>
        </div>
        <div class="card-badges">
          <span class="compare-card-badge ${compareList.includes(family + ':' + w.variantType) ? 'active' : ''}" data-wkey="${esc(family)}:${w.variantType}" title="Сравнить оружие">⚖</span>
          <span class="tier-badge ${tc(tier)}">${tl(tier)}</span>
          <span class="ammo-badge" style="color:${ammoClr};border-color:${ammoClr}30;background:${ammoClr}12">${ammoLbl}</span>
        </div>
      </div>
      <div class="card-divider"></div>
      <div class="card-stats">${statsHtml}</div>
      <div class="card-footer">
        <span class="variants-label">
          ${varCount > 0
            ? `Веток: <strong>${variants.length}</strong>`
            : 'Веток: 1'}
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

  // Filter patches that have changes for this family
  const familyPatches = [];
  const sortedPatches = [...changelogData].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const patch of sortedPatches) {
    if (!patch.changes?.length) continue;
    const matchingChanges = patch.changes.filter(ch => {
      const w = findWeaponForChange(ch);
      return w && w.family === family;
    });
    if (matchingChanges.length > 0) {
      familyPatches.push({
        ...patch,
        changes: matchingChanges
      });
    }
  }

  // Column headers
  const colHeaders = variants.map(v => {
    const ammoClr = AMMO_COLORS[v.ammo] ?? '#888';
    const ammoLbl = AMMO_LABELS[v.ammo] ?? v.ammo;
    const isBase = v.variantType === 'base';
    const vtag = VARIANT_LABELS[v.variantType] ?? v.variantType;
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

  // Helper to parse values for best-value highlighting
  const getCompareValue = (val, key) => {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    const str = String(val).replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  };

  // Stat rows
  const statRows = STAT_DEFS.map(s => {
    const isMinBest = (s.key === 'delay' || s.key === 'reload');
    const compValues = variants
      .map(v => getCompareValue(v[s.key], s.key))
      .filter(x => x !== null);
    const bestVal = compValues.length > 0
      ? (isMinBest ? Math.min(...compValues) : Math.max(...compValues))
      : null;
    const hasDiffs = compValues.length > 1 && new Set(compValues).size > 1;

    const cells = variants.map(v => {
      const val = v[s.key];
      const hasHist = !!allHistory[`${family}:${v.variantType}:${s.key}`];
      const ci = changeIndicatorHtml(family, v.variantType, s.key);
      const valHtml = val != null
        ? `${val}${s.unit ? `<span class="stat-unit"> ${s.unit}</span>` : ''}${ci}`
        : `<span class="stat-na">—</span>`;
      const attrs = hasHist
        ? `data-stat="${s.key}" data-family="${esc(family)}" data-vtype="${v.variantType}" data-label="${s.label}" data-wname="${esc(v.name)}"`
        : '';
      const isBest = hasDiffs && bestVal !== null && getCompareValue(val, s.key) === bestVal;
      const cellCls = isBest ? 'table-stat stat-best' : 'table-stat';
      return `<td><div class="${cellCls}" ${attrs}>${valHtml}</div></td>`;
    }).join('');

    let labelHtml = s.label;
    if (s.key === 'dps') {
       labelHtml = `
        <span class="dps-label-container">
          ${s.label}
          <span class="info-tooltip-trigger">
            <svg class="info-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span class="info-tooltip-content">
              <span class="tooltip-title">Формула:</span>
              <span class="formula-fraction">
                <span class="fraction-numerator">Урон × Снарядов за выстрел</span>
                <span class="fraction-denominator">Задержка</span>
              </span>
            </span>
          </span>
        </span>
      `;
    }

    return `<tr><td><div class="row-label">${labelHtml}</div></td>${cells}</tr>`;
  }).join('');

  // Projectile count row (only if at least one variant has projectileCount > 1)
  let projectileRow = '';
  const hasMultipleProjectiles = variants.some(v => v.projectileCount && v.projectileCount > 1);
  if (hasMultipleProjectiles) {
    const projCompValues = variants.map(v => v.projectileCount || 1);
    const maxProj = Math.max(...projCompValues);
    const hasProjDiffs = projCompValues.length > 1 && new Set(projCompValues).size > 1;

    projectileRow = `<tr>
        <td><div class="row-label">Кол-во снарядов за выстрел</div></td>
        ${variants.map(v => {
          const val = v.projectileCount || 1;
          const isBest = hasProjDiffs && val === maxProj;
          const cellCls = isBest ? 'table-stat stat-best' : 'table-stat';
          return `<td><div class="${cellCls}">${val}</div></td>`;
        }).join('')}
       </tr>`;
  }

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
    <div class="table-scroll-hint">↔ Прокручивайте таблицу вбок для сравнения</div>
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
          ${projectileRow}
          ${fileRow}
        </tbody>
      </table>
    </div>
    ${variants.length > 1 ? renderStatsVisualization(variants) : ''}
    <div class="detail-changelog-section" style="margin-top: 40px;">
      <h3 style="font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px;">
        История изменений оружия
      </h3>
      ${familyPatches.length === 0
      ? `<p class="no-changes" style="font-style: italic; color: var(--text-3);">Изменений для этого оружия не зафиксировано.</p>`
      : `<div class="changelog-wrap">${familyPatches.map(renderPatchCard).join('')}</div>`
    }
    </div>`;
}

// ================================================================
//  STATS PROGRESS BARS VISUALIZATION
// ================================================================
function renderStatsVisualization(variants, title = 'Визуальное сравнение веток') {
  // Max values for normalization in progress bars
  const maxDamage = Math.max(...variants.map(v => v.damage || 0));
  const maxDps = Math.max(...variants.map(v => v.dps || 0));
  const maxClip = Math.max(...variants.map(v => v.clipSize || 0));
  const maxDelay = Math.max(...variants.map(v => v.delay || 0.001));
  const maxReload = Math.max(...variants.map(v => {
    if (v.reload == null) return 0;
    const num = parseFloat(String(v.reload).replace(',', '.'));
    return isNaN(num) ? 0 : num;
  }));

  const cardsHtml = variants.map(v => {
    const dmgPct = maxDamage ? (v.damage / maxDamage) * 100 : 0;
    const dpsPct = maxDps ? (v.dps / maxDps) * 100 : 0;
    const clipPct = maxClip ? (v.clipSize / maxClip) * 100 : 0;
    const delayPct = v.delay && maxDelay ? (v.delay / maxDelay) * 100 : 0;
    
    const rVal = v.reload != null ? parseFloat(String(v.reload).replace(',', '.')) : 0;
    const reloadPct = !isNaN(rVal) && maxReload ? (rVal / maxReload) * 100 : 0;

    return `
      <div class="visual-variant-card">
        <div class="visual-variant-name">${v.name}</div>
        <div class="visual-stats-list">
          <div class="visual-stat-row">
            <div class="visual-label">Урон: <strong>${v.damage ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="width: ${dmgPct}%; background: var(--accent);"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">DPS: <strong>${v.dps ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="width: ${dpsPct}%; background: #eab308;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Магазин: <strong>${v.clipSize ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="width: ${clipPct}%; background: #3b82f6;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Задержка: <strong>${v.delay ?? '—'}c</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="width: ${delayPct}%; background: #06b6d4;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Перезарядка: <strong>${v.reload ?? '—'}c</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="width: ${reloadPct}%; background: #10b981;"></div></div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="stats-visualization-section">
      <h3 class="section-title">${title}</h3>
      <div class="visual-charts-grid">
        ${cardsHtml}
      </div>
    </div>
  `;
}

// ================================================================
//  VIEW: COMPARE SCREEN
// ================================================================
function renderComparePage() {
  if (compareList.length === 0) {
    document.getElementById('app').innerHTML = `
      <a class="back-btn" href="#weapons">← К списку оружия</a>
      <div class="empty-state" style="padding: 80px 20px;">
        <h3>Список сравнения пуст</h3>
        <p style="color: var(--text-3); margin-top: 8px;">Нажмите кнопку «⚖» на карточках любого оружия, чтобы добавить его сюда.</p>
      </div>
    `;
    return;
  }
  if (compareList.length < 2) {
    document.getElementById('app').innerHTML = `
      <a class="back-btn" href="#weapons">← К списку оружия</a>
      <div class="empty-state" style="padding: 80px 20px;">
        <h3>Недостаточно оружия для сравнения</h3>
        <p style="color: var(--text-3); margin-top: 8px;">Выберите как минимум 2 оружия для сравнения (сейчас выбрано: 1).</p>
      </div>
    `;
    return;
  }

  // Gather exact selected variants
  const selectedWeapons = [];
  for (const key of compareList) {
    const [fam, vtype] = key.split(':');
    const variants = familyMap.get(fam) || [];
    const w = variants.find(v => v.variantType === vtype);
    if (w) selectedWeapons.push(w);
  }

  // Column headers
  const colHeaders = selectedWeapons.map(w => {
    const ammoClr = AMMO_COLORS[w.ammo] ?? '#888';
    const ammoLbl = AMMO_LABELS[w.ammo] ?? w.ammo;
    return `
      <th>
        <div class="compare-header-cell">
          <span class="compare-weapon-name">${w.name}</span>
          <div style="margin-top: 4px; display: flex; gap: 6px; justify-content: center; align-items: center;">
            <span class="tier-badge ${tc(w.tier)}" style="font-size: 8px; padding: 1px 4px;">Tier ${tl(w.tier)}</span>
            <span class="ammo-badge" style="color:${ammoClr};border-color:${ammoClr}30;background:${ammoClr}12;font-size:8px;padding:1px 4px;">${ammoLbl}</span>
          </div>
          <button class="compare-remove-header-btn" onclick="toggleCompare('${esc(w.family)}:${w.variantType}')">Убрать</button>
        </div>
      </th>
    `;
  }).join('');

  // Row compare value parsing helper
  const getCompareValue = (val, key) => {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    const str = String(val).replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
  };

  const compareStats = [
    ...STAT_DEFS,
    { key: 'projectileCount', label: 'Снарядов за выстрел', unit: '' }
  ];

  const statRows = compareStats.map(s => {
    const isMinBest = (s.key === 'delay' || s.key === 'reload');
    const compValues = selectedWeapons
      .map(w => getCompareValue(w[s.key], s.key))
      .filter(x => x !== null);
    const bestVal = compValues.length > 0
      ? (isMinBest ? Math.min(...compValues) : Math.max(...compValues))
      : null;
    const hasDiffs = compValues.length > 1 && new Set(compValues).size > 1;

    const cells = selectedWeapons.map(w => {
      const val = w[s.key];
      const valHtml = val != null ? `${val}${s.unit ? ` ${s.unit}` : ''}` : '—';
      const isBest = hasDiffs && bestVal !== null && getCompareValue(val, s.key) === bestVal;
      const cellCls = isBest ? 'table-stat stat-best' : 'table-stat';
      return `<td><div class="${cellCls}">${valHtml}</div></td>`;
    }).join('');

    return `<tr><td><div class="row-label">${s.label}</div></td>${cells}</tr>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    <a class="back-btn" href="#weapons">← К списку оружия</a>
    <div class="detail-title-row" style="margin-bottom: 24px;">
      <span class="detail-title">Сравнение оружия</span>
    </div>
    <div class="table-scroll-hint">↔ Прокручивайте таблицу вбок для сравнения</div>
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
        </tbody>
      </table>
    </div>
    ${renderStatsVisualization(selectedWeapons, 'Визуальное сравнение оружия')}
  `;
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
    : changes.map(ch => renderChangeCard(ch, patch.patch)).join('');

  return `
    <div class="patch-card" id="patch-${patch.patch}">
      <div class="patch-head">
        <span class="patch-version">${patch.patch}</span>
        <span class="patch-date">${fmtDate(patch.date)}</span>
        ${patch.description ? `<span class="patch-desc">${patch.description}</span>` : ''}
        ${changes.length ? `<span class="patch-change-count">${changes.length} изм.</span>` : ''}
      </div>
      <div class="patch-body">${changesHtml}</div>
    </div>`;
}

function renderChangeCard(ch, patchVersion) {
  const weapon = findWeaponForChange(ch);
  if (!weapon) return '';

  const family = weapon.family;
  const variantType = weapon.variantType;
  const wname = weapon.name;
  const tier = weapon.tier;
  const vtag = VARIANT_LABELS[variantType] ?? variantType;
  const baseKey = `${family}:${variantType}`;

  const variants = familyMap.get(family) || [];
  const baseW = variants.find(v => v.variantType === 'base') || weapon;
  const baseMainName = parseWeaponName(baseW.name);

  const diffs = Object.entries(ch.stats).map(([stat, val]) => {
    const def = STAT_DEFS.find(s => s.key === stat);
    const lbl = def?.label ?? stat;
    const unit = def?.unit ?? '';

    // Get the resolved history entry for this patch and stat
    const historyKey = `${baseKey}:${stat}`;
    const history = allHistory[historyKey] || [];
    const entry = history.find(h => h.patch === patchVersion) || {};

    const oldVal = entry.old;
    const newVal = entry.new;

    const num = typeof newVal === 'number' && typeof oldVal === 'number';
    const isBuff = checkIsBuff(stat, newVal, oldVal);
    const isNerf = checkIsNerf(stat, newVal, oldVal);
    const cls = isBuff ? 'buff' : isNerf ? 'nerf' : 'neutral';
    const deltaVal = num ? (newVal - oldVal) : 0;
    const delta = num ? (deltaVal > 0 ? `+${r2(deltaVal)}` : `${r2(deltaVal)}`) : '';
    const oldValHtml = oldVal !== undefined ? oldVal : '?';
    const newValHtml = newVal !== undefined ? newVal : '?';

    return `
      <div class="diff-chip ${cls}">
        <span class="diff-stat-name">${lbl}</span>
        <span class="diff-old">${oldValHtml}${unit}</span>
        <span class="diff-arrow">→</span>
        <span class="diff-new ${cls}">${newValHtml}${unit}</span>
        ${delta ? `<span class="diff-delta ${cls}">(${delta})</span>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="change-card">
      <div class="change-head">
        ${tier != null ? `<span class="tier-badge ${tc(tier)}">${tl(tier)}</span>` : ''}
        <div>
          <span class="change-weapon-name">${wname}</span>
          <span class="change-family-tag">${baseMainName} · ${vtag}</span>
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
  const key = `${family}:${vtype}:${statKey}`;
  const history = allHistory[key] ?? [];
  const def = STAT_DEFS.find(s => s.key === statKey);
  const unit = def?.unit ?? '';

  // Current value from weapon data
  const weapon = (familyMap.get(family) ?? []).find(v => v.variantType === vtype);
  const curVal = weapon?.[statKey];

  // Baseline = value before the first recorded change (or current if no history)
  const baseline = history.length ? history[0].old : curVal;

  let rows = '';

  // Baseline row
  rows += `
    <div class="history-row">
      <a href="#patch-v1.0" class="h-patch-link" data-close-modal>v1.0</a>
      <span class="h-date">Изначально</span>
      <div class="h-change"><span class="h-value-only">${baseline}${unit}</span></div>
      <span class="h-tag-base">База</span>
    </div>`;

  // Each recorded change
  history.forEach((h, i) => {
    const num = typeof h.new === 'number' && typeof h.old === 'number';
    const isBuff = checkIsBuff(statKey, h.new, h.old);
    const isNerf = checkIsNerf(statKey, h.new, h.old);
    const dir = isBuff ? 'buff' : isNerf ? 'nerf' : 'neutral';
    const rowCls = isBuff ? 'buff-row' : isNerf ? 'nerf-row' : '';
    const deltaVal = num ? (h.new - h.old) : 0;
    const delta = num ? (deltaVal > 0 ? `+${r2(deltaVal)}` : `${r2(deltaVal)}`) : '';
    const isCur = i === history.length - 1;

    rows += `
      <div class="history-row ${rowCls} ${isCur ? 'is-current' : ''}">
        <a href="#patch-${h.patch}" class="h-patch-link" data-close-modal>${h.patch}</a>
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

  document.getElementById('modal-title').textContent = `${statLabel} — история изменений`;
  document.getElementById('modal-subtitle').textContent = weaponName;
  document.getElementById('modal-body').innerHTML = `<div class="history-list">${rows}</div>`;
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
  const isBuff = checkIsBuff(stat, ch.new, ch.old);
  const isNerf = checkIsNerf(stat, ch.new, ch.old);
  if (!isBuff && !isNerf) return '';
  const cls = isBuff ? 'buff' : 'nerf';
  const arrow = ch.new > ch.old ? '▲' : '▼';
  return `<span class="ci ${cls}" data-patch="${ch.patch}" title="${ch.patch}: ${ch.old} → ${ch.new}">${arrow}</span>`;
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

function parseWeaponName(fullName) {
  const m = fullName.match(/^['"’](.*?)['"’]\s*(.*)$/);
  return m ? m[2].trim() : fullName;
}

function checkIsBuff(stat, newVal, oldVal) {
  if (typeof newVal !== 'number' || typeof oldVal !== 'number') return false;
  if (newVal === oldVal) return false;
  if (stat === 'delay' || stat === 'reload') {
    return newVal < oldVal; // Lower is better
  }
  return newVal > oldVal; // Higher is better
}

function checkIsNerf(stat, newVal, oldVal) {
  if (typeof newVal !== 'number' || typeof oldVal !== 'number') return false;
  if (newVal === oldVal) return false;
  if (stat === 'delay' || stat === 'reload') {
    return newVal > oldVal; // Higher is worse
  }
  return newVal < oldVal; // Lower is worse
}

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
  if (n % 10 === 1 && n % 100 !== 11) return 'ветка';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'ветки';
  return 'веток';
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
