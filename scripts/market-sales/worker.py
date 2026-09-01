#!/usr/bin/env python3
"""Market-sales worker — county appraiser sale files → market_events ('sale').

Runs on the scraper Mac (launchd, weekly). Pure stdlib; no Supabase WRITE creds here:
  1. logs in as the claude-check account (read-only use) and pulls the book's parcel keys
  2. downloads each enabled county's sales extract (formats + quirks per fetcher below)
  3. keeps only sales of parcels IN THE BOOK, newer than the county cursor (minus overlap)
  4. POSTs the events to the n8n webhook, which ingests via import_market_events
     (service role) and posts the #deals digest; dedupe on (source, source_key) makes
     replays harmless
  5. advances the county cursor only over what n8n confirmed (self-paging caps, like the
     permits workflow)

ALWAYS exits 0 (launchd must never crash-loop); failures ride the report into Slack.
Test with --dry-run (fetch + diff, no POST, no state write) or --county pinellas.
"""

import csv
import io
import json
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) crecrm-market-sales/1.0"}


# ── plumbing ────────────────────────────────────────────────────────────────

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_env():
    env = {}
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    env.update({k: v for k, v in os.environ.items() if k.startswith(("SUPABASE_", "CRM_", "N8N_", "SALES_"))})
    return env


def load_json(name, default):
    path = os.path.join(HERE, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def save_json(name, obj):
    path = os.path.join(HERE, name)
    with open(path + ".tmp", "w") as f:
        json.dump(obj, f, indent=2)
    os.replace(path + ".tmp", path)


def http(url, data=None, headers=None, timeout=120, method=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})}, method=method)
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_resumable(url, dest, tries=30, timeout=180):
    """Some county servers (Pasco) drop long transfers — resume with Range until whole.

    Pasco resets the TLS stream every few hundred KB; 30 Range-resumes ride out a
    ~15 MB file. Progress is logged so a stuck source is visible in the launchd log.
    """
    if os.path.exists(dest) and time.time() - os.path.getmtime(dest) < 20 * 3600:
        try:  # a complete same-day download is reusable (crash recovery / reruns)
            zipfile.ZipFile(dest).namelist()
            return dest
        except zipfile.BadZipFile:
            pass
    for attempt in range(tries):
        if attempt == 0 and os.path.exists(dest):
            os.remove(dest)  # stale or partial from a previous day would 416 a Range request
        have = os.path.getsize(dest) if os.path.exists(dest) else 0
        headers = dict(UA)
        if have:
            headers["Range"] = f"bytes={have}-"
        try:
            with http(url, headers=headers, timeout=timeout) as resp:
                total = None
                if resp.status == 200 and have:  # server ignored Range — start over
                    have = 0
                    open(dest, "wb").close()
                cr = resp.headers.get("Content-Range", "")
                m = re.search(r"/(\d+)$", cr)
                if m:
                    total = int(m.group(1))
                elif resp.headers.get("Content-Length") and not have:
                    total = int(resp.headers["Content-Length"])
                with open(dest, "ab" if have else "wb") as f:
                    while True:
                        chunk = resp.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
            size = os.path.getsize(dest)
            if total is None or size >= total:
                try:  # a finished download must at least open as a zip
                    zipfile.ZipFile(dest).namelist()
                    return dest
                except zipfile.BadZipFile:
                    pass  # truncated despite matching length claim — retry fresh
                    open(dest, "wb").close()
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            got = os.path.getsize(dest) if os.path.exists(dest) else 0
            log(f"    download interrupted at {got:,}B ({type(e).__name__}); resuming ({attempt + 1}/{tries})")
        time.sleep(min(3 + attempt, 15))
    raise RuntimeError(f"could not complete download after {tries} tries: {url}")


def digits(s):
    return re.sub(r"\D", "", s or "")


def money(v):
    try:
        n = float(v)
        return f"${n:,.0f}" if n else None
    except (TypeError, ValueError):
        return None


# ── the book (parcel keys → address), via the claude-check login ────────────

