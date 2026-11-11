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
    log[name] = [u, r.status_code, r.url, len(r.text)]
    return r.text
t = get("https://www.svleague.jp/team/sv/men/", "men")
slugs = sorted(set(re.findall(r'href="/team/([a-z0-9_]+)/"', t)) - {"sv", "svg"})
log["slugs"] = slugs
for s in slugs[:2]:
    p = get(f"https://www.svleague.jp/team/{s}/player/", f"player_{s}")
    log[f"imgs_{s}"] = [x for x in re.findall(r"<img[^>]+>", p) if "partners" not in x and "banner" not in x][:40]
    log[f"links_{s}"] = sorted(set(re.findall(r'href="([^"]*player[^"]*)"', p)))[:40]
    m = next((x for x in log[f"links_{s}"] if re.search(r"\d", x)), None)
    if m:
        q = get(urljoin("https://www.svleague.jp/", m), f"detail_{s}")
        log[f"detail_imgs_{s}"] = [x for x in re.findall(r"<img[^>]+>", q) if "partners" not in x and "banner" not in x][:20]
json.dump(log, open(f"{D}/log.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
