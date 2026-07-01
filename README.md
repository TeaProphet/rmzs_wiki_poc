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

### 1. Обновить показатели оружия (База)

Характеристики в файле `data/weapons.json` отражают **исходное (базовое)** состояние оружия. Если вышли балансные правки:

1. Экспортируйте актуальную (или базовую, если вы ведете историю с нуля) таблицу из Excel в CSV (формат: разделитель `;`, кодировка **Macintosh**)
2. Замените файл `Статы ЗС_types_fixed.csv`
3. Запустите скрипт сборки базы данных: `python generate_data.py`

### 2. Добавить запись в changelog

Откройте `data/changelog.json` и добавьте новый патч **в начало** общего массива.

В новом формате вам больше **не нужно** писать `"old"` и `"new"` для каждой характеристики, а также прописывать полные названия оружия. Достаточно указать имя файла скрипта и новые значения:

```json
{
  "patch": "v1.2",
  "date": "2026-07-20",
  "description": "Краткое описание патча",
  "changes": [
    {
      "file": "weapon_zs_chempistol",
      "stats": {
        "damage": 25,
        "clipSize": 18
      },
      "note": "Усиление химического пистолета для более поздних стадий игры"
    }
  ]
}
```

#### Правила заполнения:
- **`file`**: имя файла скрипта оружия (например, `weapon_zs_chempistol` или `weapon_zs_mr96`).
- **`stats`**: перечисляются только те характеристики, которые изменились, в формате `"название_стата": новое_значение`.
  *Доступные характеристики: `damage` (урон), `clipSize` (магазин), `delay` (задержка), `reload` (перезаряд), `dps` (DPS).*
- **`variantType` (необязательно)**: требуется указывать **только** для тех скриптов, которые делятся между несколькими ветками оружия. Укажите ветку, чтобы избежать неоднозначности:
  - `"base"` — базовое оружие
  - `"branch_1"` — Ветка 1
  - `"branch_2"` — Ветка 2
  - `"branch_3"` — Ветка 3

  **Список файлов-исключений, для которых обязательно указывать `variantType`:**
  - `weapon_zs_crackler` (Crackler Assault Rifle)
  - `weapon_zs_stabber` (Bayonet M1 Garand, Stabber M1 Garand)
  - `weapon_zs_amigo` (Amigo Assault Rifle, Comrade Assault Rifle, Horizon Assault Rifle)
  - `weapon_zs_magnum` (Ricochete Magnum, Backlash Magnum)
  - `weapon_zs_glock3` (Crossfire Glock 3, Collider Glock 3)
  - `weapon_zs_inquisitor` (Inquisitor Crossbow, Absolver Crossbow)
  - `weapon_zs_novablaster` (Nova Blaster Pulse Revolver, Nova Helix Pulse Revolver)
  - `weapon_zs_uzi` (Sprayer Uzi 9mm, Disperser Uzi 9mm)
  - `weapon_zs_oberon` (Oberon Pulse Shotgun)
  - `weapon_zs_rebel` (Rebel Shotgun)
  - `weapon_zs_tempest` (Tempest Burst Pistol, Cosmos Burst Pistol)
  - `weapon_zs_tosser` (Tosser SMG, Thrower SMG)
  - `weapon_zs_deagle` (Zombie Drill Desert Eagle, Faraday Desert Eagle, Seditionist Desert Eagle)
  - `weapon_zs_quasar` (Quasar Pulse Rifle, Blazar Pulse Rifle)
  - `weapon_ze_sweepershotgun` (Sweeper Shotgun, Boomer Shotgun)
  - `weapon_ze_headhunter` (Headhunter Pistol, Speedy Pistol, Russell Pistol)
  - `weapon_zs_quicksilver` (Quicksilver Semi-Auto Rifle, Mercurial Semi-Auto Rifle)
  - `weapon_zs_artemis` (Artemis Dual Crossbows, Actaeon Dual Crossbows)
  - `weapon_zs_slugrifle` (Tiny Slug Rifle)
  - `weapon_zs_plasmarifle` (IMk Plasma Projector, IIMk Plasma Projector, VMk Plasma Projector)
  - `weapon_zs_spas12` (Scattershot Shotgun, Eradicator Shotgun)
  - `weapon_zs_servitor` (Servitor Pulse Rifle)
  - `weapon_zs_minigun` (Bulwark Minigun, Fury Minigun)
  - `weapon_zs_interceptor` (Interceptor Plasma Rifle, Amber Plasma Rifle, Permafrost Plasma Rifle)
  - `weapon_zs_taucannon` (XVL1456 Tau Cannon, Vanquisher Tau Cannon)
  - `weapon_ze_gluon2` (Helios Gluon Gun, Hades Gluon Gun, Tartarus Gluon Gun)

- **`note` (необязательно)**: ваш комментарий/пояснение к изменению.

> **Как рассчитывается разница (Дельта)?**  
> Сайт работает по хронологическому принципу прямого наложения изменений. Он автоматически берет исходные данные из `weapons.json` и применяет патчи по очереди. Старые значения (`old`) вычисляются автоматически из предыдущего патча в истории (или из `weapons.json`, если это первое изменение характеристики).