def supabase_token(env):
    body = json.dumps({"email": env["CRM_LOGIN_EMAIL"], "password": env["CRM_LOGIN_PASSWORD"]}).encode()
    with http(f"{env['SUPABASE_URL']}/auth/v1/token?grant_type=password", data=body,
              headers={"apikey": env["SUPABASE_ANON_KEY"], "Content-Type": "application/json"}, timeout=40) as r:
        return json.load(r)["access_token"]


def pinellas_reorder(d):
    """Book parcel_number is SEC/TWN/RNG order; county sale files key RNG/TWN/SEC (STRAP)."""
    return d[4:6] + d[2:4] + d[0:2] + d[6:] if len(d) >= 6 else d


def norm_name(s):
    """County owner names and clerk party names share LAST-FIRST convention — normalize
    both sides identically (upper, alnum+space only, collapsed) and match exactly."""
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", (s or "").upper()).split())


def fetch_book(env, counties):
    """{county: {digit_key: (parcel_number, address, city)}} for every book property,
    plus a per-county OWNER NAME index for lis-pendens matching (name → up to 8 parcels).

    Pinellas rows are indexed under BOTH digit orders; Hillsborough under folio AND pin.
    """
    tok = supabase_token(env)
    headers = {"apikey": env["SUPABASE_ANON_KEY"], "Authorization": f"Bearer {tok}"}
    book = {c: {} for c in counties}
    names = {c: {} for c in counties}
    offset, page = 0, 1000
    while True:
        url = (f"{env['SUPABASE_URL']}/rest/v1/properties"
               f"?select=parcel_number,folio,county,site_address,address,city,owner_name"
               f"&order=id&limit={page}&offset={offset}")
        with http(url, headers=headers, timeout=60) as r:
            rows = json.load(r)
        for row in rows:
            county = (row.get("county") or "").lower()
            if county not in book:
                continue
            addr = row.get("site_address") or row.get("address")
            val = (row.get("parcel_number"), addr, row.get("city"))
            pd = digits(row.get("parcel_number"))
            if pd:
                book[county][pd] = val
                if county == "pinellas":
                    book[county][pinellas_reorder(pd)] = val
            fd = digits(row.get("folio"))
            if fd and county == "hillsborough":
                book[county][fd] = val
            nm = norm_name(row.get("owner_name"))
            if nm and len(nm) > 4:
                lst = names[county].setdefault(nm, [])
                if len(lst) < 8:
                    lst.append(val)
        if len(rows) < page:
            break
        offset += page
    log(f"  book keys: " + ", ".join(f"{c}:{len(v)}" for c, v in book.items())
        + " | owner names: " + ", ".join(f"{c}:{len(v)}" for c, v in names.items()))
    return book, names


# ── county fetchers: yield {key(s), date, price, qual, extra} ───────────────
# Every fetcher yields dicts: keys=[digit strings to try], d=date, price=float|None,
# qualified=bool|None, detail={...}. Full-history files are filtered by since_d here.

def rows_pinellas(since_d, workdir):
    # POST download (needs hdn_ftype=csv and a browser UA); full sale history CSV.
    dest = os.path.join(workdir, "pinellas_rp_sales.zip")
    body = urllib.parse.urlencode({"hdn_tbl_name": "RP_SALES", "hdn_ftype": "csv"}).encode()
    with http("https://www.pcpao.gov/dal/databasefile/downloadDatabaseFile", data=body, timeout=300) as r, \
         open(dest, "wb") as f:
        f.write(r.read())
    z = zipfile.ZipFile(dest)
    with io.TextIOWrapper(z.open(z.namelist()[0]), errors="replace") as f:
        for row in csv.DictReader(f):
            d = (row.get("SALE_DATE") or "")[:10]
            if not d or d < since_d:
                continue
            yield {
                "keys": [digits(row.get("PARCEL_NUMBER")), digits(row.get("STRAP"))],
                "d": d,
                "price": row.get("PRICE"),
                "qualified": (row.get("QUALIFIED_FLG") or "").upper() == "Q",
                "detail": {"vacant_improved": row.get("VACANT_IMPROVED"),
                           "grantor": row.get("GRANTOR"), "grantee": row.get("GRANTEE"),
                           "book_page": row.get("BOOK_PAGE")},
            }


