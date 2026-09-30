#!/usr/bin/env python3
"""Build the site data from the per-year source files.

    python3 tools/build.py            # merge, fetch new photos, write data/stakeholders.{js,json,csv}
    python3 tools/build.py --offline  # same, but never download (remote photos stay remote)

Sources (edit these, never the generated files):
    data/years/<year>.json   one record per stakeholder per year (see README)
    data/orgs.json           one entry per organisation: logo, website, names, location
    data/meta.json           one entry per iGEM season: project name and blurb

Photos given as https URLs are downloaded once into assets/photos/<year>/,
resized to 1600 px on the long side and saved as .webp. Local paths are used as is.
"""
import csv, hashlib, json, os, re, subprocess, sys, tempfile, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PHOTOS = ROOT / "assets" / "photos"
OFFLINE = "--offline" in sys.argv

CATS = ["academia", "research", "government", "industry", "ngo", "education", "community", "medical", "igem", "media"]
PERSON_FIELDS = ["person_en", "person_zh", "title_en", "title_zh", "expertise_en", "expertise_zh", "portrait"]
ORG_FIELDS = ["org_en", "org_zh", "unit_en", "unit_zh", "category", "website", "city_en", "city_zh", "country", "lat", "lng"]
ENG_FIELDS = ["year", "project", "interaction", "dates", "summary_en", "summary_zh", "impact_en", "impact_zh",
              "quote_en", "quote_zh", "photos", "source_url", "confidence"]


