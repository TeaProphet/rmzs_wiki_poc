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

function renderAmmoTag(ammoType) {
  if (!ammoType) return '';
  const label = AMMO_LABELS[ammoType] ?? ammoType;
  const color = AMMO_COLORS[ammoType] ?? '#888';
  const imgUrl = `img/ammo/${ammoType}.png`;
  
  return `
    <span class="ammo-icon-mask" style="display: inline-block; width: 24px; height: 24px; background-color: ${color}; -webkit-mask-image: url('${imgUrl}'); mask-image: url('${imgUrl}'); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; vertical-align: middle; flex-shrink:0;" title="Патроны: ${label}"></span>
  `;
}

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

const favorites = new Set(JSON.parse(localStorage.getItem('wiki_favorites') || '[]'));

const filters = {
  search: '',
  tiers: new Set(),
  ammos: new Set(),
  sortBy: 'default',
  sortOrder: 'asc',
  favoritesOnly: false,
  showStatFilters: false,
  statBounds: {
    damage: { min: null, max: null },
    clipSize: { min: null, max: null },
    delay: { min: null, max: null },
    reload: { min: null, max: null },
    dps: { min: null, max: null }
  }
};

function hasFiltersActive() {
  const hasBounds = Object.values(filters.statBounds).some(b => b.min !== null || b.max !== null);
  return filters.tiers.size > 0 || filters.ammos.size > 0 || filters.sortBy !== 'default' || filters.favoritesOnly || hasBounds;
}

function resetFilters() {
  filters.tiers.clear();
  filters.ammos.clear();
  filters.sortBy = 'default';
  filters.sortOrder = 'asc';
  filters.favoritesOnly = false;
  filters.showStatFilters = false;
  for (const key in filters.statBounds) {
    filters.statBounds[key].min = null;
    filters.statBounds[key].max = null;
  }
  renderWeapons();
}

function toggleFavorite(key) {
  if (favorites.has(key)) {
    favorites.delete(key);
  } else {
    favorites.add(key);
  }
  localStorage.setItem('wiki_favorites', JSON.stringify([...favorites]));
  renderWeapons();
}

function toggleFavoritesFilter() {
  filters.favoritesOnly = !filters.favoritesOnly;
  renderWeapons();
}