def rows_hillsborough(since_d, workdir):
    # RadGrid __doPostBack download of allsales_MM_DD_YYYY.zip → allsales.dbf (FOLIO-keyed).
    page = http("https://downloads.hcpafl.org/", timeout=60).read().decode(errors="replace")
    def field(name):
        m = re.search(r'id="%s" value="([^"]*)"' % name, page)
        return m.group(1) if m else ""
    m = re.search(r"__doPostBack\(&#39;([^&]+)&#39;[^>]*>(?:<i[^>]*></i>)?\s*(allsales[^<]*\.zip)", page)
    if not m:
        raise RuntimeError("allsales row not found on downloads.hcpafl.org")
    body = urllib.parse.urlencode({
        "__EVENTTARGET": m.group(1), "__EVENTARGUMENT": "",
        "__VIEWSTATE": field("__VIEWSTATE"), "__VIEWSTATEGENERATOR": field("__VIEWSTATEGENERATOR"),
        "__EVENTVALIDATION": field("__EVENTVALIDATION"),
    }).encode()
    dest = os.path.join(workdir, "hillsborough_allsales.zip")
    with http("https://downloads.hcpafl.org/", data=body, timeout=900) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    z = zipfile.ZipFile(dest)
    name = [n for n in z.namelist() if n.lower().endswith(".dbf")][0]
    with z.open(name) as f:
        hdr = f.read(32)
        nrec, hdrlen, reclen = struct.unpack("<IHH", hdr[4:12])
        fdefs, fdata, pos = [], f.read(hdrlen - 32), 1
        for i in range(0, len(fdata) - 1, 32):
            raw = fdata[i:i + 32]
            if raw[0:1] == b"\r":
                break
            fname = raw[0:11].split(b"\x00")[0].decode(errors="replace")
            flen = raw[16]
            fdefs.append((fname, pos, flen))
            pos += flen
        offs = {n: (p, l) for n, p, l in fdefs}
        def sl(rec, name):
            p, l = offs[name]
            return rec[p:p + l].decode(errors="replace").strip()
        since_compact = since_d.replace("-", "")
        for _ in range(nrec):
            rec = f.read(reclen)
            if len(rec) < reclen or rec[0:1] == b"*":
                continue
            sd = sl(rec, "S_DATE")  # YYYYMMDD
            if len(sd) != 8 or sd < since_compact:
                continue
            yield {
                "keys": [digits(sl(rec, "FOLIO")), digits(sl(rec, "PIN"))],
                "d": f"{sd[0:4]}-{sd[4:6]}-{sd[6:8]}",
                "price": sl(rec, "S_AMT"),
                "qualified": sl(rec, "QU").upper() in ("Q", "U", "1"),  # QU carries qual flag; raw kept below
                "detail": {"qual_code": sl(rec, "QU"), "vacant_improved": sl(rec, "VI"),
                           "dor_code": sl(rec, "DOR_CODE"), "deed": sl(rec, "S_TYPE"),
                           "grantor": sl(rec, "GRANTOR"), "grantee": sl(rec, "GRANTEE")},
            }


def rows_polk(since_d, workdir):
    dest = fetch_resumable(
        "https://www.polkflpa.gov/FTPPage/downloader.ashx?filename=ftp_sales.zip&dir=%5CAppraisalData%5C",
        os.path.join(workdir, "polk_sales.zip"))
    z = zipfile.ZipFile(dest)
    name = [n for n in z.namelist() if n.lower().endswith(".txt")][0]
    with io.TextIOWrapper(z.open(name), errors="replace") as f:
        for row in csv.DictReader(f):
            raw = (row.get("SALEDT") or "").strip()  # MM/DD/YYYY
            try:
                d = datetime.strptime(raw, "%m/%d/%Y").date().isoformat()
            except ValueError:
                continue
            if d < since_d:
                continue
            dscr = row.get("TRNS_DSCR") or ""
            yield {
                "keys": [digits(row.get("PARCEL_ID"))],
                "d": d,
                "price": row.get("PRICE"),
                "qualified": "disqualified" not in dscr.lower(),
                "detail": {"transfer": dscr.strip() or None, "instrument": (row.get("INSTRTYP_DSCR") or "").strip() or None,
                           "grantor": row.get("GRANTOR"), "grantee": row.get("GRANTEE"),
                           "foreclosure": row.get("FORECLOSURE")},
            }


