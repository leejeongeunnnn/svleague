"""임시: SV리그 공식 사이트 구단·선수 페이지 구조 확인용 (확인 후 삭제)"""
import os, re, requests
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36", "Accept-Language": "ja"}
os.makedirs("data/_debug/probe", exist_ok=True)
urls = {
 "team_ja": "https://www.svleague.jp/ja/sv_men/team/detail/252",
 "team_en": "https://www.svleague.jp/en/sv_men/team/detail/252",
 "player_ja": "https://www.svleague.jp/ja/sv_men/player/detail/3907",
 "teamlist": "https://www.svleague.jp/ja/sv_men/team/list",
}
for k, u in urls.items():
    try:
        r = requests.get(u, headers=H, timeout=25, allow_redirects=True)
        print(k, r.status_code, r.url, len(r.text))
        open(f"data/_debug/probe/{k}.html", "w", encoding="utf-8").write(r.text)
    except Exception as e:
        print(k, "ERR", e)
