"""임시: SV리그 공식 사이트 구단·선수 페이지 구조 확인용 (확인 후 삭제)"""
import os, re, json, requests
from urllib.parse import urljoin
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Accept-Language": "ja"}
D = "data/_debug/probe"; os.makedirs(D, exist_ok=True)
for f in os.listdir(D): os.remove(os.path.join(D, f))
log = {}
def get(u, name):
    r = requests.get(u, headers=H, timeout=25)
    open(f"{D}/{name}.html", "w", encoding="utf-8").write(r.text)
    nf = "Not Found" in r.text[:20000] and "requested URL was not found" in r.text
    log[name] = [u, r.status_code, r.url, len(r.text), "NOTFOUND" if nf else ""]
    return r.text, r.url
home, hu = get("https://www.svleague.jp/", "home")
links = sorted(set(urljoin(hu, h) for h in re.findall(r'href="([^"#]+)"', home)))
log["home_links"] = [l for l in links if re.search(r"team|player|club|member|roster", l, re.I)]
cand = [l for l in log["home_links"] if "svleague.jp" in l and ("men" in l.lower()) and "women" not in l.lower()][:4]
for i, l in enumerate(cand):
    try:
        t, u = get(l, f"lvl1_{i}")
        sub = sorted(set(urljoin(u, h) for h in re.findall(r'href="([^"#]+)"', t)))
        log[f"lvl1_{i}_links"] = [x for x in sub if re.search(r"team|player", x, re.I)][:80]
    except Exception as e:
        log[f"lvl1_{i}"] = str(e)
# 선수 링크가 보이면 하나, 구단 상세 링크가 보이면 하나 받아 둠
allsub = [x for k, v in log.items() if k.endswith("_links") for x in v]
for key, pat in (("team_page", r"team/(detail/)?\d+|team/\w+/?$"), ("player_page", r"player/(detail/)?\d+")):
    m = next((x for x in allsub if re.search(pat, x) and "women" not in x.lower()), None)
    if m:
        try:
            t, u = get(m, key)
            log[key + "_links"] = sorted(set(urljoin(u, h) for h in re.findall(r'href="([^"#]+)"', t) if re.search(r"player", h)))[:60]
            log[key + "_imgs"] = re.findall(r'<img[^>]+>', t)[:80]
        except Exception as e:
            log[key] = str(e)
json.dump(log, open(f"{D}/log.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in log.items() if not k.endswith("imgs")}, ensure_ascii=False, indent=1)[:3000])