def rows_pasco(since_d, workdir):
    # Server drops long transfers — fetch_resumable rides it out. Header names are mapped
    # defensively; an unrecognized layout raises so the failure is VISIBLE in the digest.
    dest = fetch_resumable("https://ftp01.pascopa.com/real_estate/sales.zip",
                           os.path.join(workdir, "pasco_sales.zip"), tries=80)  # ~800KB/burst
    z = zipfile.ZipFile(dest)
    # zip holds README.TXT + sales_all.csv (all history) + sales_last_10years.csv — use the latter.
    names = [n for n in z.namelist() if n.lower().endswith(".csv")]
    name = next((n for n in names if "10" in n), max(names, key=lambda n: z.getinfo(n).file_size))
    with io.TextIOWrapper(z.open(name), errors="replace") as f:
        rd = csv.DictReader(f)
        if "Parcel_Num" not in (rd.fieldnames or []):
            raise RuntimeError(f"pasco sales layout changed: {(rd.fieldnames or [])[:10]}")
        for row in rd:
            raw = (row.get("Sale_Date") or "").strip()  # MM/DD/YYYY
            try:
                d = datetime.strptime(raw, "%m/%d/%Y").date().isoformat()
            except ValueError:
                continue
            if d < since_d:
                continue
            yield {
                "keys": [digits(row.get("Parcel_Num"))],
                "d": d,
                "price": row.get("Sale_Price"),
                "qualified": (row.get("Sale_Qualified") or "").upper() == "Q",
                # their header really spells it "Sale_Qalified_Code"
                "detail": {"qual_code": row.get("Sale_Qalified_Code"),
                           "vacant_improved": row.get("Sale_VacImp"),
                           "deed": row.get("Sale_Deed_Type"),
                           "book_page": f"{row.get('Sale_Book')}/{row.get('Sale_Page')}".strip("/") or None},
            }


def rows_sarasota(since_d, workdir):
    dest = fetch_resumable("https://www.sc-pa.com/downloads/SCPA_Detailed_Data.zip",
                           os.path.join(workdir, "sarasota_detailed.zip"))
    z = zipfile.ZipFile(dest)
    with io.TextIOWrapper(z.open("Sales.txt"), errors="replace") as f:
        for row in csv.DictReader(f):
            d = (row.get("saledate") or "")[:10]
            if not d or d < since_d:
                continue
            nal = (row.get("nalcode") or "").strip().lstrip("0") or "0"
            yield {
                "keys": [digits(row.get("parcelid"))],
                "d": d,
                "price": row.get("saleprice"),
                "qualified": nal in ("1", "2", "3", "4", "5"),  # FDOR qual codes 01–05
                "detail": {"nal_code": row.get("nalcode"), "deed": row.get("deedtype"),
                           "doc_stamps": row.get("docstamps"), "book_page": f"{row.get('book')}/{row.get('page')}".strip("/") or None},
            }


def rows_manatee(since_d, workdir):
    # CCDF is one wide parcel-level CSV — last-sale columns only, so this is a
    # "last sale moved" diff rather than full history. Good enough weekly.
    dest = fetch_resumable("https://www.manateepao.gov/data/manatee_ccdf.zip",
                           os.path.join(workdir, "manatee_ccdf.zip"))
    z = zipfile.ZipFile(dest)
    def us_date(v):  # CCDF dates are MM/DD/YYYY
        try:
            return datetime.strptime((v or "").strip(), "%m/%d/%Y").date().isoformat()
        except ValueError:
            return None
    with io.TextIOWrapper(z.open(z.namelist()[0]), errors="replace") as f:
        for row in csv.DictReader(f):
            d = us_date(row.get("SALE_DATE_LAST"))
            if not d or d < since_d:
                continue
            lq = us_date(row.get("SALE_DATE_LQ"))
            yield {
                "keys": [digits(row.get("PARID"))],
                "d": d,
                "price": row.get("SALE_PRICE_LAST"),
                "qualified": d == lq,
                "detail": {"last_qualified_date": lq},
            }