function toggleStatFiltersPanel() {
  filters.showStatFilters = !filters.showStatFilters;
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

function calcDps(w) {
  const damage = w.damage || 0;
  const delay = w.delay || 0;
  const projCount = w.projectileCount ?? 1;
  
  if (delay <= 0) return 0;
  
  const reloadVal = w.reload != null ? parseFloat(String(w.reload).replace(',', '.')) : null;
  const clipVal = w.clipSize != null ? parseInt(w.clipSize, 10) : null;
  
  if (reloadVal !== null && !isNaN(reloadVal) && clipVal !== null && !isNaN(clipVal) && clipVal > 0) {
    const totalDamage = clipVal * damage * projCount;
    const cycleTime = Math.max(0.001, ((clipVal - 1) * delay) + reloadVal);
    return Math.round(totalDamage / cycleTime);
  }
  
  return Math.round((damage * projCount) / delay);
}

function buildChangesIndex() {
  allHistory = {};
  latestChange = {};

  // Calculate initial DPS dynamically using Sustained DPS formula
  for (const w of weaponsData) {
    w.projectileCount = w.projectileCount ?? 1;
    w.dps = calcDps(w);
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
        if (stat === 'damage' || stat === 'delay' || stat === 'clipSize' || stat === 'reload' || stat === 'projectileCount') {
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

      // Automatically recalculate and override DPS if stats influencing DPS changed
      if (hasDmgOrDlyChange) {
        const newDps = calcDps(weapon);
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
    const family = decodeURIComponent(hash.slice(8));
    location.hash = `#weapon/${encodeURIComponent(family)}:base`;
  } else if (hash.startsWith('#weapon/')) {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    renderWeaponDetail(decodeURIComponent(hash.slice(8)));
  } else if (hash.startsWith('#compare')) {
    tabW.classList.add('active');
    tabCL.classList.remove('active');
    
    const match = hash.match(/#compare\?w=([^&]+)/);
    if (match) {
      compareList = match[1].split(',').filter(Boolean);
    }
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
  let isAdded = false;
  if (idx > -1) {
    compareList.splice(idx, 1);
  } else {
    if (compareList.length >= 5) {
      showToast("Можно сравнивать не более 5 видов оружия одновременно!", "warning");
      return;
    }
    compareList.push(wkey);
    isAdded = true;
  }
  updateCompareWidget();
  
  // Re-render based on current route to reflect compare badges
  const hash = location.hash || '#weapons';
  if (hash === '#weapons') {
    renderWeapons();
  } else if (hash.startsWith('#compare')) {
    if (compareList.length < 2) {
      location.hash = '#weapons';
    } else {
      location.hash = `#compare?w=${compareList.join(',')}`;
    }
  } else if (hash.startsWith('#weapon/')) {
    // Update the button directly in DOM instead of full page re-render
    const btn = document.getElementById('detail-compare-btn');
    if (btn && btn.dataset.wkey === wkey) {
      btn.classList.toggle('active', isAdded);
      btn.innerHTML = `⚖ ${isAdded ? 'В сравнении' : 'Сравнить'}`;
    }
  }
}

function updateCompareWidget() {
  const widget = document.getElementById('compare-widget');
  if (!widget) return;
  
  const hash = location.hash || '#weapons';
  if (compareList.length === 0 || hash.startsWith('#compare')) {
    widget.classList.add('hidden');
    return;
  }
  
  widget.classList.remove('hidden');
  widget.innerHTML = `
    <div class="compare-widget-title">
      <span>⚖ Сравнение (${compareList.length}/5)</span>
      <button id="compare-widget-clear-btn" class="compare-widget-clear-btn" title="Сбросить всё">Сбросить</button>
    </div>
    <div class="compare-widget-items">
      ${compareList.map(key => {
        const [fam, vtype] = key.split(':');
        const variants = familyMap.get(fam) || [];
        const w = variants.find(v => v.variantType === vtype) || {};
        const name = w.name || fam;
        return `
          <div class="compare-widget-item">
            <span style="font-weight:600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 170px;">${name}</span>
            <button class="compare-widget-remove-btn" data-wkey="${esc(key)}">×</button>
          </div>
        `;
      }).join('')}
    </div>
    <button id="compare-widget-go-btn" class="compare-widget-go-btn" style="border:none; cursor:pointer; width:100%; display:block;">Сравнить</button>
  `;
}

function goCompare() {
  if (compareList.length < 2) {
    showToast("Выберите как минимум 2 оружия для сравнения!", "warning");
    return;
  }
  location.hash = `#compare?w=${compareList.join(',')}`;
}

function removeCompare() {
  compareList = [];
  updateCompareWidget();
}

function openHelpModal() {
  const body = `
    <div class="help-content" style="display: flex; flex-direction: column; gap: 20px; font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.6; color: var(--text-2);">
      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">🔍 Поиск, сортировка и фильтры</h4>
        <p>Вы можете искать оружие по названию или по имени lua-файла. Доступны фильтры по <strong>тирам (T1-T6)</strong> и <strong>типам патронов</strong> (можно выбирать <strong>несколько значений одновременно</strong>).</p>
        <p>Кнопка <strong>«Поиск по характеристикам»</strong> открывает панель диапазонов («от» и «до») для числовых параметров: Урон, DPS, Магазин, Задержка, Перезарядка.</p>
        <p>Клик по кнопке сортировки упорядочит список. Повторный клик изменит направление сортировки (по возрастанию / убыванию), что отмечается стрелкой.</p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">⭐ Избранное оружие</h4>
        <p>Нажмите звездочку <strong>★</strong> на любой карточке оружия, чтобы сохранить конкретную ветку в Избранное. Включив фильтр <strong>«Только избранное»</strong>, вы скроете всё остальное. Список сохраняется в памяти вашего браузера.</p>
      </div>
      
      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">⚖ Сравнение оружия</h4>
        <p>Иконка весов <strong>⚖</strong> добавляет выбранное оружие в сравнение (до <strong>5 единиц одновременно</strong>). В виджете внизу экрана нажмите кнопку <strong>«Сравнить»</strong> для перехода к детальной таблице.</p>
        <p>В таблице лучшие характеристики выделяются зеленым цветом. Список сравнения кодируется в URL-адресе, поэтому ссылкой на сравнение можно поделиться с другими игроками.</p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">📈 История изменений и индикаторы патчей</h4>
        <p>Клик по любой числовой характеристике откроет окно с историей её изменений. Рядом с изменёнными параметрами выводятся цветные стрелки: <span style="color: var(--buff);">▲ (бафф)</span> и <span style="color: var(--nerf);">▼ (нерф)</span>.</p>
        <p><strong>Клик по стрелке</strong> перенесёт вас во вкладку <strong>Changelog</strong> к конкретному патчу, в котором это изменение было выпущено. Патч автоматически прокрутится на экран и подсветится кратковременной вспышкой.</p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">🔗 Умные кнопки «Поделиться»</h4>
        <p>Вы можете скопировать готовую ссылку с помощью кнопок <strong>«Поделиться»</strong> в детальном просмотре оружия, в сравнении, а также у каждого отдельного патча в истории изменений (ссылка прокрутит и подсветит именно этот патч при открытии).</p>
      </div>

      <div>
        <h4 style="font-family: 'Rajdhani', sans-serif; font-size: 15px; color: var(--accent); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">⌨ Горячие клавиши (Hotkeys)</h4>
        <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
          <li><strong>/</strong> — быстрый фокус в строку поиска.</li>
          <li><strong>Esc</strong> — закрыть модальное окно.</li>
          <li><strong>ArrowLeft / ArrowRight</strong> — быстрое перелистывание оружия по алфавиту в детальном просмотре.</li>
        </ul>
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

  // Listen for stat bound inputs
  document.addEventListener('change', e => {
    if (e.target.classList.contains('stat-range-input')) {
      const stat = e.target.dataset.filterStat;
      const bound = e.target.dataset.filterBound;
      const valStr = e.target.value.trim();
      const val = valStr === '' ? null : parseFloat(valStr);
      filters.statBounds[stat][bound] = val;
      renderWeapons();
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

    // Toggle stat filters button (has .chip class, checked first)
    const statsToggleBtn = e.target.closest('.stats-toggle-btn');
    if (statsToggleBtn) {
      e.stopPropagation();
      toggleStatFiltersPanel();
      return;
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

    // 1. Compare widget item remove button
    const widgetRemoveBtn = e.target.closest('.compare-widget-remove-btn');
    if (widgetRemoveBtn) {
      e.stopPropagation();
      toggleCompare(widgetRemoveBtn.dataset.wkey);
      return;
    }

    // 2. Go compare button
    const goCompareBtn = e.target.closest('#compare-widget-go-btn');
    if (goCompareBtn) {
      e.stopPropagation();
      goCompare();
      return;
    }

    // 3. Reset filters button
    const resetFiltersBtn = e.target.closest('.reset-filters-btn');
    if (resetFiltersBtn) {
      e.stopPropagation();
      resetFilters();
      return;
    }

    // 4. Reset compare button
    const resetCompareBtn = e.target.closest('#compare-widget-clear-btn');
    if (resetCompareBtn) {
      e.stopPropagation();
      removeCompare();
      return;
    }


    // 5. Toggle favorites button
    const favFilterBtn = e.target.closest('.fav-filter-btn');
    if (favFilterBtn) {
      e.stopPropagation();
      toggleFavoritesFilter();
      return;
    }

    // 6. Detail compare button
    const detailCompareBtn = e.target.closest('#detail-compare-btn');
    if (detailCompareBtn) {
      e.stopPropagation();
      toggleCompare(detailCompareBtn.dataset.wkey);
      return;
    }

    // 7. Clear compare button
    const clearCompareBtn = e.target.closest('#clear-compare-btn');
    if (clearCompareBtn) {
      e.stopPropagation();
      compareList = [];
      updateCompareWidget();
      showToast("Список сравнения сброшен!", "success");
      renderComparePage();
      return;
    }

    // 8. Share detail / Share patch buttons
    const shareDetailBtn = e.target.closest('#share-detail-btn');
    if (shareDetailBtn) {
      e.stopPropagation();
      copyToClipboard(window.location.href, shareDetailBtn);
      return;
    }
    const sharePatchBtn = e.target.closest('.share-patch-btn');
    if (sharePatchBtn) {
      e.stopPropagation();
      const patchVal = sharePatchBtn.dataset.patch;
      const url = `${window.location.origin}${window.location.pathname}#patch-${encodeURIComponent(patchVal)}`;
      copyToClipboard(url, sharePatchBtn);
      return;
    }

    // 7. Compare remove header button
    const compareRemoveHeaderBtn = e.target.closest('.compare-remove-header-btn');
    if (compareRemoveHeaderBtn) {
      e.stopPropagation();
      toggleCompare(compareRemoveHeaderBtn.dataset.wkey);
      return;
    }

    // Favorite badge click
    const favBadge = e.target.closest('.fav-card-badge');
    if (favBadge) {
      e.stopPropagation();
      e.preventDefault();
      toggleFavorite(favBadge.dataset.wkey);
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

    // Family card → navigate to individual weapon variant detail
    const card = e.target.closest('.family-card[data-wkey]');
    if (card) {
      if (e.target.closest('.fav-card-badge') || e.target.closest('.compare-card-badge')) {
        return;
      }
      location.hash = '#weapon/' + encodeURIComponent(card.dataset.wkey);
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modalOverlay = document.getElementById('modal-overlay');
      const isModalOpen = modalOverlay && !modalOverlay.classList.contains('hidden');
      const mobileSearchPanel = document.getElementById('mobile-search-panel');
      const isMobileSearchOpen = mobileSearchPanel && mobileSearchPanel.classList.contains('open');

      if (isModalOpen) {
        closeModal();
      } else if (isMobileSearchOpen) {
        closeMobileSearch();
      } else {
        const hash = location.hash || '#weapons';
        if (hash !== '#weapons') {
          location.hash = '#weapons';
        }
      }
    }

    // Focus search with '/'
    if (e.key === '/') {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }
      e.preventDefault();
      const isMobile = window.innerWidth <= 700;
      if (isMobile) {
        openMobileSearch();
      } else {
        const searchInp = document.getElementById('search-input');
        if (searchInp) {
          searchInp.focus();
          searchInp.select();
        }
      }
    }

    // Navigation with Left/Right Arrows in Detailed View
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const hash = location.hash || '#weapons';
      if (hash.startsWith('#weapon/')) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          return;
        }
        const currentWKey = decodeURIComponent(hash.split('/')[1]);
        const sortedWeaponsKeys = weaponsData.map(w => `${w.family}:${w.variantType}`).sort();
        const curIndex = sortedWeaponsKeys.indexOf(currentWKey);
        if (curIndex !== -1) {
          e.preventDefault();
          if (e.key === 'ArrowLeft') {
            const prevWKey = sortedWeaponsKeys[(curIndex - 1 + sortedWeaponsKeys.length) % sortedWeaponsKeys.length];
            location.hash = '#weapon/' + encodeURIComponent(prevWKey);
          } else {
            const nextWKey = sortedWeaponsKeys[(curIndex + 1) % sortedWeaponsKeys.length];
            location.hash = '#weapon/' + encodeURIComponent(nextWKey);
          }
        }
      }
    }
  });
}

