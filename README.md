# GEMS Stakeholder Atlas · GEMS 利害關係人地圖集

**Live site:** https://timmy97-tw.github.io/GEMS_Stakeholder/

Every expert, lab, government agency, company, school, farmer and iGEM team that
GEMS Taiwan has met, consulted or built with through iGEM, from 2022 to today.
Each record says what happened, what changed in the project because of it, and
links back to the wiki page it came from.

2022 年至今，GEMS Taiwan 在 iGEM 中拜訪、請益與合作過的所有專家、實驗室、公部門、
企業、學校、農友與 iGEM 隊伍。每一筆都記錄交流內容、專案因此做了哪些改變，並連回原始 Wiki 頁面。

| Season | Project | Wiki |
|---|---|---|
| 2022 | Fusarium Won't | https://2022.igem.wiki/gems-taiwan/human-practices |
| 2023 | Cure-All Reef | https://2023.igem.wiki/gems-taiwan/human-practices |
| 2024 | Dengue Beeters | https://2024.igem.wiki/gems-taiwan/human-practices |
| 2025 | Textile Fighters | https://2025.igem.wiki/gems-taiwan/human-practices |
| 2026 | ReLeaf | https://timmy97-tw.github.io/releaf-wiki/human-practices/ |

## What the site does

- **Overview / 總覽**: totals, engagements per year by category, where stakeholders are, and a wall of organisation logos.
- **Map / 地圖**: an interactive map that opens on Taiwan (switch to World), with logo pins, clusters, and a list of whoever is in view.
- **Directory / 名錄**: photo cards for every stakeholder, with search and year and category filters.
- **Table / 列表**: a sortable list. Tick two to four rows to compare them side by side. **Export view** downloads the filtered rows as CSV, and **Export all** downloads everything. The CSV is UTF-8 with a BOM, so Excel shows the Chinese correctly.
- **Timeline / 年表**: one chapter per iGEM season.
- **中 / EN** switch in the top right. The site remembers the choice; you can also link with `?lang=en` or `?lang=zh`.
- Every stakeholder has its own link: `#/s/<id>`, e.g. `#/s/tzu-hsien-wu`.

The GEMS Academy logo is in `assets/img/gems-academy.svg` (full lockup) and `assets/img/gems-mark.svg` (the gem-and-heart mark). The lettering is outlined, so both files work anywhere without fonts.

The site is plain HTML, CSS and JavaScript. There is no build step for viewing: open `index.html`, or serve the folder with `python3 -m http.server`.

## Adding next year's stakeholders / 每年新增利害關係人

1. Open `data/years/<year>.json` (create it for a new season) and add one record per stakeholder.
   Copy `data/TEMPLATE.json` as a starting point. If the same person or organisation already exists from an earlier year, **reuse their `id`**. Their new year is then added to the same card.
2. Photos: paste the `https://static.igem.wiki/...` URL, or put the file in `assets/photos/<year>/` and use that path.
3. Logo: save it as `assets/logos/<org_id>.png` (or `.svg`), then add `"<org_id>": {"logo": "assets/logos/<org_id>.png"}` to `data/orgs.json`.
4. Run the build. It merges all years, downloads and compresses any new remote photos, and writes `data/stakeholders.js`, `.json` and `.csv`:

   ```bash
   python3 tools/build.py
   ```

5. Commit and push. GitHub Pages updates within a minute.

The build needs Python 3 and ImageMagick (`brew install imagemagick`) for photos.

### Record fields

| Field | Meaning |
|---|---|
| `id` | stable key for the stakeholder, reused across years (e.g. `mei-chun-cheng`) |
| `org_id` | key for the organisation, shared by everyone there (logos and map pins group on it) |
| `year`, `project` | iGEM season and project name |
| `person_en` / `person_zh` | the person; leave `null` if the stakeholder is an organisation |
| `title_*`, `org_*`, `unit_*` | position, organisation, department or lab |
| `category` | `academia` · `research` · `government` · `industry` · `ngo` · `education` · `community` · `medical` · `igem` · `media` |
| `expertise_*` | a short description of their expertise |
| `interaction` | any of `interview`, `consultation`, `lab-visit`, `site-visit`, `collaboration`, `partnership`, `sponsorship`, `education`, `workshop`, `survey`, `conference`, `meetup`, `feedback`, `mentorship` |
| `dates` | ISO dates, e.g. `["2026-09-30"]` |
| `summary_*` | what happened |
| `impact_*` | what changed in the project because of it |
| `quote_*` | a short quote, if the wiki has one |
| `photos` | `[{src, caption_en, caption_zh}]` |
| `portrait` | headshot, if there is one |
| `website`, `city_*`, `country`, `lat`, `lng` | for the map and the table |
| `source_url` | the wiki page it came from |
| `confidence` | `high` / `medium` / `low`: how sure we are of the details |

## Where the data came from

The 2022 to 2025 records were extracted from each year's wiki source code and from the iGEM
Attributions forms. The 2026 records come from the ReLeaf wiki (`Timmy97-TW/releaf-wiki`)
and the one-page summary for Director Wu (`Timmy97-TW/Releaf_Wu`). Chinese names of people are included only where the wiki gives them or an
official page confirms them. Records marked `"confidence": "low"` are worth checking against
the team's own notes.

Photos belong to GEMS Taiwan and the iGEM wikis. Logos belong to their organisations and are
shown only to identify them. Map tiles © Esri, © OpenStreetMap contributors.