FETCHERS = {
    "pinellas": rows_pinellas,
    "hillsborough": rows_hillsborough,
    "polk": rows_polk,
    "pasco": rows_pasco,
    "sarasota": rows_sarasota,
    "manatee": rows_manatee,
}


# ── distress tier: HC code enforcement (cases / condemnations / liens) ──────
# CodeEnforcementCasesMapService is Accela-fed, county-wide, "active" snapshots with no
# date columns — so no cursor: every run sends all OPEN cases matched to the book and the
# server-side dedupe alerts only on first sight. Weekly cadence fits (cases run months).

CE_BASE = ("https://services.arcgis.com/apTfC6SUmnNfnxuF/arcgis/rest/services/"
           "CodeEnforcementCasesMapService/FeatureServer")
CE_OPEN_STATUSES = (
    "Warning Issued", "Pending", "Fine Run", "Adjudicated", "Abatement", "Notice Issued",
    "Referred", "In Review", "Hearing Scheduled", "New Owner Fine", "Open", "Inspection",
    "Extension", "In Progress",
)


def arcgis_rows(url, where, out_fields):
    offset = 0
    while True:
        q = urllib.parse.urlencode({
            "where": where, "outFields": out_fields, "returnGeometry": "false",
            "resultOffset": offset, "resultRecordCount": 2000, "f": "json"})
        with http(f"{url}/query?{q}", timeout=120) as r:
            d = json.load(r)
        if "error" in d:
            raise RuntimeError(f"arcgis error: {d['error']}")
        feats = d.get("features", [])
        for f in feats:
            yield f["attributes"]
        if not d.get("exceededTransferLimit") and len(feats) < 2000:
            return
        offset += len(feats)


def folio_variants(v):
    """HC folio spellings: '003052.4000', bare int 50767 (→ 050767 + 0000), digit runs."""
    s = str(v or "").strip()
    out = []
    dz = digits(s)
    if dz:
        out.append(dz)
    if "." in s:
        i, frac = s.split(".", 1)
        out.append(digits(i) .zfill(6) + digits(frac).ljust(4, "0"))
    elif dz and len(dz) <= 6:
        out.append(dz.zfill(6) + "0000")
    return [k for k in dict.fromkeys(out) if k]


ORI_BASE = "https://publicaccess.hillsclerk.com"


def rows_hc_lis_pendens(lookback_days=14):
    """Hillsborough Clerk ORI Public Access (OnBase PAV) — lis pendens recordings.

    Anonymous: GET the page for cookies, then POST the legacy KeywordSearch
    (QueryID 322 = ORI-Document Type; keyword 1285 = doc type, 1634 = record date).
    Rows come one per PARTY; group by instrument. PARTY 1 = plaintiff (lender/HOA),
    PARTY 2 = defendants (the owners) — matched upstream against book owner names.
    """
    import http.cookiejar
    cj = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    op.addheaders = list(UA.items())
    op.open(ORI_BASE + "/oripublicaccess/customSearch.html", timeout=60).read()
    fmt = lambda d: d.strftime("%m/%d/%Y")
    body = json.dumps({"QueryID": 322, "QueryLimit": 5000, "Keywords": [
        {"ID": 1285, "Value": "(LP) LIS PENDENS", "KeywordOperator": "="},
        {"ID": 1634, "Value": fmt(date.today() - timedelta(days=lookback_days)) + " 00:00:00.000",
         "KeywordOperator": ">="},
        {"ID": 1634, "Value": fmt(date.today()) + " 23:59:59.999", "KeywordOperator": "<="},
    ]}).encode()
    req = urllib.request.Request(ORI_BASE + "/oripublicaccess/api/CustomQuery/KeywordSearch",
                                 data=body, headers={"Content-Type": "application/json"})
    d = json.load(op.open(req, timeout=120))
    by_inst = {}
    for item in d.get("Data", []):
        v = [c.get("Value") or "" for c in item.get("DisplayColumnValues", [])]
        if len(v) < 8 or not v[7]:
            continue
        g = by_inst.setdefault(v[7], {"plaintiffs": [], "defendants": [], "recorded": None,
                                      "case": None, "legal": None})
        if v[0] == "PARTY 1" and v[1]:
            g["plaintiffs"].append(v[1])
        if v[0] == "PARTY 2" and v[1]:
            g["defendants"].append(v[1])
        if v[2] and not g["recorded"]:
            try:
                g["recorded"] = datetime.strptime(v[2].split(" ")[0], "%m/%d/%Y").date().isoformat()
            except ValueError:
                pass
        if v[6] and not g["legal"]:
            g["legal"] = v[6][:200]
        if not g["case"]:
            m = re.search(r"Case # - ?([0-9A-Z-]{8,})", item.get("Name") or "")
            if m:
                g["case"] = m.group(1)
    return by_inst