function applySearch(value) {
  filters.search = value.trim().toLowerCase();
  if (!location.hash.startsWith('#weapon/') && location.hash !== '#changelog') {
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
    if (filters.favoritesOnly && !favorites.has(w.family + ':' + w.variantType)) return false;
    if (filters.tiers.size > 0 && !filters.tiers.has(String(w.tier))) return false;
    if (filters.ammos.size > 0 && !filters.ammos.has(w.ammo)) return false;

    // Bounds check
    for (const key in filters.statBounds) {
      const bound = filters.statBounds[key];
      const val = w[key];
      if (val != null) {
        const numVal = parseFloat(String(val).replace(',', '.'));
        if (!isNaN(numVal)) {
          if (bound.min !== null && numVal < bound.min) return false;
          if (bound.max !== null && numVal > bound.max) return false;
        }
      } else if (bound.min !== null || bound.max !== null) {
        return false;
      }
    }

    if (filters.search) {
      const q = filters.search;
      return w.name.toLowerCase().includes(q) || w.file.toLowerCase().includes(q);
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

  // Update DOM: check if the skeleton exists
  const hasSkeleton = document.querySelector('.filters-container') !== null;
  if (hasSkeleton) {
    // Update chip active states
    document.querySelectorAll('[data-tier]').forEach(btn => {
      btn.classList.toggle('active', filters.tiers.has(btn.dataset.tier));
    });
    document.querySelectorAll('[data-ammo]').forEach(btn => {
      const isActive = filters.ammos.has(btn.dataset.ammo);
      btn.classList.toggle('active', isActive);
      const ammoClr = AMMO_COLORS[btn.dataset.ammo] ?? '#888';
      const iconSpan = btn.querySelector('span');
      if (iconSpan) {
        iconSpan.style.backgroundColor = isActive ? ammoClr : '#52525b';
      }
    });
    document.querySelectorAll('[data-sort]').forEach(btn => {
      const sortBy = btn.dataset.sort;
      const isActive = filters.sortBy === sortBy;
      btn.classList.toggle('active', isActive);
      if (sortBy !== 'default') {
        const label = sortBy === 'damage' ? 'Урон' :
                      sortBy === 'dps' ? 'DPS' :
                      sortBy === 'clipSize' ? 'Магазин' :
                      sortBy === 'delay' ? 'Задержка' : 'Перезарядка';
        const arrow = filters.sortBy === sortBy ? (filters.sortOrder === 'asc' ? ' ▲' : ' ▼') : '';
        btn.textContent = `${label} ${arrow}`.trim();
      }
    });

    const favBtn = document.querySelector('.fav-filter-btn');
    if (favBtn) {
      favBtn.classList.toggle('active', filters.favoritesOnly);
    }
    const statsToggle = document.querySelector('.stats-toggle-btn');
    if (statsToggle) {
      statsToggle.classList.toggle('active', filters.showStatFilters);
    }

    let statPanel = document.querySelector('.stat-filters-panel');
    if (filters.showStatFilters) {
      if (!statPanel) {
        const actionsRow = document.querySelector('.filter-actions-row');
        if (actionsRow) {
          const panelHtml = `
            <div class="stat-filters-panel">
              ${STAT_DEFS.map(s => {
                const bound = filters.statBounds[s.key];
                const minVal = bound.min !== null ? bound.min : '';
                const maxVal = bound.max !== null ? bound.max : '';
                return `
                  <div class="stat-filter-row">
                    <span class="stat-filter-title">${s.label}</span>
                    <input type="number" step="any" placeholder="от" class="stat-range-input" data-filter-stat="${s.key}" data-filter-bound="min" value="${minVal}">
                    <span style="color: var(--text-3)">—</span>
                    <input type="number" step="any" placeholder="до" class="stat-range-input" data-filter-stat="${s.key}" data-filter-bound="max" value="${maxVal}">
                  </div>
                `;
              }).join('')}
            </div>
          `;
          actionsRow.insertAdjacentHTML('afterend', panelHtml);
        }
      }
    } else if (statPanel) {
      statPanel.remove();
    }

    const actionsRow = document.querySelector('.filter-actions-row');
    if (actionsRow) {
      let resetBtnEl = actionsRow.querySelector('.reset-filters-btn');
      if (hasFiltersActive()) {
        if (!resetBtnEl) {
          actionsRow.insertAdjacentHTML('beforeend', `<button class="reset-filters-btn">✕ Сбросить фильтры</button>`);
        }
      } else if (resetBtnEl) {
        resetBtnEl.remove();
      }
    }

    const resultsInfo = document.querySelector('.results-info');
    if (resultsInfo) {
      resultsInfo.innerHTML = `Показано оружия: <strong>${filteredWeapons.length}</strong> из <strong>${weaponsData.length}</strong>`;
    }

    const resultsContainer = document.querySelector('.results-container');
    if (resultsContainer) {
      const grid = resultsContainer.querySelector('.weapons-grid');
      const emptyState = resultsContainer.querySelector('.empty-state');
      if (filteredWeapons.length === 0) {
        if (grid) grid.remove();
        if (!emptyState) {
          resultsContainer.insertAdjacentHTML('beforeend', `<div class="empty-state"><h3>Ничего не найдено</h3><p>Попробуйте другой запрос или сбросьте фильтры</p></div>`);
        }
      } else {
        if (emptyState) emptyState.remove();
        const gridHtml = `<div class="weapons-grid">${filteredWeapons.map(renderWeaponCard).join('')}</div>`;
        const currentGrid = resultsContainer.querySelector('.weapons-grid');
        if (currentGrid) {
          currentGrid.outerHTML = gridHtml;
        } else {
          resultsContainer.insertAdjacentHTML('beforeend', gridHtml);
        }
      }
    }
    return;
  }

  const resetBtn = hasFiltersActive()
    ? `<button class="reset-filters-btn">✕ Сбросить фильтры</button>`
    : '';

  document.getElementById('app').innerHTML = `
    <div class="filters-container">
      <div class="filters-bar">
        <div class="filter-group">
          <span class="filter-label">Тир</span>
          <div class="filter-chips">
            ${allTiers.map(t => {
              const isActive = filters.tiers.has(String(t));
              const styleAttr = `style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0; border-radius:0; font-family:'Rajdhani', sans-serif; font-weight:700; font-size:13px;"`;
              return `
                <button class="chip${isActive ? ' active' : ''}" data-tier="${t}" ${styleAttr}>T${t}</button>
              `;
            }).join('')}
          </div>
        </div>
        <div class="filter-group">
          <span class="filter-label">Патроны</span>
          <div class="filter-chips">
            ${allAmmos.map(a => {
              const isActive = filters.ammos.has(a);
              const ammoClr = AMMO_COLORS[a] ?? '#888';
              const styleAttr = `style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; padding:0; border:none !important; background:transparent !important; box-shadow:none !important; cursor:pointer;"`;
              const iconColor = isActive ? ammoClr : '#52525b';
              const imgUrl = `img/ammo/${a}.png`;
              return `
                <button class="chip${isActive ? ' active' : ''}" data-ammo="${a}" ${styleAttr} title="${AMMO_LABELS[a] ?? a}">
                  <span style="display: inline-block; width: 34px; height: 34px; background-color: ${iconColor}; -webkit-mask-image: url('${imgUrl}'); mask-image: url('${imgUrl}'); -webkit-mask-size: contain; mask-size: contain; -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; transition: background-color var(--ease);"></span>
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
      </div>
      <div class="filter-actions-row">
        <button class="chip stats-toggle-btn${filters.showStatFilters ? ' active' : ''}" style="margin: 0; display: inline-flex; align-items: center; gap: 6px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width: 13px; height: 13px; vertical-align: middle;"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
          Поиск по характеристикам
        </button>
        <button class="fav-filter-btn${filters.favoritesOnly ? ' active' : ''}">
          ⭐ Только избранное
        </button>
        ${resetBtn}
      </div>
      ${filters.showStatFilters ? `
        <div class="stat-filters-panel">
          ${STAT_DEFS.map(s => {
            const bound = filters.statBounds[s.key];
            const minVal = bound.min !== null ? bound.min : '';
            const maxVal = bound.max !== null ? bound.max : '';
            return `
              <div class="stat-filter-row">
                <span class="stat-filter-title">${s.label}</span>
                <input type="number" step="any" placeholder="от" class="stat-range-input" data-filter-stat="${s.key}" data-filter-bound="min" value="${minVal}">
                <span style="color: var(--text-3)">—</span>
                <input type="number" step="any" placeholder="до" class="stat-range-input" data-filter-stat="${s.key}" data-filter-bound="max" value="${maxVal}">
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}
    </div>
    <div class="results-container">
      <div class="results-info">
        Показано оружия: <strong>${filteredWeapons.length}</strong> из <strong>${weaponsData.length}</strong>
      </div>
      ${filteredWeapons.length === 0
        ? `<div class="empty-state"><h3>Ничего не найдено</h3><p>Попробуйте другой запрос или сбросьте фильтры</p></div>`
        : `<div class="weapons-grid">${filteredWeapons.map(renderWeaponCard).join('')}</div>`
      }
    </div>
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

  let nameHtml = esc(w.name);
  let subHtml = esc(`${baseMainName} · ${vtag}`);

  if (filters.search) {
    const escapedSearch = escapeRegExp(esc(filters.search));
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    nameHtml = nameHtml.replace(regex, '<mark class="search-highlight">$1</mark>');
    subHtml = subHtml.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

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
              <span class="tooltip-title">DPS формула:</span>
              <span class="formula-fraction">
                <span class="fraction-numerator">Магазин × Урон × Снарядов</span>
                <span class="fraction-denominator">((Магазин - 1) × Задержка) + Перезарядка</span>
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
    <div class="family-card ${tc(tier)}" data-wkey="${esc(family)}:${w.variantType}">
      <div class="card-header">
        <div class="card-top-bar">
          <div class="card-actions-left">
            <span class="fav-card-badge ${favorites.has(family + ':' + w.variantType) ? 'active' : ''}" data-wkey="${esc(family)}:${w.variantType}" title="В избранное">${favorites.has(family + ':' + w.variantType) ? '★' : '☆'}</span>
            <span class="compare-card-badge ${compareList.includes(family + ':' + w.variantType) ? 'active' : ''}" data-wkey="${esc(family)}:${w.variantType}" title="Сравнить оружие">⚖</span>
          </div>
          <div class="card-tags-right" style="display: flex; gap: 6px; align-items: center;">
            <span class="tier-badge ${tc(tier)}" style="display: inline-flex; align-items: center; justify-content: center; width: 24px !important; height: 24px !important; padding: 0 !important; border-radius: 0 !important; font-size: 11.5px; font-family: 'Rajdhani', sans-serif; font-weight: 700; box-sizing: border-box !important;">${tl(tier)}</span>
            ${renderAmmoTag(ammo)}
          </div>
        </div>
        <div class="card-header-main">
          <div class="card-header-info">
            <div class="family-name" title="${esc(w.name)}">${nameHtml}</div>
            <div class="base-weapon-name" title="${esc(baseMainName)} · ${vtag}">${subHtml}</div>
          </div>
          ${w.image ? `
            <div class="card-weapon-image-container">
              <img src="${w.image}" alt="${esc(w.name)}" class="card-weapon-image">
            </div>
          ` : ''}
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
function renderWeaponDetail(wkey) {
  const [family, variantType] = wkey.split(':');
  const variants = familyMap.get(family) || [];
  if (variants.length === 0) { location.hash = '#weapons'; return; }

  const currentWeapon = variants.find(v => v.variantType === variantType) || variants[0];
  const base = variants.find(v => v.variantType === 'base') || variants[0];
  const tier = currentWeapon.tier;

  // Filter patches that have changes for this specific weapon variant
  const weaponPatches = [];
  const sortedPatches = [...changelogData].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const patch of sortedPatches) {
    if (!patch.changes?.length) continue;
    const matchingChanges = patch.changes.filter(ch => {
      const w = findWeaponForChange(ch);
      return w && w.family === family && w.variantType === variantType;
    });
    if (matchingChanges.length > 0) {
      weaponPatches.push({
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
    const isCurrent = v.variantType === variantType;
    const vtag = VARIANT_LABELS[v.variantType] ?? v.variantType;
    return `
      <th class="${isCurrent ? 'active-col-header' : ''}">
        <div class="col-header">
          <a href="#weapon/${encodeURIComponent(v.family + ':' + v.variantType)}" class="col-weapon-name">${v.name}</a>
          <div class="col-badges">
            <span class="variant-tag ${isBase ? 'base' : 'branch'}">${vtag}</span>
            ${renderAmmoTag(v.ammo, true)}
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
      const isCurrent = v.variantType === variantType;
      
      let cellCls = 'table-stat';
      if (isBest) cellCls += ' stat-best';
      if (isCurrent) cellCls += ' stat-current';

      return `<td class="${isCurrent ? 'active-col-cell' : ''}"><div class="${cellCls}" ${attrs}>${valHtml}</div></td>`;
    }).join('');

    let labelHtml = s.label;
    if (s.key === 'dps') {
       labelHtml = `
        <span class="dps-label-container">
          ${s.label}
          <span class="info-tooltip-trigger">
            <svg class="info-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            <span class="info-tooltip-content">
              <span class="tooltip-title">DPS формула:</span>
              <span class="formula-fraction">
                <span class="fraction-numerator">Магазин × Урон × Снарядов</span>
                <span class="fraction-denominator">((Магазин - 1) × Задержка) + Перезарядка</span>
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
          const isCurrent = v.variantType === variantType;
          let cellCls = 'table-stat';
          if (isBest) cellCls += ' stat-best';
          if (isCurrent) cellCls += ' stat-current';
          return `<td class="${isCurrent ? 'active-col-cell' : ''}"><div class="${cellCls}">${val}</div></td>`;
        }).join('')}
       </tr>`;
  }

  // File row
  const fileRow = `
    <tr>
      <td><div class="row-label">Файл</div></td>
      ${variants.map(v => {
        const isCurrent = v.variantType === variantType;
        return `<td class="${isCurrent ? 'active-col-cell' : ''}"><span class="file-name">${v.file}</span></td>`;
      }).join('')}
    </tr>`;

  // For single variant family, render static characteristics table
  let singleStatsHtml = '';
  if (variants.length === 1) {
    const rows = [];
    
    // Damage
    rows.push(`<tr><td><div class="row-label">Урон</div></td><td><div class="table-stat">${currentWeapon.damage ?? '—'}</div></td></tr>`);
    
    // DPS
    const dpsVal = currentWeapon.dps ?? '—';
    rows.push(`<tr><td><div class="row-label">DPS</div></td><td><div class="table-stat">${dpsVal}</div></td></tr>`);
    
    // Clip size
    rows.push(`<tr><td><div class="row-label">Магазин</div></td><td><div class="table-stat">${currentWeapon.clipSize ?? '—'}</div></td></tr>`);
    
    // Delay
    const delayVal = currentWeapon.delay != null ? `${currentWeapon.delay} с` : '—';
    rows.push(`<tr><td><div class="row-label">Задержка</div></td><td><div class="table-stat">${delayVal}</div></td></tr>`);
    
    // Reload
    const reloadVal = currentWeapon.reload != null ? `${currentWeapon.reload} с` : '—';
    rows.push(`<tr><td><div class="row-label">Перезарядка</div></td><td><div class="table-stat">${reloadVal}</div></td></tr>`);
    
    // Projectiles (only if > 1)
    if (currentWeapon.projectileCount && currentWeapon.projectileCount > 1) {
      rows.push(`<tr><td><div class="row-label">Кол-во снарядов за выстрел</div></td><td><div class="table-stat">${currentWeapon.projectileCount}</div></td></tr>`);
    }
    
    // Ammo
    rows.push(`<tr><td><div class="row-label">Боеприпасы</div></td><td><div class="table-stat">${renderAmmoTag(currentWeapon.ammo, true)}</div></td></tr>`);
    
    // File/Classname
    rows.push(`<tr><td><div class="row-label">Файл</div></td><td><span class="file-name">${currentWeapon.file}</span></td></tr>`);
    
    singleStatsHtml = `
      <div class="detail-single-stats-section" style="margin-top: 32px; margin-bottom: 32px;">
        <h3 style="font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px;">
          Характеристики оружия
        </h3>
        <div class="table-wrapper" style="max-width: 450px;">
          <table class="comparison-table" style="min-width: auto;">
            <thead>
              <tr>
                <th style="width: 50%;">Характеристика</th>
                <th style="width: 50%;">Значение</th>
              </tr>
            </thead>
            <tbody>
              ${rows.join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  const patchTag = latestPatch
    ? `<span class="detail-patch-tag">${latestPatch.patch}</span>
       <span class="dot">·</span>
       <span>Актуально на ${fmtDate(latestPatch.date)}</span>`
    : '';

  document.getElementById('app').innerHTML = `
    <a class="back-btn" href="#weapons">← К списку оружия</a>
    <div class="detail-title-row">
      <span class="detail-title">${currentWeapon.name}</span>
      <span class="tier-badge ${tc(tier)}">${tl(tier)}</span>
      <div class="detail-actions">
        <button id="detail-compare-btn" class="detail-compare-btn ${compareList.includes(family + ':' + variantType) ? 'active' : ''}" data-wkey="${esc(family)}:${variantType}">
          ⚖ ${compareList.includes(family + ':' + variantType) ? 'В сравнении' : 'Сравнить'}
        </button>
        <button id="share-detail-btn" class="share-detail-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          Поделиться
        </button>
      </div>
    </div>
    <div class="detail-meta">
      <span class="variant-tag ${currentWeapon.variantType === 'base' ? 'base' : 'branch'}">${VARIANT_LABELS[currentWeapon.variantType] ?? currentWeapon.variantType}</span>
      <span class="dot">·</span>
      <span>Семейство: <strong>${family}</strong></span>
      <span class="dot">·</span>
      ${renderAmmoTag(currentWeapon.ammo, true)}
      ${patchTag ? `<span class="dot">·</span>${patchTag}` : ''}
    </div>
    <div class="weapon-info-block">
      ${currentWeapon.image ? `
        <div class="weapon-image-container">
          <img src="${currentWeapon.image}" alt="${esc(currentWeapon.name)}" class="weapon-image">
        </div>
      ` : `
        <div class="weapon-image-container placeholder">
          <div class="weapon-image-placeholder-icon">🔫</div>
          <div class="weapon-image-placeholder-text">Изображение отсутствует</div>
        </div>
      `}
      <div class="weapon-description-container">
        <h4 class="info-section-title">Описание оружия</h4>
        <p class="weapon-description-text">
          ${currentWeapon.description ? currentWeapon.description : 'Для этого оружия пока нет подробного описания.'}
        </p>
      </div>
    </div>
    
    ${variants.length > 1 ? `
      <div class="detail-branches-comparison-section" style="margin-top: 32px; margin-bottom: 32px;">
        <h3 style="font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;">
          Сравнение с другими ветками
        </h3>
        <p style="color: var(--text-3); font-size: 12px; margin-bottom: 16px;">
          Ниже приведено сравнение текущего оружия с другими модификациями этого семейства. Текущая ветка подсвечена.
        </p>
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
        ${renderStatsVisualization(variants, 'Визуальное сравнение веток', variantType)}
      </div>
    ` : singleStatsHtml}
    
    <div class="detail-changelog-section" style="margin-top: 40px;">
      <h3 style="font-family: 'Rajdhani', sans-serif; font-size: 18px; font-weight: 700; color: var(--accent); margin-bottom: 16px; text-transform: uppercase; letter-spacing: 1px;">
        История изменений оружия
      </h3>
      ${weaponPatches.length === 0
      ? `<p class="no-changes" style="font-style: italic; color: var(--text-3);">Изменений для этого оружия не зафиксировано.</p>`
      : `<div class="changelog-wrap">${weaponPatches.map(renderPatchCard).join('')}</div>`
    }
    </div>`;
}

// ================================================================
//  STATS PROGRESS BARS VISUALIZATION
// ================================================================
function renderStatsVisualization(variants, title = 'Визуальное сравнение веток', activeVariantType = null) {
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

    const isCurrent = activeVariantType && v.variantType === activeVariantType;

    return `
      <div class="visual-variant-card ${isCurrent ? 'active-card' : ''}">
        <a href="#weapon/${encodeURIComponent(v.family + ':' + v.variantType)}" class="visual-variant-name">${v.name}</a>
        <div class="visual-stats-list">
          <div class="visual-stat-row">
            <div class="visual-label">Урон: <strong>${v.damage ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="--val: ${dmgPct}%; background: var(--accent);"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">DPS: <strong>${v.dps ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="--val: ${dpsPct}%; background: #eab308;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Магазин: <strong>${v.clipSize ?? '—'}</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="--val: ${clipPct}%; background: #3b82f6;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Задержка: <strong>${v.delay ?? '—'}c</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="--val: ${delayPct}%; background: #06b6d4;"></div></div>
          </div>
          <div class="visual-stat-row">
            <div class="visual-label">Перезарядка: <strong>${v.reload ?? '—'}c</strong></div>
            <div class="visual-bar-bg"><div class="visual-bar" style="--val: ${reloadPct}%; background: #10b981;"></div></div>
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
          <a href="#weapon/${encodeURIComponent(w.family + ':' + w.variantType)}" class="compare-weapon-name">${w.name}</a>
          <div style="margin-top: 4px; display: flex; gap: 6px; justify-content: center; align-items: center;">
            <span class="tier-badge ${tc(w.tier)}" style="font-size: 8px; padding: 1px 4px;">${tl(w.tier)}</span>
            ${renderAmmoTag(w.ammo, true)}
          </div>
          <button class="compare-remove-header-btn" data-wkey="${esc(w.family)}:${w.variantType}">Убрать</button>
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
      <div class="detail-actions">
        <button id="clear-compare-btn" class="detail-compare-btn" style="border-color: rgba(239, 68, 68, 0.3); color: #ef4444; background: rgba(239, 68, 68, 0.05);">
          🗑️ Сбросить сравнение
        </button>
        <button id="share-detail-btn" class="share-detail-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          Поделиться
        </button>
      </div>
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
        <div class="patch-head-left">
          <span class="patch-version">${patch.patch}</span>
          <span class="patch-date">${fmtDate(patch.date)}</span>
          ${patch.description ? `<span class="patch-desc">${patch.description}</span>` : ''}
          ${changes.length ? `<span class="patch-change-count">${pluralizeChanges(changes.length)}</span>` : ''}
        </div>
        <button class="share-detail-btn share-patch-btn" data-patch="${patch.patch}" title="Поделиться патчем">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>
          Поделиться
        </button>
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function pluralizeChanges(n) {
  const remainder10 = n % 10;
  const remainder100 = n % 100;
  if (remainder10 === 1 && remainder100 !== 11) {
    return `${n} изменение`;
  }
  if ([2, 3, 4].includes(remainder10) && ![12, 13, 14].includes(remainder100)) {
    return `${n} изменения`;
  }
  return `${n} изменений`;
}


function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '❌';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  // Trigger animation reflow
  toast.offsetHeight;

  setTimeout(() => toast.classList.add('show'), 10);

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Ссылка скопирована в буфер обмена!', 'success');
    if (btn) {
      const originalText = btn.innerHTML;
      btn.innerHTML = '✓ Ссылка скопирована!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.classList.remove('copied');
      }, 2000);
    }
  });
}

// ================================================================
//  START
// ================================================================
init();
