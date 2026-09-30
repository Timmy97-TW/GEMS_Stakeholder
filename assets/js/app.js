/* GEMS Stakeholder Atlas
   Reads window.GEMS_DATA (data/stakeholders.js) and renders five views:
   overview, map, directory, table, timeline. Hash routes: #/<view>, #/s/<id>. */
(() => {
  "use strict";

  const DATA = window.GEMS_DATA || { stakeholders: [], years: [] };
  const S = DATA.stakeholders;
  const BY_ID = new Map(S.map(s => [s.id, s]));
  const CATS = ["academia", "research", "government", "industry", "ngo", "education", "community", "medical", "igem", "media"];
  const YEARS = [...new Set(S.flatMap(s => s.years))].sort();
  const YEAR_INFO = new Map((DATA.years || []).map(y => [y.year, y]));
  const TW_BOUNDS = [[21.85, 119.9], [25.35, 122.05]];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------------- state ---------------- */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };
  const qsLang = new URLSearchParams(location.search).get("lang");
  const state = {
    lang: qsLang === "en" || qsLang === "zh" ? qsLang
      : store.get("gems.lang") || ((navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en"),
    view: "overview",
    q: "",
    years: new Set(),
    cats: new Set(),
    dirSort: "recent",
    tblSort: { key: "last", dir: -1 },
    selected: new Set(),
    mapScope: "tw"
  };

  /* ---------------- i18n helpers ---------------- */
  const t = (key, vars) => {
    let s = (I18N[state.lang] && I18N[state.lang][key]) ?? I18N.en[key] ?? key;
    if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
    return s;
  };
  const other = () => (state.lang === "zh" ? "en" : "zh");
  const loc = (o, f) => (o && (o[`${f}_${state.lang}`] || o[`${f}_${other()}`])) || "";
  const catLabel = c => t(`cat.${c}`);
  const intLabel = i => t(`int.${i}`);
  const catVar = c => `--cat:var(--c-${CATS.includes(c) ? c : "media"})`;

  const nameOf = s => loc(s, "person") || loc(s, "org");
  const altNameOf = s => {
    const main = nameOf(s);
    const alt = s.person_en || s.person_zh ? (s[`person_${other()}`] || "") : (s[`org_${other()}`] || "");
    return alt && alt !== main ? alt : "";
  };
  const orgLineOf = s => {
    const person = loc(s, "person");
    const parts = person ? [loc(s, "title"), loc(s, "unit"), loc(s, "org")] : [loc(s, "unit")];
    return parts.filter(Boolean).join(" · ");
  };
  const cityOf = s => [loc(s, "city"), s.country && s.country !== "TW" ? countryName(s.country) : ""].filter(Boolean).join(", ");
  const countryName = cc => {
    try { return new Intl.DisplayNames([state.lang === "zh" ? "zh-Hant" : "en"], { type: "region" }).of(cc); }
    catch (e) { return cc; }
  };

  const lastDate = s => {
    const ds = s.engagements.flatMap(e => e.dates && e.dates.length ? e.dates : [`${e.year}`]);
    return ds.sort().at(-1) || "";
  };
  const fmtDate = d => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    if (!m) return y;
    if (state.lang === "zh") return day ? `${y}/${+m}/${+day}` : `${y}/${+m}`;
    const mon = new Date(2000, +m - 1, 1).toLocaleString("en", { month: "short" });
    return day ? `${+day} ${mon} ${y}` : `${mon} ${y}`;
  };
  const allPhotos = s => s.engagements.slice().sort((a, b) => b.year - a.year).flatMap(e => e.photos || []);
  const coverOf = s => { const p = allPhotos(s)[0]; return p ? p.src : ""; };

  function monogram(s) {
    if (state.lang === "zh" && s.org_zh) {
      const clean = s.org_zh.replace(/^[\d\s年第屆]+/, "").replace(/^(國立|私立|財團法人|社團法人|臺灣|台灣|臺北市立|新北市立|臺北市|新北市)/, "");
      return clean.slice(0, 2) || s.org_zh.slice(0, 1);
    }
    const src = (s.abbr || s.org_en || s.person_en || "?").replace(/^\d+(st|nd|rd|th)?\s+/, "");
    const paren = src.match(/\(([A-Z][A-Za-z0-9&-]{1,6})\)/);
    if (paren) return paren[1].slice(0, 4);
    if (/^[A-Z0-9&-]{2,6}$/.test(src)) return src;
    const words = src.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(w => w && !/^(of|and|the|for|in|at|de)$/i.test(w));
    return words.slice(0, 3).map(w => w[0].toUpperCase()).join("") || "?";
  }
  function logoHTML(s, cls = "") {
    if (s.logo) return `<span class="logo ${cls}"><img src="${esc(s.logo)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('mono');this.parentNode.style.background='var(--cat)';this.replaceWith(document.createTextNode('${esc(monogram(s)).replace(/'/g, "")}'))"></span>`;
    const m = monogram(s);
    const fs = m.length > 2 ? ' style="font-size:.78em"' : "";
    return `<span class="logo mono ${cls}" style="${catVar(s.category)};background:var(--cat)"><span${fs}>${esc(m)}</span></span>`;
  }
  const pillHTML = c => `<span class="pill" style="${catVar(c)}">${esc(catLabel(c))}</span>`;
  const yearsHTML = s => s.years.map(y => `<span class="yr">${y}</span>`).join("");

  /* ---------------- filtering ---------------- */
  const hay = new Map(S.map(s => [s.id, [
    s.person_en, s.person_zh, s.org_en, s.org_zh, s.unit_en, s.unit_zh, s.title_en, s.title_zh,
    s.expertise_en, s.expertise_zh, s.city_en, s.city_zh,
    ...s.engagements.flatMap(e => [e.summary_en, e.summary_zh, e.project])
  ].filter(Boolean).join(" ").toLowerCase()]));

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    return S.filter(s =>
      (!state.years.size || s.years.some(y => state.years.has(y))) &&
      (!state.cats.size || state.cats.has(s.category)) &&
      (!terms.length || terms.every(term => hay.get(s.id).includes(term)))
    );
  }
  const hasFilters = () => state.q || state.years.size || state.cats.size;

  function renderFilterbars() {
    const presentCats = CATS.filter(c => S.some(s => s.category === c));
    const html = `
      <label class="search">
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" fill="none"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span class="sr-only">${esc(t("f.search"))}</span>
        <input type="search" data-f="q" placeholder="${esc(t("f.search"))}" value="${esc(state.q)}" autocomplete="off">
      </label>
      <div class="filter-group chips" role="group" aria-label="Year">
        ${YEARS.map(y => `<button type="button" class="chip" data-f="year" data-v="${y}" aria-pressed="${state.years.has(y)}">${y}</button>`).join("")}
      </div>
      <div class="filter-group chips" role="group" aria-label="${esc(t("f.category"))}">
        ${presentCats.map(c => `<button type="button" class="chip cat" style="${catVar(c)}" data-f="cat" data-v="${c}" aria-pressed="${state.cats.has(c)}"><span class="dot"></span>${esc(catLabel(c))}</button>`).join("")}
      </div>
      ${hasFilters() ? `<button type="button" class="chip chip-clear" data-f="clear">${esc(t("f.clear"))}</button>` : ""}`;
    $$("[data-filterbar]").forEach(el => {
      const focused = document.activeElement && el.contains(document.activeElement) && document.activeElement.dataset.f === "q";
      const caret = focused ? document.activeElement.selectionStart : null;
      el.innerHTML = html;
      if (focused) { const i = $("input", el); i.focus(); i.setSelectionRange(caret, caret); }
    });
  }

  document.addEventListener("input", e => {
    if (e.target.dataset && e.target.dataset.f === "q") {
      state.q = e.target.value;
      $$('[data-filterbar] input[data-f="q"]').forEach(i => { if (i !== e.target) i.value = state.q; });
      refreshData({ keepFilterbar: true });
    }
  });
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-f]");
    if (!b || b.tagName === "INPUT") return;
    const f = b.dataset.f;
    if (f === "year") toggle(state.years, +b.dataset.v);
    else if (f === "cat") toggle(state.cats, b.dataset.v);
    else if (f === "clear") { state.q = ""; state.years.clear(); state.cats.clear(); }
    refreshData();
  });
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

  function refreshData(opts = {}) {
    if (!opts.keepFilterbar) renderFilterbars();
    else {
      // keep the input (and the caret) but refresh chip states and the clear button
      const clearNeeded = hasFilters();
      $$("[data-filterbar]").forEach(el => {
        const c = $(".chip-clear", el);
        if (clearNeeded && !c) el.insertAdjacentHTML("beforeend", `<button type="button" class="chip chip-clear" data-f="clear">${esc(t("f.clear"))}</button>`);
        if (!clearNeeded && c) c.remove();
      });
    }
    renderDirectory();
    renderTable();
    if (map) renderMapMarkers();
  }

  /* ---------------- overview ---------------- */
  function renderOverview() {
    const orgs = orgGroups();
    const places = new Set(S.filter(s => s.city_en).map(s => `${s.city_en}|${s.country}`));
    const nEng = S.reduce((n, s) => n + s.engagements.length, 0);
    const stats = [
      [S.length, "stat.stakeholders"], [orgs.length, "stat.orgs"], [nEng, "stat.engagements"],
      [YEARS.length, "stat.years"], [places.size, "stat.cities"]
    ];
    $("#stats").innerHTML = stats.map(([n, k]) => `<div class="stat"><div class="stat-n" data-count="${n}">${n}</div><div class="stat-l">${esc(t(k))}</div></div>`).join("");
    countUp();

    // latest engagement
    const latest = S.slice().sort((a, b) => lastDate(b).localeCompare(lastDate(a)))[0];
    if (latest) {
      const eng = latest.engagements.slice().sort((a, b) => b.year - a.year)[0];
      const cover = coverOf(latest);
      $("#feature-wrap").innerHTML = `
        <article class="feature" data-open="${esc(latest.id)}" tabindex="0" style="${catVar(latest.category)}">
          <div class="feature-media">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy">` : ""}</div>
          <div class="feature-body">
            <span class="feature-kicker">${esc(t("feature.latest"))} · ${esc(fmtDate(lastDate(latest)))}</span>
            <h2 class="feature-title">${esc(nameOf(latest))}</h2>
            <p class="feature-org">${esc([loc(latest, "title"), loc(latest, "unit"), loc(latest, "org")].filter(Boolean).join(" · "))}</p>
            <p class="feature-sum">${esc(loc(eng, "summary"))}</p>
            <div>${pillHTML(latest.category)}</div>
          </div>
        </article>`;
    }

    // year x category stacked bars (engagement count)
    const counts = YEARS.map(y => {
      const row = { y, total: 0 };
      CATS.forEach(c => (row[c] = 0));
      S.forEach(s => s.engagements.forEach(e => { if (e.year === y) { row[s.category]++; row.total++; } }));
      return row;
    });
    const max = Math.max(1, ...counts.map(r => r.total));
    $("#chart-years").innerHTML = counts.map(r => `
      <div class="cy-col">
        <span class="cy-n">${r.total}</span>
        <div class="cy-bar" data-year="${r.y}" title="${r.y}" style="height:${(r.total / max) * 100}%">
          ${CATS.filter(c => r[c]).map(c => `<div class="cy-seg" style="${catVar(c)};background:var(--cat);height:${(r[c] / r.total) * 100}%" title="${esc(catLabel(c))}: ${r[c]}"></div>`).join("")}
        </div>
        <span class="cy-y">${r.y}</span>
      </div>`).join("");
    const presentCats = CATS.filter(c => S.some(s => s.category === c));
    $("#chart-legend").innerHTML = presentCats.map(c => `<span><i style="${catVar(c)};background:var(--cat)"></i>${esc(catLabel(c))}</span>`).join("");

    const catCounts = presentCats.map(c => [c, S.filter(s => s.category === c).length]).sort((a, b) => b[1] - a[1]);
    const cmax = Math.max(1, ...catCounts.map(x => x[1]));
    $("#chart-cats").innerHTML = catCounts.map(([c, n]) => `
      <div class="cc-row" data-cat="${c}" role="button" tabindex="0">
        <span>${esc(catLabel(c))}</span>
        <span class="cc-track"><span class="cc-fill" style="${catVar(c)};background:var(--cat)" data-w="${(n / cmax) * 100}"></span></span>
        <span class="cc-n">${n}</span>
      </div>`).join("");
    requestAnimationFrame(() => requestAnimationFrame(() => $$(".cc-fill").forEach(el => (el.style.width = el.dataset.w + "%"))));

    // cities
    const cityMap = new Map();
    S.forEach(s => {
      if (!s.city_en) return;
      const k = `${s.city_en}|${s.country}`;
      if (!cityMap.has(k)) cityMap.set(k, { s, n: 0 });
      cityMap.get(k).n++;
    });
    const cities = [...cityMap.values()].sort((a, b) => b.n - a.n).slice(0, 18);
    $("#chart-cities").innerHTML = cities.map(({ s, n }) =>
      `<button type="button" class="city-chip" data-city="${esc(loc(s, "city"))}">${esc(cityOf(s))} <b>${n}</b></button>`).join("");

    // logo wall
    $("#logo-wall").innerHTML = orgs.map(o => `
      <button type="button" class="lw-item" data-org="${esc(o.key)}" style="${catVar(o.rep.category)}">
        ${logoHTML(o.rep)}
        <span class="lw-name">${esc(loc(o.rep, "org"))}</span>
        <span class="lw-n">${o.members.length > 1 ? o.members.length + (state.lang === "zh" ? " 位" : " people") : o.rep.years.join(", ")}</span>
      </button>`).join("");
  }

  function orgGroups() {
    const m = new Map();
    S.filter(s => s.category !== "community" && !(s.org_id || "").startsWith("p-")).forEach(s => {
      const key = s.org_id || s.org_en || s.id;
      if (!m.has(key)) m.set(key, { key, members: [] });
      m.get(key).members.push(s);
    });
    return [...m.values()].map(o => {
      o.rep = o.members.find(x => x.logo) || o.members[0];
      o.latest = o.members.map(lastDate).sort().at(-1);
      return o;
    }).sort((a, b) => b.members.length - a.members.length || (b.rep.logo ? 1 : 0) - (a.rep.logo ? 1 : 0) || b.latest.localeCompare(a.latest));
  }

  function countUp() {
    $$("[data-count]").forEach(el => {
      const end = +el.dataset.count;
      if (matchMedia("(prefers-reduced-motion: reduce)").matches || end < 2) return;
      const t0 = performance.now(), dur = 900;
      const step = now => {
        const p = Math.min(1, (now - t0) / dur);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  document.addEventListener("click", e => {
    const bar = e.target.closest(".cy-bar");
    if (bar) { state.years = new Set([+bar.dataset.year]); state.cats.clear(); state.q = ""; go("directory"); refreshData(); return; }
    const row = e.target.closest(".cc-row");
    if (row) { state.cats = new Set([row.dataset.cat]); state.years.clear(); state.q = ""; go("directory"); refreshData(); return; }
    const city = e.target.closest(".city-chip");
    if (city) { state.q = city.dataset.city; state.years.clear(); state.cats.clear(); go("directory"); refreshData(); return; }
    const org = e.target.closest(".lw-item");
    if (org) {
      const o = orgGroups().find(x => x.key === org.dataset.org);
      if (o && o.members.length === 1) openDetail(o.members[0].id);
      else if (o) { state.q = loc(o.rep, "org"); state.years.clear(); state.cats.clear(); go("directory"); refreshData(); }
      return;
    }
    const opener = e.target.closest("[data-open]");
    if (opener && !e.target.closest("input")) { openDetail(opener.dataset.open); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("[data-open], .cc-row")) e.target.click();
  });

  /* ---------------- directory ---------------- */
  function sortList(list, mode) {
    const by = {
      recent: (a, b) => lastDate(b).localeCompare(lastDate(a)) || nameOf(a).localeCompare(nameOf(b)),
      name: (a, b) => nameOf(a).localeCompare(nameOf(b), state.lang === "zh" ? "zh-Hant" : "en"),
      org: (a, b) => loc(a, "org").localeCompare(loc(b, "org"), state.lang === "zh" ? "zh-Hant" : "en") || nameOf(a).localeCompare(nameOf(b)),
      count: (a, b) => b.engagements.length - a.engagements.length || lastDate(b).localeCompare(lastDate(a))
    };
    return list.slice().sort(by[mode] || by.recent);
  }

  function cardHTML(s, eng) {
    const photos = eng ? (eng.photos || []) : allPhotos(s);
    const cover = photos[0] && photos[0].src;
    const summary = eng ? loc(eng, "summary") : loc(s.engagements.slice().sort((a, b) => b.year - a.year)[0], "summary");
    return `
      <button type="button" class="card" data-open="${esc(s.id)}" style="${catVar(s.category)}">
        <div class="card-media ${cover ? "" : "empty"}">
          ${cover ? `<img class="ph" src="${esc(cover)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('empty');this.remove()">` : logoHTML(s)}
          ${photos.length > 1 ? `<span class="nphotos">${esc(t("photos", { n: photos.length }))}</span>` : ""}
        </div>
        <div class="card-body">
          ${cover ? `<div class="card-top">${logoHTML(s)}</div>` : ""}
          <div>
            <div class="card-name">${esc(nameOf(s))}</div>
            <div class="card-org">${esc(orgLineOf(s) || loc(s, "org"))}${loc(s, "person") && !orgLineOf(s).includes(loc(s, "org")) ? " · " + esc(loc(s, "org")) : ""}</div>
          </div>
          ${summary ? `<p class="card-sum">${esc(summary)}</p>` : ""}
          <div class="card-foot">${pillHTML(s.category)}<span class="card-years">${eng ? `<span class="yr">${eng.year}</span>` : yearsHTML(s)}</span></div>
        </div>
      </button>`;
  }

  function renderDirectory() {
    const list = sortList(filtered(), state.dirSort);
    $("#dir-count").textContent = t("dir.count", { n: list.length, t: S.length });
    $("#cards").innerHTML = list.length ? list.map(s => cardHTML(s)).join("") : `<p class="empty-state">${esc(t("empty"))}</p>`;
  }
  $("#dir-sort").addEventListener("change", e => { state.dirSort = e.target.value; renderDirectory(); });

  /* ---------------- table ---------------- */
  const COLS = [
    { key: "check", cls: "c-check" },
    { key: "name", label: "col.name", cls: "c-name", val: s => nameOf(s) },
    { key: "org", label: "col.org", val: s => loc(s, "org") },
    { key: "cat", label: "col.cat", val: s => catLabel(s.category) },
    { key: "years", label: "col.years", val: s => s.years.join(",") },
    { key: "int", label: "col.int", val: s => s.interactions.map(intLabel).join(", ") },
    { key: "city", label: "col.city", val: s => cityOf(s) },
    { key: "n", label: "col.n", cls: "num", val: s => s.engagements.length },
    { key: "last", label: "col.last", val: s => lastDate(s) }
  ];

  function renderTable() {
    const { key, dir } = state.tblSort;
    const col = COLS.find(c => c.key === key) || COLS[8];
    const list = filtered().sort((a, b) => {
      const va = col.val(a), vb = col.val(b);
      const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), state.lang === "zh" ? "zh-Hant" : "en");
      return r * dir || nameOf(a).localeCompare(nameOf(b));
    });
    $("#tbl-head").innerHTML = COLS.map(c => {
      if (c.key === "check") return `<th class="c-check"></th>`;
      const sorted = c.key === key;
      return `<th class="sortable ${c.cls || ""}" data-sort="${c.key}" ${sorted ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${esc(t(c.label))}<span class="arr">${sorted ? (dir > 0 ? "↑" : "↓") : "↓"}</span></th>`;
    }).join("");
    $("#tbl-body").innerHTML = list.map(s => `
      <tr data-open="${esc(s.id)}" class="${state.selected.has(s.id) ? "sel" : ""}" style="${catVar(s.category)}">
        <td class="c-check"><input type="checkbox" class="check" data-sel="${esc(s.id)}" ${state.selected.has(s.id) ? "checked" : ""} aria-label="Select"></td>
        <td class="c-name"><div class="who">${logoHTML(s)}<div><b>${esc(nameOf(s))}</b>${altNameOf(s) ? `<small>${esc(altNameOf(s))}</small>` : ""}${loc(s, "person") && loc(s, "title") ? `<small>${esc(loc(s, "title"))}</small>` : ""}</div></div></td>
        <td class="org">${esc(loc(s, "org"))}${loc(s, "unit") ? `<small>${esc(loc(s, "unit"))}</small>` : ""}</td>
        <td>${pillHTML(s.category)}</td>
        <td><div class="years">${yearsHTML(s)}</div></td>
        <td class="ints">${esc(s.interactions.map(intLabel).join(", "))}</td>
        <td>${esc(cityOf(s))}</td>
        <td class="num">${s.engagements.length}</td>
        <td class="muted" style="white-space:nowrap">${esc(fmtDate(lastDate(s)))}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="empty-state">${esc(t("empty"))}</td></tr>`;
    $("#tbl-count").textContent = t("tbl.count", { n: list.length });
    $("#compare-n").textContent = state.selected.size;
    $("#btn-compare").disabled = state.selected.size < 2;
    renderTable.last = list;
  }

  $("#tbl-head").addEventListener("click", e => {
    const th = e.target.closest("[data-sort]");
    if (!th) return;
    const k = th.dataset.sort;
    state.tblSort = state.tblSort.key === k ? { key: k, dir: -state.tblSort.dir } : { key: k, dir: k === "last" || k === "n" ? -1 : 1 };
    renderTable();
  });
  $("#tbl-body").addEventListener("click", e => {
    const cb = e.target.closest("[data-sel]");
    if (cb) {
      e.stopPropagation();
      const id = cb.dataset.sel;
      if (cb.checked) {
        if (state.selected.size >= 4) { cb.checked = false; toast(t("tbl.max4")); return; }
        state.selected.add(id);
      } else state.selected.delete(id);
      cb.closest("tr").classList.toggle("sel", cb.checked);
      $("#compare-n").textContent = state.selected.size;
      $("#btn-compare").disabled = state.selected.size < 2;
    }
  }, true);
  $("#btn-compare").addEventListener("click", openCompare);
  $("#btn-csv-view").addEventListener("click", () => downloadCSV(renderTable.last || filtered(), "view"));
  $("#btn-csv-all").addEventListener("click", () => downloadCSV(sortList(S, "recent"), "all"));

  /* ---------------- CSV ---------------- */
  function downloadCSV(list, tag) {
    const head = ["id", "name_en", "name_zh", "title_en", "title_zh", "organisation_en", "organisation_zh", "unit_en", "unit_zh",
      "category", "category_zh", "expertise_en", "expertise_zh", "years", "interaction_types", "dates", "engagements",
      "city_en", "city_zh", "country", "lat", "lng", "website",
      "summary_en", "summary_zh", "impact_en", "impact_zh", "projects", "photo_count", "wiki_sources", "confidence"];
    const byYear = (s, f) => s.engagements.map(e => e[f] ? `[${e.year}] ${e[f]}` : "").filter(Boolean).join("\n");
    const rows = list.map(s => [
      s.id, s.person_en || s.org_en, s.person_zh || s.org_zh, s.title_en, s.title_zh, s.org_en, s.org_zh, s.unit_en, s.unit_zh,
      I18N.en[`cat.${s.category}`], I18N.zh[`cat.${s.category}`], s.expertise_en, s.expertise_zh,
      s.years.join("; "), s.interactions.join("; "), s.engagements.flatMap(e => e.dates || []).join("; "), s.engagements.length,
      s.city_en, s.city_zh, s.country, s.lat, s.lng, s.website,
      byYear(s, "summary_en"), byYear(s, "summary_zh"), byYear(s, "impact_en"), byYear(s, "impact_zh"),
      [...new Set(s.engagements.map(e => `${e.year} ${e.project || ""}`.trim()))].join("; "),
      allPhotos(s).length, [...new Set(s.engagements.map(e => e.source_url).filter(Boolean))].join(" "),
      ["low", "medium", "high"].find(c => s.engagements.some(e => e.confidence === c)) || ""
    ]);
    const cell = v => {
      const str = v == null ? "" : String(v);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const csv = "﻿" + [head, ...rows].map(r => r.map(cell).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `GEMS_stakeholders_${tag}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(t("csv.done", { n: rows.length }));
  }

  /* ---------------- timeline ---------------- */
  function renderTimeline() {
    const years = YEARS.slice().reverse();
    $("#timeline").innerHTML = years.map(y => {
      const info = YEAR_INFO.get(y) || {};
      const items = S.filter(s => s.years.includes(y))
        .map(s => ({ s, e: s.engagements.find(e => e.year === y) }))
        .sort((a, b) => ((b.e.photos || []).length ? 1 : 0) - ((a.e.photos || []).length ? 1 : 0) || ((a.e.dates || [])[0] || "9").localeCompare((b.e.dates || [])[0] || "9"));
      const catCounts = CATS.map(c => [c, items.filter(x => x.s.category === c).length]).filter(x => x[1]);
      return `
        <section class="tl-year" id="y${y}">
          <div class="wrap">
            <div class="tl-head">
              <div class="tl-num">${y}</div>
              <div class="tl-proj">
                <h2>${esc(loc(info, "project") || "")}</h2>
                ${loc(info, "blurb") ? `<p>${esc(loc(info, "blurb"))}</p>` : ""}
              </div>
              <div class="tl-meta"><b>${items.length}</b>${esc(t("tl.stakeholders"))}<br>${info.wiki ? `<a href="${esc(info.wiki)}" target="_blank" rel="noopener">${esc(t("tl.wiki"))}</a>` : ""}</div>
            </div>
            <div class="tl-cats">${catCounts.map(([c, n]) => `<span class="pill" style="${catVar(c)}">${esc(catLabel(c))} ${n}</span>`).join("")}</div>
            <div class="tl-strip">${items.map(x => cardHTML(x.s, x.e)).join("")}</div>
          </div>
        </section>`;
    }).join("");
  }

  /* ---------------- map ---------------- */
  let map = null, cluster = null, tiles = null;
  const markerById = new Map();
  const darkMQ = matchMedia("(prefers-color-scheme: dark)");

  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const tileURL = () => ESRI + (darkMQ.matches ? "World_Dark_Gray_Base" : "World_Light_Gray_Base") + "/MapServer/tile/{z}/{y}/{x}";
  const labelURL = () => ESRI + (darkMQ.matches ? "World_Dark_Gray_Reference" : "World_Light_Gray_Reference") + "/MapServer/tile/{z}/{y}/{x}";

  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", { zoomControl: false, worldCopyJump: true, minZoom: 2, maxZoom: 16 }).fitBounds(TW_BOUNDS);
    L.control.zoom({ position: "topright" }).addTo(map);
    tiles = L.tileLayer(tileURL(), { maxZoom: 16, attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors" }).addTo(map);
    const labels = L.tileLayer(labelURL(), { maxZoom: 16, pane: "shadowPane" }).addTo(map);
    darkMQ.addEventListener("change", () => { tiles.setUrl(tileURL()); labels.setUrl(labelURL()); });
    cluster = L.markerClusterGroup({
      showCoverageOnHover: false, maxClusterRadius: 44, spiderfyOnMaxZoom: true,
      iconCreateFunction: c => {
        const n = c.getAllChildMarkers().reduce((k, m) => k + (m.options.n || 1), 0);
        return L.divIcon({ html: `<div class="cluster">${n}</div>`, className: "marker-cluster", iconSize: [46, 46] });
      }
    }).addTo(map);
    map.on("moveend", renderMapList);
    renderMapMarkers();
  }

  function renderMapMarkers() {
    if (!map) return;
    cluster.clearLayers(); markerById.clear();
    const groups = new Map();
    filtered().filter(s => typeof s.lat === "number" && typeof s.lng === "number").forEach(s => {
      const k = `${s.lat.toFixed(3)},${s.lng.toFixed(3)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    groups.forEach(list => {
      const rep = list.find(s => s.logo) || list[0];
      const inner = rep.logo ? `<img src="${esc(rep.logo)}" alt="">` : esc(monogram(rep));
      const icon = L.divIcon({
        className: "", iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20],
        html: `<div style="position:relative;${catVar(rep.category)}"><div class="pin ${rep.logo ? "" : "mono"}">${inner}</div>${list.length > 1 ? `<span class="pin-n">${list.length}</span>` : ""}</div>`
      });
      const m = L.marker([rep.lat, rep.lng], { icon, n: list.length, title: loc(rep, "org") });
      m.bindPopup(() => popupHTML(list), { maxWidth: 320, minWidth: 280 });
      list.forEach(s => markerById.set(s.id, m));
      cluster.addLayer(m);
    });
    renderMapList();
  }

  function popupHTML(list) {
    const rep = list[0];
    const orgs = [...new Set(list.map(s => loc(s, "org")))];
    return `<div class="pop">
      <h4>${esc(orgs.length === 1 ? orgs[0] : cityOf(rep))}</h4>
      <div class="pop-city">${esc(cityOf(rep))}</div>
      <ul>${list.map(s => `<li data-open="${esc(s.id)}" style="${catVar(s.category)}">${logoHTML(s)}<div><b>${esc(nameOf(s))}</b><small>${esc([loc(s, "person") ? loc(s, "unit") || loc(s, "title") : loc(s, "unit"), s.years.join(", ")].filter(Boolean).join(" · "))}</small></div></li>`).join("")}</ul>
    </div>`;
  }

  function renderMapList() {
    if (!map) return;
    const b = map.getBounds();
    const all = filtered();
    const vis = all.filter(s => typeof s.lat === "number" && b.contains([s.lat, s.lng]));
    $("#map-count").textContent = t("map.count", { n: vis.length });
    $("#map-list").innerHTML = sortList(vis, "recent").map(s => `
      <li class="ml-item" data-open="${esc(s.id)}" data-pan="${esc(s.id)}" style="${catVar(s.category)}">
        ${logoHTML(s)}
        <div class="ml-txt"><b>${esc(nameOf(s))}</b><small>${esc(loc(s, "person") ? loc(s, "org") : (loc(s, "unit") || cityOf(s)))}</small></div>
        <span class="ml-years">${s.years.slice(-2).map(y => `<span class="yr">${y}</span>`).join("")}</span>
      </li>`).join("") || `<li class="empty-state">${esc(t("empty"))}</li>`;
  }

  $("#map-list").addEventListener("mouseover", e => {
    const li = e.target.closest("[data-pan]");
    if (!li) return;
    const m = markerById.get(li.dataset.pan);
    if (m && m._icon) m._icon.firstChild.firstChild.style.transform = "scale(1.18)";
  });
  $("#map-list").addEventListener("mouseout", e => {
    const li = e.target.closest("[data-pan]");
    if (!li) return;
    const m = markerById.get(li.dataset.pan);
    if (m && m._icon) m._icon.firstChild.firstChild.style.transform = "";
  });

  $("#map-scope").addEventListener("click", e => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    state.mapScope = b.dataset.scope;
    setSeg($("#map-scope"), "scope", state.mapScope);
    fitScope();
  });
  function fitScope() {
    if (!map) return;
    if (state.mapScope === "tw") map.flyToBounds(TW_BOUNDS, { duration: .8 });
    else {
      const pts = S.filter(s => typeof s.lat === "number").map(s => [s.lat, s.lng]);
      if (pts.length) map.flyToBounds(L.latLngBounds(pts).pad(.15), { duration: .8, maxZoom: 4 });
    }
  }
  function showOnMap(id) {
    const s = BY_ID.get(id);
    closeSheet(true);
    go("map");
    setTimeout(() => {
      if (!map || !s || typeof s.lat !== "number") return;
      const m = markerById.get(id);
      if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
      else map.flyTo([s.lat, s.lng], 14);
    }, 350);
  }

  /* ---------------- detail sheet ---------------- */
  let lastFocus = null, sheetEngs = [], keepScroll = false;
  function openDetail(id, fromRoute) {
    const s = BY_ID.get(id);
    if (!s) return;
    lastFocus = document.activeElement;
    const engs = s.engagements.slice().sort((a, b) => b.year - a.year);
    const cover = coverOf(s);
    const sameOrg = S.filter(x => x.id !== s.id && s.org_id && x.org_id === s.org_id);
    const facts = [
      loc(s, "person") && loc(s, "org") ? ["sh.org", esc(loc(s, "org"))] : null,
      loc(s, "unit") ? ["sh.unit", esc(loc(s, "unit"))] : null,
      cityOf(s) ? ["sh.location", esc(cityOf(s))] : null,
      loc(s, "expertise") ? ["sh.expertise", esc(loc(s, "expertise"))] : null,
      s.website ? ["sh.website", `<a href="${esc(s.website)}" target="_blank" rel="noopener">${esc(s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`] : null
    ].filter(Boolean);

    $("#sheet-body").innerHTML = `
      <div class="sh-cover ${cover ? "" : "empty"}" style="${catVar(s.category)}">${cover ? `<img src="${esc(cover)}" alt="">` : ""}</div>
      <div class="sh-head" style="${catVar(s.category)}">
        ${logoHTML(s)}
        ${s.portrait ? `<img class="avatar" src="${esc(s.portrait)}" alt="" onerror="this.remove()">` : ""}
      </div>
      <div class="sh-title">
        <h2 id="sheet-title">${esc(nameOf(s))}${altNameOf(s) ? `<span class="alt">${esc(altNameOf(s))}</span>` : ""}</h2>
        ${loc(s, "person") ? `<p class="sh-role">${esc([loc(s, "title"), loc(s, "org")].filter(Boolean).join(" · "))}</p>` : ""}
        <div class="sh-meta">${pillHTML(s.category)}${yearsHTML(s)}</div>
      </div>
      ${facts.length ? `<dl class="sh-facts">${facts.map(([k, v]) => `<div class="sh-fact"><dt>${esc(t(k))}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
      <section class="sh-section">
        <h3>${esc(t("sh.history"))}</h3>
        ${engs.map((e, ei) => `
          <article class="eng" style="${catVar(s.category)}">
            <div class="eng-head">
              <span class="eng-year">${e.year}</span>
              ${e.project ? `<span class="eng-proj">${esc(e.project)}</span>` : ""}
              ${(e.dates || []).length ? `<span class="eng-dates">${e.dates.map(fmtDate).map(esc).join(" · ")}</span>` : ""}
            </div>
            ${(e.interaction || []).length ? `<div class="eng-tags">${e.interaction.map(i => `<span class="tag">${esc(intLabel(i))}</span>`).join("")}</div>` : ""}
            ${loc(e, "summary") ? `<p>${esc(loc(e, "summary"))}</p>` : ""}
            ${loc(e, "quote") ? `<blockquote>“${esc(loc(e, "quote"))}”</blockquote>` : ""}
            ${loc(e, "impact") ? `<div class="eng-impact"><b>${esc(t("sh.impact"))}</b><p>${esc(loc(e, "impact"))}</p></div>` : ""}
            ${(e.photos || []).length ? `<div class="eng-photos">${e.photos.map((p, pi) => `<button type="button" data-lb="${ei}:${pi}" aria-label="${esc(loc(p, "caption") || "Photo")}"><img src="${esc(p.src)}" alt="${esc(loc(p, "caption"))}" loading="lazy" onerror="this.parentNode.remove()"></button>`).join("")}</div>` : ""}
            ${e.source_url ? `<a class="eng-src" href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(t("sh.source"))}</a>` : ""}
          </article>`).join("")}
      </section>
      ${sameOrg.length ? `<section class="sh-section"><h3>${esc(t("sh.sameOrg"))}</h3><ol class="map-list" style="padding:0">${sameOrg.map(x => `
        <li class="ml-item" data-open="${esc(x.id)}" style="${catVar(x.category)}">${logoHTML(x)}<div class="ml-txt"><b>${esc(nameOf(x))}</b><small>${esc(orgLineOf(x))}</small></div><span class="ml-years">${yearsHTML(x)}</span></li>`).join("")}</ol></section>` : ""}
      <div class="sh-foot">
        ${typeof s.lat === "number" ? `<button type="button" class="btn btn-quiet" data-showmap="${esc(s.id)}">${esc(t("sh.showMap"))}</button>` : ""}
        <button type="button" class="btn btn-quiet" data-copy="${esc(s.id)}">${esc(t("sh.copy"))}</button>
      </div>`;
    $("#sheet-body").scrollTop = 0;
    sheetEngs = engs;
    const sheet = $("#sheet");
    sheet.hidden = false;
    document.documentElement.style.overflow = "hidden";
    $("#sheet-close").focus({ preventScroll: true });
    if (!fromRoute && location.hash !== `#/s/${id}`) history.pushState({ sheet: id }, "", `#/s/${id}`);
  }

  function openCompare() {
    const list = [...state.selected].map(id => BY_ID.get(id)).filter(Boolean);
    if (list.length < 2) return;
    lastFocus = document.activeElement;
    const row = (k, v) => `<div class="cmp-row"><dt>${esc(t(k))}</dt><dd>${v || "—"}</dd></div>`;
    $("#sheet-body").innerHTML = `
      <div class="cmp">
        <h2>${esc(t("cmp.title"))}</h2>
        <div class="cmp-grid" style="--n:${list.length}">
          ${list.map(s => `
            <dl class="cmp-col" style="${catVar(s.category)}">
              ${logoHTML(s)}
              <h3><a href="#/s/${esc(s.id)}">${esc(nameOf(s))}</a></h3>
              ${row("cmp.cat", pillHTML(s.category))}
              ${row("cmp.org", esc([loc(s, "org"), loc(s, "unit")].filter(Boolean).join(" · ")))}
              ${row("cmp.years", yearsHTML(s))}
              ${row("cmp.int", esc(s.interactions.map(intLabel).join(", ")))}
              ${row("cmp.expertise", esc(loc(s, "expertise")))}
              ${row("cmp.location", esc(cityOf(s)))}
              ${row("cmp.impact", s.engagements.filter(e => loc(e, "impact")).map(e => `<b>${e.year}</b> ${esc(loc(e, "impact"))}`).join("<br><br>"))}
            </dl>`).join("")}
        </div>
      </div>`;
    $("#sheet").hidden = false;
    document.documentElement.style.overflow = "hidden";
  }

  function closeSheet(silent) {
    if ($("#sheet").hidden) return;
    $("#sheet").hidden = true;
    document.documentElement.style.overflow = "";
    if (location.hash.startsWith("#/s/")) {
      if (history.state && history.state.sheet && !silent) { keepScroll = true; history.back(); }
      else history.replaceState(null, "", `#/${state.view}`);
    }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $("#sheet-close").addEventListener("click", () => closeSheet());
  $("#sheet").addEventListener("click", e => {
    if (e.target === $("#sheet")) closeSheet();
    const sm = e.target.closest("[data-showmap]");
    if (sm) showOnMap(sm.dataset.showmap);
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      const url = `${location.origin}${location.pathname}#/s/${cp.dataset.copy}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast(t("sh.copied")), () => prompt("URL", url));
    }
    const lb = e.target.closest("[data-lb]");
    if (lb) {
      const [ei, pi] = lb.dataset.lb.split(":").map(Number);
      openLightbox(sheetEngs[ei].photos, pi);
    }
  });

  /* ---------------- lightbox ---------------- */
  const lb = { list: [], i: 0 };
  function openLightbox(list, i) { lb.list = list; lb.i = i; $("#lightbox").hidden = false; showLb(); }
  function showLb() {
    const p = lb.list[lb.i];
    $("#lb-img").src = p.src;
    $("#lb-img").alt = loc(p, "caption");
    $("#lb-cap").textContent = [loc(p, "caption"), lb.list.length > 1 ? `${lb.i + 1} / ${lb.list.length}` : ""].filter(Boolean).join("  ·  ");
    $("#lb-prev").style.visibility = $("#lb-next").style.visibility = lb.list.length > 1 ? "visible" : "hidden";
  }
  const stepLb = d => { lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLb(); };
  $("#lb-prev").addEventListener("click", () => stepLb(-1));
  $("#lb-next").addEventListener("click", () => stepLb(1));
  $("#lb-close").addEventListener("click", () => ($("#lightbox").hidden = true));
  $("#lightbox").addEventListener("click", e => { if (e.target.id === "lightbox" || e.target.classList.contains("lb-figure")) $("#lightbox").hidden = true; });
  document.addEventListener("keydown", e => {
    if (!$("#lightbox").hidden) {
      if (e.key === "Escape") $("#lightbox").hidden = true;
      if (e.key === "ArrowLeft") stepLb(-1);
      if (e.key === "ArrowRight") stepLb(1);
      return;
    }
    if (!$("#sheet").hidden && e.key === "Escape") closeSheet();
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      const i = $(`#view-${state.view} input[data-f="q"]`);
      if (i) { e.preventDefault(); i.focus(); }
    }
  });

  /* ---------------- toast ---------------- */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------------- segmented controls ---------------- */
  function setSeg(root, attr, val) {
    $$(`button[data-${attr}]`, root).forEach(b => b.setAttribute("aria-pressed", String(b.dataset[attr] === val)));
    const on = $(`button[data-${attr}="${val}"]`, root), thumb = $(".seg-thumb", root);
    if (on && thumb) { thumb.style.width = on.offsetWidth + "px"; thumb.style.transform = `translateX(${on.offsetLeft - 2}px)`; }
  }

  /* ---------------- language ---------------- */
  function applyLang() {
    document.documentElement.lang = state.lang === "zh" ? "zh-Hant" : "en";
    document.documentElement.dataset.lang = state.lang;
    $$("[data-i18n]").forEach(el => (el.textContent = t(el.dataset.i18n)));
    $$("[data-i18n-html]").forEach(el => (el.innerHTML = t(el.dataset.i18nHtml)));
    setSeg($(".lang-switch"), "lang", state.lang);
    setSeg($("#map-scope"), "scope", state.mapScope);
    $("#foot-updated").textContent = DATA.generated ? t("foot.updated", { d: fmtDate(DATA.generated) }) : "";
    document.title = state.lang === "zh" ? "GEMS 利害關係人地圖集" : "GEMS Stakeholder Atlas";
    renderFilterbars();
    renderOverview(); renderDirectory(); renderTable(); renderTimeline();
    if (map) { renderMapMarkers(); }
    const open = location.hash.match(/^#\/s\/(.+)$/);
    if (open && !$("#sheet").hidden) openDetail(decodeURIComponent(open[1]), true);
  }
  $(".lang-switch").addEventListener("click", e => {
    const b = e.target.closest("[data-lang]");
    if (!b || b.dataset.lang === state.lang) return;
    state.lang = b.dataset.lang;
    store.set("gems.lang", state.lang);
    applyLang();
  });

  /* ---------------- router ---------------- */
  const VIEWS = ["overview", "map", "directory", "table", "timeline"];
  function go(view) { if (location.hash !== `#/${view}`) location.hash = `#/${view}`; else show(view); }
  function show(view) {
    state.view = view;
    $$(".view").forEach(v => (v.hidden = v.dataset.view !== view));
    $$("#tabs a").forEach(a => { if (a.dataset.view !== view) a.removeAttribute("aria-current"); else a.setAttribute("aria-current", "page"); });
    document.body.classList.toggle("on-map", view === "map");
    if (view === "map") {
      const first = !map;
      initMap();
      setTimeout(() => {
        if (!map) return;
        map.invalidateSize();
        if (first) map.fitBounds(state.mapScope === "tw" ? TW_BOUNDS : map.getBounds(), { animate: false });
        setSeg($("#map-scope"), "scope", state.mapScope);
      }, 60);
    }
    window.scrollTo({ top: 0 });
  }
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const m = h.match(/^s\/(.+)$/);
    if (m) {
      if (!$(`#view-${state.view}`) || $(`#view-${state.view}`).hidden) show(state.view);
      openDetail(decodeURIComponent(m[1]), true);
      return;
    }
    const view = VIEWS.includes(h) ? h : "overview";
    if (keepScroll) { keepScroll = false; if (view === state.view && !$(`#view-${view}`).hidden) return; }
    if (!$("#sheet").hidden) {
      $("#sheet").hidden = true;
      document.documentElement.style.overflow = "";
      if (view === state.view && !$(`#view-${view}`).hidden) return; // closing a sheet keeps the scroll position
    }
    show(view);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => { setSeg($(".lang-switch"), "lang", state.lang); setSeg($("#map-scope"), "scope", state.mapScope); });

  /* ---------------- boot ---------------- */
  applyLang();
  route();
  if (document.fonts) document.fonts.ready.then(() => { setSeg($(".lang-switch"), "lang", state.lang); });
})();