def rows_hc_code_enforcement():
    where = "STATUS IN (" + ",".join(f"'{s}'" for s in CE_OPEN_STATUSES) + ")"
    for a in arcgis_rows(f"{CE_BASE}/0", where, "Permits_Pl,ADDRESS,PARCEL_NO_NO,STATUS,OFFICER"):
        case = (a.get("Permits_Pl") or "").strip()
        if not case:
            continue
        yield {"keys": folio_variants(a.get("PARCEL_NO_NO")), "kind": "case", "case": case,
               "status": (a.get("STATUS") or "").strip(),
               "src_addr": " ".join((a.get("ADDRESS") or "").split()),
               "detail": {"officer": (a.get("OFFICER") or "").strip() or None}}
    for a in arcgis_rows(f"{CE_BASE}/1", "1=1", "CASE_,DATA_STATUS,FOLIO,ADDRESS"):
        case = (a.get("CASE_") or "").strip()
        if not case:
            continue
        yield {"keys": folio_variants(a.get("FOLIO")), "kind": "condemnation", "case": case,
               "status": (a.get("DATA_STATUS") or "").strip(),
               "src_addr": " ".join((a.get("ADDRESS") or "").split()), "detail": {}}
    for a in arcgis_rows(f"{CE_BASE}/3", "1=1", "Permits_Pl,ADDRESS,PARCEL_NO,BALANCE"):
        case = (a.get("Permits_Pl") or "").strip()
        if not case:
            continue
        yield {"keys": folio_variants(a.get("PARCEL_NO")), "kind": "lien", "case": case,
               "status": None,
               "src_addr": " ".join((a.get("ADDRESS") or "").split()),
               "detail": {"balance": a.get("BALANCE")}}


# ── main ────────────────────────────────────────────────────────────────────