def slug(s):
    s = (s or "").lower()
    s = re.sub(r"^(prof\.?|dr\.?|mr\.?|ms\.?|mrs\.?|director|professor)\s+", "", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "x"


def localise(url, year):
    """Return a local path for a remote photo, downloading it once."""
    if not url or not url.startswith("http"):
        return url
    h = hashlib.sha1(url.encode()).hexdigest()[:12]
    out = PHOTOS / str(year) / f"{h}.webp"
    rel = out.relative_to(ROOT).as_posix()
    if out.exists():
        return rel
    if OFFLINE:
        return url
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (GEMS stakeholder atlas build)"})
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read()
        ext = os.path.splitext(url.split("?")[0])[1].lower() or ".img"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
            f.write(raw)
            tmp = f.name
        if ext in (".avif", ".heic") and sys.platform == "darwin":  # ImageMagick may lack the codec; macOS sips has it
            subprocess.run(["sips", "-s", "format", "png", tmp, "--out", tmp + ".png"], check=True, capture_output=True)
            os.unlink(tmp)
            tmp = tmp + ".png"
        src = tmp + "[0]" if ext == ".gif" else tmp
        subprocess.run(["magick", src, "-auto-orient", "-resize", "1600x1600>", "-strip", "-quality", "78", str(out)],
                       check=True, capture_output=True)
        os.unlink(tmp)
        print(f"  photo  {url} -> {rel}")
        return rel
    except Exception as e:  # keep the remote URL; the page still works
        print(f"  !! could not fetch {url}: {e}")
        return url


def main():
    orgs = json.loads((DATA / "orgs.json").read_text()) if (DATA / "orgs.json").exists() else {}
    meta = json.loads((DATA / "meta.json").read_text()) if (DATA / "meta.json").exists() else {"years": []}

    records = []
    for f in sorted((DATA / "years").glob("*.json")):
        for r in json.loads(f.read_text()):
            records.append(r)

    people = {}
    for r in records:
        assert r.get("category") in CATS, f"bad category in {r.get('id')}: {r.get('category')}"
        oid = r.get("org_id") or slug(r.get("org_en"))
        r["org_id"] = oid
        sid = r.get("id") or (slug(r.get("person_en")) if r.get("person_en") else f"{oid}-{slug(r.get('unit_en'))}" if r.get("unit_en") else oid)
        s = people.setdefault(sid, {"id": sid, "org_id": oid, "engagements": []})
        for k in PERSON_FIELDS + ORG_FIELDS:
            if r.get(k) not in (None, "", []) and s.get(k) in (None, "", []):
                s[k] = r[k]
            elif r.get(k) not in (None, "", []) and r["year"] > max([e["year"] for e in s["engagements"]] or [0]):
                s[k] = r[k]  # the newest year wins for titles, units, etc.
        eng = {k: r.get(k) for k in ENG_FIELDS}
        eng["interaction"] = eng["interaction"] or []
        eng["dates"] = sorted(eng["dates"] or [])
        eng["photos"] = [dict(p, src=localise(p["src"], r["year"])) for p in (eng["photos"] or []) if p.get("src")]
        s["engagements"].append(eng)

    out = []
    for s in people.values():
        o = orgs.get(s["org_id"], {})
        for k, v in o.items():
            if k == "logo" or k == "abbr":
                s[k] = v
            elif k in ORG_FIELDS and v not in (None, "") and k not in ("unit_en", "unit_zh"):
                if k in ("lat", "lng", "city_en", "city_zh", "country") and s.get("lock_location"):
                    continue
                s[k] = v
        if s.get("portrait"):
            s["portrait"] = localise(s["portrait"], min(e["year"] for e in s["engagements"]))
        s["engagements"].sort(key=lambda e: e["year"])
        s["years"] = sorted({e["year"] for e in s["engagements"]})
        s["interactions"] = sorted({i for e in s["engagements"] for i in e["interaction"]})
        s.setdefault("logo", None)
        out.append(s)

    out.sort(key=lambda s: (-max(s["years"]), s.get("org_en") or "", s.get("person_en") or ""))
    payload = {"generated": date.today().isoformat(), "years": meta.get("years", []), "stakeholders": out}
    js = json.dumps(payload, ensure_ascii=False, indent=1)
    (DATA / "stakeholders.json").write_text(js + "\n")
    (DATA / "stakeholders.js").write_text("/* generated by tools/build.py; edit data/years/*.json instead */\nwindow.GEMS_DATA = " + js + ";\n")
    write_csv(out)
    stamp_assets()
    print(f"{len(out)} stakeholders, {sum(len(s['engagements']) for s in out)} engagements, {len(records)} records")


def stamp_assets():
    """Give every local CSS/JS link in index.html a ?v=<content hash>, so a browser never pairs
    a new page with a stylesheet or script it cached from an older version."""
    page = ROOT / "index.html"
    html = page.read_text()
    def repl(m):
        f = ROOT / m.group(1)
        return f'{m.group(1)}?v={hashlib.md5(f.read_bytes()).hexdigest()[:8]}' if f.exists() else m.group(0)
    html2 = re.sub(r'((?:assets/(?:css|js)/[\w.-]+\.(?:css|js))|data/stakeholders\.js)(?:\?v=[0-9a-f]+)?', repl, html)
    if html2 != html:
        page.write_text(html2)


def write_csv(out):
    head = ["id", "name_en", "name_zh", "title_en", "title_zh", "organisation_en", "organisation_zh", "unit_en", "unit_zh",
            "category", "expertise_en", "expertise_zh", "years", "interaction_types", "dates", "engagements",
            "city_en", "city_zh", "country", "lat", "lng", "website", "summary_en", "summary_zh", "impact_en", "impact_zh", "wiki_sources", "confidence"]
    by_year = lambda s, f: "\n".join(f"[{e['year']}] {e[f]}" for e in s["engagements"] if e.get(f))
    with open(DATA / "stakeholders.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(head)
        for s in out:
            w.writerow([s["id"], s.get("person_en") or s.get("org_en"), s.get("person_zh") or s.get("org_zh"),
                        s.get("title_en"), s.get("title_zh"), s.get("org_en"), s.get("org_zh"), s.get("unit_en"), s.get("unit_zh"),
                        s["category"], s.get("expertise_en"), s.get("expertise_zh"), "; ".join(map(str, s["years"])),
                        "; ".join(s["interactions"]), "; ".join(d for e in s["engagements"] for d in e["dates"]), len(s["engagements"]),
                        s.get("city_en"), s.get("city_zh"), s.get("country"), s.get("lat"), s.get("lng"), s.get("website"),
                        by_year(s, "summary_en"), by_year(s, "summary_zh"), by_year(s, "impact_en"), by_year(s, "impact_zh"),
                        " ".join(sorted({e["source_url"] for e in s["engagements"] if e.get("source_url")})), lowest(s)])


def lowest(s):
    order = ["low", "medium", "high"]
    cs = [e.get("confidence") for e in s["engagements"] if e.get("confidence") in order]
    return min(cs, key=order.index) if cs else ""


if __name__ == "__main__":
    main()