### 3. Задеплоить

```bash
git add data/changelog.json
# (Добавляйте data/weapons.json только если вы обновляли исходную базу данных оружия в п.1!)
# git add data/weapons.json 

git commit -m "Patch vN"
git push
```

GitHub Pages обновит сайт автоматически через ~1 минуту.

---

## Настройка GitHub Pages (Пошагово для новичков)

Если вы никогда ранее не пользовались GitHub, следуйте этой инструкции, чтобы опубликовать ваш сайт в сети:

### Шаг 1. Подготовка аккаунта и Git
1. Зарегистрируйтесь на сайте [github.com](https://github.com/) (если у вас еще нет аккаунта).
2. Установите [Git для Windows](https://git-scm.com/download/win), если он еще не установлен.
3. Откройте терминал (PowerShell или Git Bash) в папке проекта на вашем компьютере и настройте ваше имя и почту (они нужны для подписи коммитов):
   ```bash
   git config --global user.name "Ваше Имя"
   git config --global user.email "your-email@example.com"
   ```

### Шаг 2. Создание репозитория на GitHub
1. Перейдите на главную страницу GitHub и нажмите зеленую кнопку **New** (или `+` в правом верхнем углу -> **New repository**).
2. В поле **Repository name** введите название проекта (например, `rmzs-wiki`).
3. Убедитесь, что выбран тип **Public** (публичный). Это обязательно, так как на бесплатном тарифе GitHub Pages работает только для публичных репозиториев.
4. **ВАЖНО**: Не ставьте галочки под пунктами *Add a README file*, *Add .gitignore* или *Choose a license*. Репозиторий должен остаться абсолютно пустым.
5. Нажмите кнопку **Create repository** (Создать репозиторий).

### Шаг 3. Загрузка файлов проекта на GitHub
1. После создания репозитория перед вами откроется страница с быстрыми настройками. Найдите блок команд под заголовком `...or push an existing repository from the command line` (или скопируйте команды ниже):
   ```bash
   # Привязать локальную папку к созданному репозиторию на GitHub
   git remote add origin https://github.com/ВАШ_НИКНЕЙМ/rmzs-wiki.git
   
   # Переименовать основную ветку в main
   git branch -M main
   
   # Залить все файлы на сервер (у вас может потребоваться авторизоваться в GitHub в окне браузера)
   git push -u origin main
   ```
2. Откройте консоль в папке с вашим проектом на компьютере, вставьте эти команды по очереди и нажмите Enter.

### Шаг 4. Включение GitHub Pages
1. В вашем репозитории на GitHub перейдите во вкладку **Settings** (Настройки) на верхней горизонтальной панели.
2. В меню слева найдите и выберите пункт **Pages** (Страницы).
3. В разделе **Build and deployment**:
   - В выпадающем списке **Source** выберите вариант `Deploy from a branch` (он выбран по умолчанию).
   - В выпадающем списке **Branch** выберите ветку `main` вместо `None`.
   - В соседнем выпадающем списке папок оставьте `/ (root)`.
4. Нажмите кнопку **Save** (Сохранить).

### Шаг 5. Проверка сайта
1. Подождите около 1–2 минут, пока GitHub соберет и опубликует ваш сайт.
2. Обновите вкладку **Settings -> Pages** в браузере (F5).
3. Наверху страницы появится зеленая плашка с текстом: **"Your site is live at [ссылка]"**.
4. Кликните по ссылке — ваш сайт запущен и готов к работе! При каждом последующем `git push` изменения автоматически появятся по этой ссылке.

---

## Формат changelog.json — полный пример

```json
[
  {
    "patch": "v1.2",
    "date": "2026-07-20",
    "description": "Тестовое обновление v1.2. Вторая волна ребаланса оружия.",
    "changes": [
      {
        "file": "weapon_zs_chempistol",
        "stats": {
          "damage": 28
        },
        "note": "Усиление химического пистолета для более поздних стадий игры"
      },
      {
        "file": "weapon_zs_owens",
        "stats": {
          "damage": 15,
          "reload": 2.2
        },
        "note": "Повышение эффективности пистолета Owens"
      }
    ]
  },
  {
    "patch": "v1.1",
    "date": "2026-07-08",
    "description": "Тестовое обновление v1.1. Базовые корректировки баланса.",
    "changes": [
      {
        "file": "weapon_zs_chempistol",
        "stats": {
          "damage": 25,
          "clipSize": 18
        },
        "note": "Небольшой апгрейд урона и магазина"
      },
      {
        "file": "weapon_zs_blaster",
        "stats": {
          "damage": 7.5
        },
        "note": "Округление урона дробовика Blaster в большую сторону"
      }
    ]
  },
  {
    "patch": "v1.0",
    "date": "2026-07-01",
    "description": "Первоначальная публикация базы данных. Все показатели актуальны на дату выпуска.",
    "changes": []
  }
]
```