def run():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    only = args[args.index("--county") + 1].lower() if "--county" in args else None

    cfg = load_json("config.json", {})
    env = load_env()
    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "CRM_LOGIN_EMAIL", "CRM_LOGIN_PASSWORD", "N8N_INGEST_URL", "SALES_INGEST_TOKEN"):
        if k not in env:
            log(f"FATAL: {k} missing from .env — see README")
            return
    state = load_json("state.json", {"cursors": {}})
    workdir = os.path.join(HERE, "downloads")
    os.makedirs(workdir, exist_ok=True)

    counties = [c for c, cc in cfg.get("counties", {}).items() if cc.get("enabled")]
    if only:
        counties = [c for c in counties if c == only]
    distress_on = bool(cfg.get("distress", {}).get("hc_code_enforcement", True)) and \
        only in (None, "distress", "hillsborough")
    log(f"run start — counties: {counties}{' + distress' if distress_on else ''}{' (dry-run)' if dry else ''}")

    book_counties = list(dict.fromkeys(counties + (["hillsborough"] if distress_on else [])))
    try:
        book, owner_names = fetch_book(env, book_counties)
    except Exception as e:
        log(f"FATAL: book fetch failed: {e}")
        return

    overlap = int(cfg.get("overlap_days", 7))
    lookback = int(cfg.get("initial_lookback_days", 30))
    cap = int(cfg.get("max_events_per_county", 400))
    events, report = [], {"counties": {}, "started_at": datetime.now().isoformat(timespec="seconds")}

    for county in counties:
        cursor = state["cursors"].get(county)
        since = ((date.fromisoformat(cursor) - timedelta(days=overlap)) if cursor
                 else (date.today() - timedelta(days=lookback))).isoformat()
        log(f"— {county}: since {since} (cursor {cursor or 'none'})")
        cinfo = {"since": since, "scanned": 0, "book_hits": 0, "sent": 0, "error": None}
        try:
            hits = []
            for row in FETCHERS[county](since, workdir):
                cinfo["scanned"] += 1
                hit = None
                for k in row["keys"]:
                    if k and k in book[county]:
                        hit = book[county][k]
                        break
                if not hit:
                    continue
                cinfo["book_hits"] += 1
                parcel_number, addr, city = hit
                if not addr or len(addr.strip()) <= 2:  # a few book rows carry junk like "0"
                    addr = parcel_number
                amount = money(row.get("price"))
                title = "Sale: " + (addr or parcel_number or "book property")
                if city:
                    title += f", {city}"
                if amount:
                    title += f" — {amount}"
                if row.get("qualified") is False:
                    title += " (unqualified)"
                detail = {k: v for k, v in (row.get("detail") or {}).items() if v not in (None, "", " ")}
                detail["price"] = row.get("price")
                detail["qualified"] = row.get("qualified")
                hits.append({
                    "event_type": "sale",
                    "source": f"county_sales:{county}",
                    "source_key": f"{county}:{(digits(parcel_number) or row['keys'][0])}:{row['d'].replace('-', '')}",
                    "event_date": row["d"],
                    "county": county.capitalize(),
                    "parcel_number": parcel_number,
                    "address": addr,
                    "city": city,
                    "title": title[:300],
                    "detail": detail,
                })
            hits.sort(key=lambda e: e["event_date"])
            sent = hits[:cap]
            cinfo["sent"] = len(sent)
            cinfo["truncated"] = len(hits) > cap
            events.extend(sent)
            cinfo["new_cursor"] = max((e["event_date"] for e in sent), default=cursor or since)
            log(f"  scanned {cinfo['scanned']:,} rows since {since}; {cinfo['book_hits']} on book; sending {cinfo['sent']}")
        except Exception as e:
            cinfo["error"] = str(e)[:300]
            log(f"  ERROR: {e}")
        report["counties"][county] = cinfo

    # distress tier (no cursor — dedupe alerts only on first sight of a case)
    if distress_on:
        cinfo = {"scanned": 0, "book_hits": 0, "sent": 0, "error": None}
        log("— hc_code_enforcement: cases + condemnations + liens")
        try:
            hbook = book.get("hillsborough", {})
            for row in rows_hc_code_enforcement():
                cinfo["scanned"] += 1
                hit = next((hbook[k] for k in row["keys"] if k in hbook), None)
                if not hit:
                    continue
                cinfo["book_hits"] += 1
                parcel_number, addr, city = hit
                if not addr or len(addr.strip()) <= 2:
                    addr = parcel_number
                kind = row["kind"]
                if kind == "lien":
                    bal = money(row["detail"].get("balance"))
                    title = f"CE lien{' ' + bal if bal else ''} — {addr}"
                elif kind == "condemnation":
                    title = f"Condemnation ({row['status'] or 'active'}) — {addr}"
                else:
                    title = f"Code enforcement ({row['status']}) — {addr}"
                if city:
                    title += f", {city}"
                detail = {k: v for k, v in row["detail"].items() if v not in (None, "")}
                detail.update({"kind": kind, "case": row["case"], "status": row["status"],
                               "source_address": row["src_addr"] or None})
                events.append({
                    "event_type": "code_enforcement",
                    "source": "hc_code_enforcement",
                    "source_key": f"hcce:{row['case']}",
                    "event_date": None,
                    "county": "Hillsborough",
                    "parcel_number": parcel_number,
                    "address": addr,
                    "city": city,
                    "title": title[:300],
                    "detail": detail,
                })
                cinfo["sent"] += 1
            log(f"  scanned {cinfo['scanned']:,} open cases; {cinfo['book_hits']} on book")
        except Exception as e:
            cinfo["error"] = str(e)[:300]
            log(f"  ERROR: {e}")
        report["counties"]["hc_code_enforcement"] = cinfo

    if distress_on and cfg.get("distress", {}).get("hc_lis_pendens", True):
        cinfo = {"scanned": 0, "book_hits": 0, "sent": 0, "error": None}
        log("— hc_lis_pendens: clerk lis pendens, last 14d")
        try:
            hnames = owner_names.get("hillsborough", {})
            # Institutional names show up constantly as JOINED co-defendants (junior
            # lienholders, HOAs, govt) in suits about OTHER people's property — and the
            # book owns their branches/common areas, so they false-match. Party order is
            # alphabetical (not pleading order), so a blocklist is the only filter.
            SKIP = ("UNKNOWN", "CITY OF ", "STATE OF ", "COUNTY OF ", "HILLSBOROUGH COUNTY",
                    "UNITED STATES", "SECRETARY OF", "DEPARTMENT OF", "CLERK OF",
                    " BANK", "BANK ", "CREDIT UNION", "MORTGAGE", "LENDING", " LOAN",
                    "FINANCIAL", "FINANCE", " ASSOCIATION", "TENANT")
            for inst, g in rows_hc_lis_pendens().items():
                cinfo["scanned"] += 1
                hit, hit_name = None, None
                for dn in g["defendants"]:
                    n = norm_name(dn)
                    if not n or any(k in n for k in SKIP):
                        continue
                    if n in hnames:
                        hit, hit_name = hnames[n], dn
                        break
                if not hit:
                    continue
                cinfo["book_hits"] += 1
                parcel_number, addr, city = hit[0]
                if not addr or len(addr.strip()) <= 2:
                    addr = parcel_number
                title = f"Lis pendens filed: {hit_name} — {addr}"
                if city:
                    title += f", {city}"
                events.append({
                    "event_type": "foreclosure",
                    "source": "hc_lis_pendens",
                    "source_key": f"hclp:{inst}",
                    "event_date": g["recorded"],
                    "county": "Hillsborough",
                    "parcel_number": parcel_number,
                    "address": addr,
                    "city": city,
                    "title": title[:300],
                    "detail": {"stage": "lis_pendens", "instrument": inst, "case": g["case"],
                               "plaintiffs": g["plaintiffs"][:3] or None,
                               "defendants": g["defendants"][:6] or None,
                               "legal": g["legal"],
                               "owner_parcels_in_book": len(hit),
                               "note": ("owner holds multiple book parcels — pull the case to confirm "
                                        "which property is in the suit") if len(hit) > 1 else None},
                })
                cinfo["sent"] += 1
            log(f"  {cinfo['scanned']} filings scanned; {cinfo['book_hits']} matched book owners")
        except Exception as e:
            cinfo["error"] = str(e)[:300]
            log(f"  ERROR: {e}")
        report["counties"]["hc_lis_pendens"] = cinfo

    report["total_events"] = len(events)
    if dry:
        log(f"dry-run: {len(events)} events; not posting. Sample:")
        for e in events[:5]:
            log(f"  {e['title']}  [{e['source']}]")
        return

    try:
        body = json.dumps({"events": events, "report": report}).encode()
        with http(env["N8N_INGEST_URL"], data=body,
                  headers={"Content-Type": "application/json", "x-sales-token": env["SALES_INGEST_TOKEN"]},
                  timeout=180) as r:
            result = json.load(r)
        log(f"ingest ok: {result}")
        for county, cinfo in report["counties"].items():
            if not cinfo.get("error") and cinfo.get("new_cursor"):
                state["cursors"][county] = cinfo["new_cursor"]
        state["last_run"] = report["started_at"]
        state["last_result"] = result
        save_json("state.json", state)
    except Exception as e:
        log(f"ingest FAILED (cursors not advanced; next run replays): {e}")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:  # belt and braces: launchd never sees a non-zero exit
        log(f"UNCAUGHT: {e}")
    sys.exit(0)
