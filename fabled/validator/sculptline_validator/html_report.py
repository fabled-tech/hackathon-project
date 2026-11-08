"""Single-file HTML report. Every number shown comes from the report dict of a real run."""
from __future__ import annotations

import html
import json
import os

E = html.escape

CSS = """
:root{--cream:#F3EFE7;--card:#FAF7F1;--brown:#8B5E1A;--dark:#1C1814;--muted:#6E645A;--line:#E2D9CA;
--red:#A83A28;--redbg:#F7E1D9;--amber:#A86A12;--amberbg:#F8EBCF;--green:#3E7B4F;--greenbg:#E3EEDF;--grey:#8A8178;--greybg:#ECE7DE}
*{box-sizing:border-box}html,body{margin:0;background:var(--cream);color:var(--dark);
font-family:Inter,"Inter Tight","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{width:1920px;min-height:1080px;margin:0 auto;padding:34px 64px 24px}
.top{display:flex;align-items:center;justify-content:space-between;height:44px}
.brand{font-family:"Playfair Display",Georgia,serif;font-size:30px;font-weight:700;color:var(--brown);letter-spacing:.5px}
.brand span{font-family:Inter,Arial,sans-serif;font-weight:500;font-size:20px;color:var(--muted);margin-left:16px;letter-spacing:0}
.tags{display:flex;gap:10px}
.tag{font-size:15px;font-weight:600;padding:6px 14px;border-radius:8px;border:1.5px solid var(--brown);color:var(--brown);background:var(--card)}
.tag.solid{background:var(--brown);color:#fff}
.hero{display:flex;justify-content:space-between;align-items:stretch;margin:16px 0 18px;gap:32px}
.asset{flex:1;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px 28px}
.lbl{font-size:14px;text-transform:uppercase;letter-spacing:1.6px;color:var(--muted);font-weight:600}
.asset h1{font-family:"Playfair Display",Georgia,serif;font-size:38px;margin:6px 0 8px;font-weight:700;word-break:break-all}
.meta{font-size:17px;color:var(--muted)}
.meta b{color:var(--dark);font-weight:600}
.verdict{width:560px;border-radius:16px;padding:20px 28px;color:#fff;display:flex;flex-direction:column;justify-content:center}
.verdict.fail{background:var(--red)}.verdict.warn{background:var(--amber)}.verdict.pass{background:var(--green)}.verdict.error{background:var(--dark)}
.verdict .big{font-family:"Playfair Display",Georgia,serif;font-size:44px;font-weight:700;line-height:1.05}
.verdict .sub{font-size:18px;margin-top:6px;opacity:.95}
.counts{display:flex;gap:10px;margin-top:12px}
.counts span{background:rgba(255,255,255,.18);border-radius:8px;padding:5px 12px;font-size:16px;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 32px}
.col{display:flex;flex-direction:column;gap:8px;min-width:0}
.row{display:flex;align-items:flex-start;gap:18px;background:var(--card);border:1px solid var(--line);border-left:7px solid var(--line);
border-radius:12px;padding:11px 20px 11px 16px;min-height:66px}
.body{flex:1;min-width:0}
.badge{flex:0 0 40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;margin-top:2px}
.row.pass .badge{background:var(--green)}.row.not_checked .badge{background:var(--grey)}
.row.warn{background:var(--amberbg);border-color:#E9CF98;border-left-color:var(--amber)}.row.warn .badge{background:var(--amber)}
.row.fail{background:var(--redbg);border-color:#E7B9AC;border-left-color:var(--red)}.row.fail .badge{background:var(--red)}
.row.pass{border-left-color:var(--green)}.row.not_checked{border-left-color:var(--grey)}
.body{flex:1;min-width:0}
.ttl{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.ttl h3{margin:0;font-size:22px;font-weight:700}
.row.fail h3{color:#7E2414}.row.warn h3{color:#7A4C08}
.grp{font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px;white-space:nowrap}
.flag{font-size:13px;font-weight:800;letter-spacing:1.2px;color:#fff;background:var(--red);padding:3px 9px;border-radius:6px;margin-left:10px;vertical-align:3px}
.row.warn .flag{background:var(--amber)}
.msg{font-size:var(--msg,17px);line-height:1.35;margin-top:4px;color:#3A322B;overflow-wrap:anywhere;white-space:normal}
.row.not_checked .msg,.row.not_checked h3{color:var(--muted)}
.grid3{grid-template-columns:repeat(3,1fr);gap:0 24px}
.grid3 .row{gap:14px;padding:10px 16px 10px 14px}
.grid3 .ttl{flex-wrap:wrap;gap:0 12px}.grid3 .ttl h3{font-size:20px}
.wide{margin-top:8px}
.plist{margin:6px 0 0;padding-left:20px;font-size:16px;line-height:1.38;color:#3A322B;overflow-wrap:anywhere}
.plist>li{margin:0 0 3px}
.pw{columns:2;column-gap:40px;margin:4px 0 0;padding-left:22px}
.pw li{break-inside:avoid;margin:0 0 4px}
.foot{display:flex;justify-content:space-between;color:var(--muted);font-size:14px;margin-top:18px}
.details{width:1920px;margin:0 auto;padding:10px 64px 60px}
.details h2{font-family:"Playfair Display",Georgia,serif;font-size:30px;color:var(--brown);border-top:2px solid var(--line);padding-top:26px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 22px;margin:0 0 14px}
.card h4{margin:0 0 8px;font-size:19px}.card h4 small{font-weight:500;color:var(--muted);margin-left:8px}
table{border-collapse:collapse;font-size:14px;width:100%}td,th{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{color:var(--muted);font-weight:600;width:280px}code,.mono{font-family:"JetBrains Mono",Consolas,monospace;font-size:13px;word-break:break-all}
.err{background:var(--redbg);border-left:7px solid var(--red);padding:22px 28px;border-radius:12px;font-size:22px}
"""

