# RMZS Weapon Wiki

База данных оружия для сервера **RMZS — Russian Modified Zombie Survival**.  
Хостится на GitHub Pages. Не требует сервера или сборки.

---

## Структура

```
rmzs-wiki/
├── index.html              ← Главная страница (SPA)
├── css/style.css
├── js/app.js
├── data/
│   ├── weapons.json        ← База оружия (генерируется из CSV)
│   └── changelog.json      ← История патчей (редактируется вручную)
├── generate_data.py        ← Скрипт генерации weapons.json из CSV
└── .nojekyll
```

---

## Локальный просмотр

Нельзя открыть `index.html` напрямую — браузер заблокирует fetch(). Нужен любой локальный сервер:

```bash
# Python
python -m http.server 8080
# затем открыть http://localhost:8080
```

---

## Обновление данных после патча на сервере

### 1. Обновить показатели оружия

Если изменились характеристики — обновить `data/weapons.json` вручную **или** через скрипт:

1. Экспортировать актуальную таблицу из Excel в CSV (формат: разделитель `;`, кодировка **Macintosh**)
2. Заменить файл `Статы ЗС_types_fixed.csv`
3. Запустить: `python generate_data.py`

### 2. Добавить запись в changelog

Открыть `data/changelog.json` и добавить новый патч **в начало** массива:

```json
{
  "patch": "v1.1",
  "date": "2026-07-15",
  "description": "Краткое описание патча",
  "changes": [
    {
      "family": "Toxic",
      "variantType": "base",
      "weaponName": "'Toxic' Chemical pistol",
      "stats": {
        "damage": { "old": 23, "new": 25 },
        "dps":    { "old": 66, "new": 71 }
      },
      "note": "Опциональный комментарий"
    }
  ]
}
```

**Поля `stats`** — только то, что реально изменилось. Остальное не указывать.

**`variantType`**: `"base"`, `"branch_1"`, `"branch_2"`, `"branch_3"`

### 3. Обновить версию кэша в index.html

Чтобы браузеры игроков гарантированно скачали обновлённые файлы — **при каждом деплое** обновляй версию в `index.html`:

```html
<!-- Было -->
<link rel="stylesheet" href="css/style.css?v=1.2">
<script src="js/app.js?v=1.2"></script>

<!-- Стало (следующий патч) -->
<link rel="stylesheet" href="css/style.css?v=1.3">
<script src="js/app.js?v=1.3"></script>
```

> Версия должна совпадать с номером патча (v1.3, v2.0 и т.д.).

### 4. Задеплоить

```bash
git add data/weapons.json data/changelog.json
git commit -m "Patch v1.1"
git push
```

GitHub Pages обновит сайт автоматически через ~1 минуту.

---

## Настройка GitHub Pages

1. Создать репозиторий на GitHub
2. `git push` всех файлов
3. Settings → Pages → Source: **Deploy from branch** → ветка `main`, папка `/ (root)`
4. Сайт будет доступен по адресу `https://<username>.github.io/<repo-name>`

---

## Формат changelog.json — полный пример

```json
[
  {
    "patch": "v1.1",
    "date": "2026-07-15",
    "description": "Ребаланс тира 2",
    "changes": [
      {
        "family": "Ricochete",
        "variantType": "base",
        "weaponName": "'Ricochete' Magnum",
        "stats": {
          "damage": { "old": 46, "new": 50 },
          "delay":  { "old": 0.7, "new": 0.8 }
        }
      },
      {
        "family": "Eraser",
        "variantType": "branch_2",
        "weaponName": "'Waraxe' Gauss Pistol",
        "stats": {
          "clipSize": { "old": 30, "new": 25 }
        },
        "note": "Уменьшен магазин из-за слишком высокого DPS"
      }
    ]
  },
  {
    "patch": "v1.0",
    "date": "2026-07-01",
    "description": "Первоначальная публикация базы данных.",
    "changes": []
  }
]
```
