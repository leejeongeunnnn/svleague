"""임시: 공식 경기 페이지에서 문자중계(LiveScore) 출처 찾기 (확인 후 삭제)"""
import os, re, json, requests
from urllib.parse import urljoin
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Accept-Language": "ja"}
D = "data/_debug/probe"; os.makedirs(D, exist_ok=True)
log = {}
def get(u, name):
    try:
        r = requests.get(u, headers=H, timeout=25)
        open(f"{D}/{name}.html", "w", encoding="utf-8").write(r.text[:400000])
        log[name] = [u, r.status_code, r.url, len(r.text), r.headers.get("content-type")]
        return r.text, r.url
    except Exception as e:
        log[name] = [u, str(e)]; return "", u
t, u = get("https://www.svleague.jp/match/detail/37992/", "match")
links = sorted(set(urljoin(u, h) for h in re.findall(r'(?:href|src)="([^"#]+)"', t)))
log["match_links"] = [l for l in links if not re.search(r"/img/|partners|banner|\.css|jquery", l)]
log["match_scripts"] = re.findall(r"<script[^>]*>(.{0,400})", t, re.S)[:20]
cand = [l for l in log["match_links"] if re.search(r"live|score|report|stat|volleystation|pdf|form|relay|rally", l, re.I)]
log["cand"] = cand
for i, l in enumerate(cand[:6]):
    tt, uu = get(l, f"c{i}")
    log[f"c{i}_links"] = sorted(set(urljoin(uu, h) for h in re.findall(r'(?:href|src)="([^"#]+)"', tt)))[:60]
    log[f"c{i}_api"] = sorted(set(re.findall(r'https?://[^"\'\s<>]+(?:api|json|socket|ws)[^"\'\s<>]*', tt)))[:30]
json.dump(log, open(f"{D}/live_log.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