GLYPH = {"pass": "✓", "warn": "!", "fail": "✕", "not_checked": "–"}
WORD = {"pass": "Pass", "warn": "Warn", "fail": "Fail", "not_checked": "Not checked"}


def _v(x):
    if isinstance(x, (dict, list)):
        return f"<code>{E(json.dumps(x, ensure_ascii=False))}</code>"
    if isinstance(x, float):
        return E(f"{x:,.4g}" if abs(x) < 1e6 else f"{x:,.0f}")
    if isinstance(x, int) and not isinstance(x, bool):
        return E(f"{x:,}")
    return E(str(x))


def _row(c):
    st = c["status"]
    flag = f'<span class="flag">{"FIX" if st == "fail" else "CHECK"}</span>' if st in ("fail", "warn") else ""
    return (f'<div class="row {st}" data-check="{E(c["id"])}"><div class="badge" title="{WORD[st]}">{GLYPH[st]}</div>'
            f'<div class="body"><div class="ttl"><h3>{E(c["title"])}{flag}</h3><span class="grp">{E(c["group"])} · {WORD[st]}</span></div>'
            f'<div class="msg">{E(c["message"])}</div></div></div>')


# Rough height model of a checklist card at 1920 px, used only to choose where the checklist breaks
# into columns (order is kept). Two columns: ~92 chars per message line; three columns: ~55, and the
# group label may wrap under the title.
def _est_height(c, chars=92, extra=0):
    lines = max(1, -(-len(c["message"]) // chars))
    return max(66, 62 + extra + 23 * lines) + 8


def _split_n(checks, n, chars=92, extra=0):
    """Order-preserving split of checks into n columns minimising the tallest column."""
    h = [_est_height(c, chars, extra) for c in checks]
    m = len(checks)
    if m <= n:
        return [checks[i:i + 1] for i in range(m)]
    best = None

    def rec(start, left, cuts):
        nonlocal best
        if left == 1:
            parts = cuts + [(start, m)]
            score = (max(sum(h[a:b]) for a, b in parts), -min(b - a for a, b in parts))
            if best is None or score < best[0]:
                best = (score, parts)
            return
        for k in range(start + 1, m - left + 2):
            rec(k, left - 1, cuts + [(start, k)])
    rec(0, n, [])
    return [checks[a:b] for a, b in best[1]]


def _split(checks):
    """Index where the two-column checklist breaks (kept for callers/tests)."""
    if len(checks) < 2:
        return len(checks)
    return len(_split_n(checks, 2)[0])


def _manifest_row(c):
    """Pipeline manifest card spanning the full width: every problem as its own line, and every
    pipeline warning quoted in full (two text columns). Nothing is collapsed or shortened."""
    st = c["status"]
    meas = c.get("measured") or {}
    probs = list(meas.get("problems_fail_list") or []) + list(meas.get("problems_warn_list") or [])
    if st == "pass" or not probs:
        return _row(c).replace('class="row ', 'class="row wide ', 1)
    pw = meas.get("pipeline_warnings") or []
    lis = []
    for p in probs:
        head = f"pipeline warnings ({len(pw)}): "
        if pw and p == head + " | ".join(pw):
            lis.append(f'<li>pipeline warnings ({len(pw)}):<ol class="pw">' + "".join(f"<li>{E(w)}</li>" for w in pw) + "</ol></li>")
        else:
            lis.append(f"<li>{E(p)}</li>")
    flag = f'<span class="flag">{"FIX" if st == "fail" else "CHECK"}</span>'
    return (f'<div class="row wide {st}" data-check="{E(c["id"])}"><div class="badge" title="{WORD[st]}">{GLYPH[st]}</div>'
            f'<div class="body"><div class="ttl"><h3>{E(c["title"])}{flag}</h3><span class="grp">{E(c["group"])} · {WORD[st]}</span></div>'
            f'<ul class="plist">{"".join(lis)}</ul></div></div>')


def _kv(d):
    if not d:
        return ""
    return "<table>" + "".join(f"<tr><th>{E(str(k))}</th><td>{_v(v)}</td></tr>" for k, v in d.items()) + "</table>"


def _items(items, total):
    if not items:
        return ""
    keys = []
    for it in items:
        for k in it:
            if k not in keys:
                keys.append(k)
    head = "".join(f"<th style='width:auto'>{E(k)}</th>" for k in keys)
    rows = "".join("<tr>" + "".join(f"<td>{_v(it.get(k, ''))}</td>" for k in keys) + "</tr>" for it in items)
    more = f"<p class='meta'>Showing {len(items)} of {total}.</p>" if total > len(items) else ""
    return f"<table style='margin-top:10px'><tr>{head}</tr>{rows}</table>{more}"


def render_html(rep: dict) -> str:
    a = rep["asset"]
    prof = rep["profile"]
    tags = []
    if a.get("synthetic_fixture"):
        tags.append('<span class="tag solid">SYNTHETIC TEST ASSET</span>')
    tags.append(f'<span class="tag">Profile: {E(prof.get("name") or "n/a")}</span>')
    st = rep["overall_status"]
    stats = rep.get("asset_stats") or {}
    sha = (a.get("sha256") or "")[:12]
    meta = (f'<b>{E((a.get("format") or "").upper())}</b> · {_v(stats.get("triangles_total", 0))} triangles · '
            f'{len(stats.get("meshes", []))} mesh(es) · sha256 <span class="mono">{E(sha)}…</span> · checked {E(rep.get("generated_at_display", ""))}')
    man = rep.get("manifest")
    if man:
        meta += f' · manifest <b>{E(os.path.basename(man.get("path") or ""))}</b>' + (f' ({E(man["asset_name"])})' if man.get("asset_name") else "")
    if st == "error":
        verdict = f'<div class="verdict error"><div class="big">Could not check</div><div class="sub">{E(rep["error"]["type"])}</div></div>'
        body = f'<div class="err">{E(rep["error"]["message"])}</div>'
        details = ""
    else:
        s = rep["summary"]
        n = s["flagged"]
        if st == "pass":
            big = "All checks passed" if s["not_checked"] == 0 else "No items flagged"
            sub = "Ready to import" + (f" · {s['not_checked']} item(s) could not be checked for this format" if s["not_checked"] else "")
        else:
            big = f"{n} item{'s' if n != 1 else ''} flagged"
            sub = "Fix before import" if s["fail"] else "Review before import"
        counts = "".join(f"<span>{s[k]} {WORD[k].lower()}</span>" for k in ("pass", "warn", "fail", "not_checked"))
        verdict = f'<div class="verdict {st}"><div class="big">{E(big)}</div><div class="sub">{E(sub)}</div><div class="counts">{counts}</div></div>'
        checks = rep["checks"]
        man_checks = [c for c in checks if c["id"] == "manifest"]
        rest = [c for c in checks if c["id"] != "manifest"]
        if man_checks:
            # manifest reports: 15 checks in three columns, the manifest card full width underneath
            cols = _split_n(rest, 3, chars=55, extra=18)
            body = ('<div class="grid grid3">' + "".join('<div class="col">' + "".join(_row(c) for c in col) + "</div>" for col in cols)
                    + "</div>" + "".join(_manifest_row(c) for c in man_checks))
        else:
            half = _split(checks)
            body = ('<div class="grid"><div class="col">' + "".join(_row(c) for c in checks[:half]) +
                    '</div><div class="col">' + "".join(_row(c) for c in checks[half:]) + "</div></div>")
        cards = []
        for c in checks:
            cards.append(f'<div class="card"><h4>{E(c["title"])}<small>{WORD[c["status"]]} · id <code>{E(c["id"])}</code></small></h4>'
                         f'<div class="msg" style="margin-bottom:8px">{E(c["message"])}</div>'
                         f'{_kv({"measured · " + k: v for k, v in c["measured"].items()})}{_kv({"expected · " + k: v for k, v in c["expected"].items()})}'
                         f'{_items(c["items"], c["items_total"])}</div>')
        mesh_rows = [{"mesh": m["name"], "lod": m["lod"], "triangles": m["triangles"], "vertices": m["vertices"], "skinned": m["skinned"],
                      "uv0": m["has_uv0"], "normals": m["has_normals"]} for m in stats.get("meshes", [])]
        files = a.get("referenced_files") or []
        details = (f'<section class="details"><h2>Measured details</h2>{"".join(cards)}'
                   f'<div class="card"><h4>Meshes</h4>{_items(mesh_rows, len(mesh_rows))}</div>'
                   f'<div class="card"><h4>Referenced files</h4>{_items(files, len(files)) or "<p class=meta>None</p>"}</div>'
                   f'<div class="card"><h4>Run</h4>{_kv({"asset path": a["path"], "manifest": (man or {}).get("path"), "asset sha256": a.get("sha256"), "profile path": prof.get("path"), "profile sha256": prof.get("sha256"), "generated (UTC)": rep["generated_at"], "tool": rep["tool"]["name"] + " " + rep["tool"]["version"], "notes": rep.get("notes")})}</div></section>')
    foot = (f'<div class="foot"><span>SculptLine pre-import check v{E(rep["tool"]["version"])} · every value on this page was measured from the file in this run</span>'
            f'<span>Full measurements below ↓</span></div>')
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pre-import check · {E(a["file_name"] or "(no asset)")}</title>'
            f'<meta name="viewport" content="width=1920"><style>{CSS}</style></head><body><div class="page">'
            f'<div class="top"><div class="brand">SculptLine<span>Pre-import check</span></div><div class="tags">{"".join(tags)}</div></div>'
            f'<div class="hero"><div class="asset"><div class="lbl">Asset</div><h1>{E(a["file_name"] or "(no asset)")}</h1><div class="meta">{meta}</div></div>{verdict}</div>'
            f'{body}{foot}</div>{details}</body></html>')
