"""
일본 SV리그 남자부(大同生命SV.LEAGUE MEN) 데이터 수집기 — GitHub Actions에서 실행

  data/schedule.json       시즌 전체 경기 (정규리그·챔피언십) + 세트 점수
  data/news.json           최근 SV리그 남자 기사 (Google 뉴스, 일본어·한국어)
  data/meta.json           갱신 시각·수집 상태
  data/collect_state.json  날짜별로 마지막으로 확인한 시각 (요청 수를 줄이려고)
  data/_debug/*            받은 페이지 원본·파싱 결과 (수집이 깨지면 이걸 보고 고침)

일정·결과 출처: 스포츠나비(Yahoo! JAPAN) 배구 일정 페이지. 날짜별로 한 페이지씩 받는다.
  https://sports.yahoo.co.jp/volley/game/7219?league=7280&date=YYYY-MM-DD
순위는 사이트(app.js)가 경기 결과로 직접 집계한다 → 일정만 제대로 받으면 순위도 맞음.

원칙: 수집에 실패하면 기존 파일을 지우지 않고 그대로 둔다.
"""
import argparse
import html as html_mod
import json
import os
import re
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import quote

try:
    import requests
except ImportError:  # 자체 점검(--selftest)·시드 생성은 requests 없이도 돌아가게
    requests = None

KST = timezone(timedelta(hours=9))  # 일본도 같은 시간대(UTC+9)
ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
DEBUG = os.path.join(DATA, "_debug")

# ---- 시즌 설정 (다음 시즌엔 여기만 바꾸면 됨) ----
SEASON = os.environ.get("SV_SEASON", "2026-27")
REG_START = date(2026, 10, 17)
REG_END = date(2027, 4, 18)
CS_START = date(2027, 4, 23)     # 챔피언십: 쿼터파이널 → 세미파이널 → 파이널
CS_END = date(2027, 5, 9)
SN_URL = "https://sports.yahoo.co.jp/volley/game/7219"
SN_LEAGUE = "7280"               # 스포츠나비의 SV리그 남자 번호 (시즌이 바뀌면 달라질 수 있음)
FUTURE_BUDGET = 12               # 한 번 실행할 때 '앞으로의 날짜'를 몇 개까지 다시 확인할지
FUTURE_EVERY_H = 20              # 앞으로의 날짜는 이 시간마다 한 번만 다시 확인

# 팀: 한글 표시 이름, 영문 키, 일본어 약칭·정식 명칭
TEAM_DEF = [
    ("산토리", "suntory", ["サントリー", "サントリーサンバーズ大阪", "サントリーサンバーズ"]),
    ("오사카B", "osakab", ["大阪B", "大阪ブルテオン", "ブルテオン"]),
    ("스팅스아이치", "stings", ["STINGS愛知", "ジェイテクトSTINGS愛知", "ジェイテクト"]),
    ("WD나고야", "wdnagoya", ["WD名古屋", "ウルフドッグス名古屋", "ウルフドッグス"]),
    ("도쿄GB", "tokyogb", ["東京GB", "東京グレートベアーズ", "グレートベアーズ"]),
    ("히로시마", "hiroshima", ["広島TH", "広島サンダーズ"]),
    ("사카이", "sakai", ["日鉄堺BZ", "日本製鉄堺ブレイザーズ", "堺ブレイザーズ"]),
    ("도레이", "toray", ["東レ静岡", "東レアローズ静岡", "東レアローズ"]),
    ("보레아스", "voreas", ["ヴォレアス", "ヴォレアス北海道"]),
    ("마쓰모토", "matsumoto", ["松本TD", "信州松本トライデンツ", "トライデンツ"]),
    ("홋카이도YS", "hokkaidoys", ["北海道YS", "北海道イエロースターズ", "イエロースターズ"]),
    ("가고시마", "kagoshima", ["F鹿児島", "フラーゴラッド鹿児島", "フラーゴラッド"]),
]
TEAMS = [t[0] for t in TEAM_DEF]
TEAM_KEY = {t[0]: t[1] for t in TEAM_DEF}


def norm(s):
    """전각 문자(大阪Ｂ, ：, （）)를 반각으로, 여러 가지 줄표를 '-' 로 맞춘다."""
    s = unicodedata.normalize("NFKC", s or "")
    return re.sub(r"(?<=\d)\s*[‐‑‒–—―−]\s*(?=\d)", "-", s)


ALIAS = {}
for _kr, _key, _names in TEAM_DEF:
    for _n in _names:
        ALIAS[norm(_n)] = _kr
TEAM_RE = re.compile("|".join(re.escape(a) for a in sorted(ALIAS, key=len, reverse=True)))

# 경기장 이름 (일본어 → 한글). 없는 경기장은 일본어 그대로 나온다.
VENUE_KR = {
    "有明コロシアム": "아리아케 콜로세움", "Asueアリーナ大阪": "아스에 아레나 오사카", "北ガスアリーナ札幌": "기타가스 아레나 삿포로46",
    "ジェイテクトアリーナ奈良": "제이텍트 아레나 나라", "大浜だいしんアリーナ": "오하마 다이신 아레나", "エントリオ": "엔트리오",
    "エア・ウォーターアリーナ松本": "에어워터 아레나 마쓰모토", "旭川体育館": "릭&수 아사히카와 체육관", "おおきにアリーナ舞洲": "오키니 아레나 마이시마",
    "このはなアリーナ": "고노하나 아레나", "ユピテルアリーナ霧島": "유피테루 아레나 기리시마", "広島グリーンアリーナ": "히로시마 그린 아레나",
    "香陵アリーナ": "고료 아레나", "ANCアリーナ": "ANC 아레나", "日本製鉄堺体育館": "닛폰제철 사카이 체육관",
    "HAPPINESS ARENA": "해피니스 아레나", "代々木競技場第二体育館": "요요기 제2체육관", "代々木競技場第一体育館": "요요기 제1체육관",
    "パナソニックアリーナ": "파나소닉 아레나", "Fアリーナいちき串木野": "F아레나 이치키쿠시키노", "CNAアリーナ": "CNA 아레나 아키타",
    "北海きたえーる": "홋카이 키타에루", "広島サンプラザホール": "히로시마 선플라자 홀", "和歌山ビッグホエール": "와카야마 빅웨일",
    "北里アリーナ富士": "기타사토 아레나 후지", "岡崎中央総合公園": "오카자키 중앙공원 체육관", "エフピコアリーナふくやま": "에프피코 아레나 후쿠야마",
    "GLION ARENA KOBE": "글리온 아레나 고베", "金岡公園体育館": "가나오카 공원 체육관", "北九州市立総合体育館": "기타큐슈 종합체육관",
    "フアマーク": "후아막 인도어 스타디움 (방콕)", "TOYOTA ARENA TOKYO": "도요타 아레나 도쿄", "LaLa arena TOKYO-BAY": "라라 아레나 도쿄베이",
    "沖縄サントリーアリーナ": "오키나와 산토리 아레나", "島津アリーナ京都": "시마즈 아레나 교토", "東京体育館": "도쿄 체육관",
    "函館": "하코다테 아레나", "実総アリーナ": "짓소 아레나", "IGアリーナ": "IG 아레나 (나고야)", "横浜アリーナ": "요코하마 아레나",
    "有明アリーナ": "아리아케 아레나", "調整中": "",
}
_VENUE = sorted(((re.sub(r"\s+", "", norm(k)), v) for k, v in VENUE_KR.items()), key=lambda x: -len(x[0]))

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "ja,en;q=0.8,ko;q=0.6",
}
STATUS = {}  # meta.json 에 남길 수집 상태


def now_kst():
    return datetime.now(KST)


def load(name, default=None):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def save(name, obj):
    """내용이 바뀌었을 때만 저장. 바뀌었으면 True."""
    path = os.path.join(DATA, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    new = json.dumps(obj, ensure_ascii=False, indent=1)
    try:
        with open(path, encoding="utf-8") as f:
            if f.read() == new:
                return False
    except FileNotFoundError:
        pass
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    return True


def debug_write(name, text):
    try:
        os.makedirs(DEBUG, exist_ok=True)
        with open(os.path.join(DEBUG, name), "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        pass


def get_text(url, tries=3):
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 200:
                r.encoding = r.apparent_encoding if (r.encoding or "").lower() in ("iso-8859-1", "") else r.encoding
                return r.text
            last = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(last)


# ---------------------------------------------------------------- 팀·경기 분류
def team_kr(name):
    n = norm(name).replace(" ", "")
    if n in ALIAS:
        return ALIAS[n]
    m = TEAM_RE.search(n)
    return ALIAS[m.group(0)] if m else (name or "")


def venue_kr(v):
    n = re.sub(r"\s+", "", norm(v))
    if not n:
        return ""
    for k, kr in _VENUE:
        if k in n:
            return kr
    return v.strip()


def classify(d, stage=""):
    """경기 종류(kind)와 표시용 시리즈 이름."""
    st = norm(stage)
    if "クォーターファイナル" in st or "準々決勝" in st:
        return "cs", "쿼터파이널"
    if "セミファイナル" in st or "準決勝" in st:
        return "cs", "세미파이널"
    if "ファイナル" in st or "決勝" in st:
        return "cs", "파이널"
    if "チャンピオンシップ" in st or d > REG_END:
        return "cs", "챔피언십"
    return "regular", ""


def make_game(dstr, tm, rnd, venue, home, away, state="scheduled", sets=None, oid="", stage="", sh=None, sa=None, status=""):
    """수집한 값 하나를 사이트가 쓰는 경기 한 건으로 만든다. home/away 는 일본어 이름이어도 된다."""
    d = date.fromisoformat(dstr)
    home, away = team_kr(home), team_kr(away)
    kind, series = classify(d, stage)
    g = {
        "gid": f"sv{oid}" if oid else f"{dstr.replace('-', '')}-{TEAM_KEY.get(home, 'x')}-{TEAM_KEY.get(away, 'x')}",
        "date": dstr, "time": tm or "", "kind": kind, "series": series,
        "home": home, "away": away, "venue": venue_kr(venue), "state": state,
        "status": status or {"final": "경기 종료", "cancel": "취소·연기"}.get(state, ""),
    }
    try:
        g["round"] = int(rnd)
    except (TypeError, ValueError):
        pass
    if oid:
        g["url"] = f"https://www.svleague.jp/match/detail/{oid}/"
        if state == "scheduled":
            g["ticket"] = f"https://ticket-v.jp/ticket/?id={oid}"
    if sets:
        g["sets"] = sets
    if state in ("final", "live"):
        if sets and state == "final":
            sh = sum(1 for s in sets if s[0] > s[1])
            sa = sum(1 for s in sets if s[1] > s[0])
        if sh is not None and sa is not None:
            g["sh"], g["sa"] = sh, sa
    return g


# ---------------------------------------------------------------- 스포츠나비 페이지 읽기
class _Flat(HTMLParser):
    """HTML → 한 줄 글자. 링크 주소는 ⟦주소⟧ 로 끼워 둔다. (태그 구조가 바뀌어도 글자 순서만 같으면 읽힘)"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        elif tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.out.append(f" ⟦{href}⟧ ")
        elif tag == "img":
            self.out.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self.skip:
            self.skip -= 1

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data + " ")


def flatten(page):
    p = _Flat()
    p.feed(page)
    return re.sub(r"\s+", " ", norm("".join(p.out)))


DATE_RE = re.compile(r"(?<!\d)(\d{1,2})/(\d{1,2})\s*\((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|[月火水木金土日])[^)]{0,6}\)")
PAIR_RE = re.compile(r"(?<![\d:/])(\d{1,2})\s*-\s*(\d{1,2})(?![\d:/])")
HREF_RE = re.compile(r"⟦(.*?)⟧")


def season_year(month):
    y = REG_START.year
    return y if month >= 8 else y + 1


def set_done(pair, idx):
    hi, lo = max(pair), min(pair)
    return hi >= (15 if idx == 4 else 25) and hi - lo >= 2


def parse_day(page):
    """스포츠나비 날짜 페이지 → 경기 목록.
    한 경기의 글자 순서 (2026-11 확인):
      끝난 경기  '11/8(Sun) 13:35 レギュラーシーズン 第3節 エントリオ WD名古屋 3 26 - 24 22 - 25 26 - 24 27 - 25 1 試合終了 外部サイト STINGS愛知'
      예정 경기  '11/14(Sat) 13:05 レギュラーシーズン 第4節 おおきにアリーナ舞洲 チケット購入 外部サイト サントリー 試合前 外部サイト STINGS愛知'
    먼저 나오는 팀이 홈. '試合前/試合終了' 링크가 SV리그 공식 경기 페이지(…/match/detail/번호/)."""
    flat = flatten(page)
    marks = list(DATE_RE.finditer(flat))
    games, seen = [], set()
    for i, m in enumerate(marks):
        end = marks[i + 1].start() if i + 1 < len(marks) else min(len(flat), m.end() + 1500)
        block = flat[m.end():end]
        hrefs = HREF_RE.findall(block)
        text = HREF_RE.sub(" ", block)
        hits = [(t.start(), t.end(), ALIAS[t.group(0)]) for t in TEAM_RE.finditer(text)]
        if not hits:
            continue
        home = hits[0]
        away = next((h for h in hits[1:] if h[2] != home[2]), None)
        if not away:
            continue
        head, mid = text[:home[0]], text[home[1]:away[0]]
        month, day = int(m.group(1)), int(m.group(2))
        try:
            dstr = date(season_year(month), month, day).isoformat()
        except ValueError:
            continue
        tmm = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)", head)
        tm = f"{int(tmm.group(1)):02d}:{tmm.group(2)}" if tmm else ""
        if tm in ("23:59", "00:00"):
            tm = ""  # 시간 미정
        rm = re.search(r"第\s*(\d+)\s*節", head)
        vstart = rm.end() if rm else (tmm.end() if tmm else 0)
        venue = re.sub(r"チケット購入|外部サイト|レギュラーシーズン|GAME\s*\d", " ", head[vstart:]).strip()
        if len(venue) > 45:
            venue = ""
        pairs = [[int(a), int(b)] for a, b in PAIR_RE.findall(mid) if int(a) or int(b)]
        rest = re.sub(r"第\s*\d\s*セット", " ", PAIR_RE.sub(" ", mid))
        nums = [int(x) for x in re.findall(r"(?<![\d:])\d(?![\d:])", rest)]
        sh = sa = None
        status = ""
        if "試合終了" in mid:
            state = "final"
            pairs = [p for p in pairs if max(p) >= 15]
            if not pairs and len(nums) >= 2:
                sh, sa = nums[0], nums[-1]
        elif re.search(r"中止|延期|ノーゲーム", mid):
            state = "cancel"
            status = "연기" if "延期" in mid else "취소"
        elif "試合前" in mid or not (pairs or re.search(r"試合中|セット|LIVE|速報", mid)):
            state, pairs = "scheduled", []
        else:
            state = "live"
            if len(nums) >= 2:
                sh, sa = nums[0], nums[-1]
            else:
                done = [p for k, p in enumerate(pairs) if k < len(pairs) - 1 or set_done(p, k)]
                sh = sum(1 for p in done if p[0] > p[1])
                sa = sum(1 for p in done if p[1] > p[0])
            status = f"{len(pairs)}세트 진행 중" if pairs else "경기 중"
        oid = next((x.group(1) for h in hrefs for x in [re.search(r"svleague\.jp/match/detail/(\d+)", h)] if x), "")
        g = make_game(dstr, tm, rm.group(1) if rm else None, venue, home[2], away[2], state=state,
                      sets=pairs or None, oid=oid, stage=head, sh=sh, sa=sa, status=status)
        if state == "final" and max(g.get("sh") or 0, g.get("sa") or 0) != 3:
            g["warn"] = "세트 수가 맞지 않음 — 페이지 구조 확인 필요"
        key = (g["date"], g["home"], g["away"])
        if key not in seen:
            seen.add(key)
            games.append(g)
    return games


def discover_dates(page):
    """페이지 안의 날짜 이동 링크에서 SV리그 남자 경기일을 모은다 (챔피언십 날짜가 새로 생기면 여기서 잡힘)."""
    page = html_mod.unescape(page)
    found = set(re.findall(rf"league={SN_LEAGUE}&date=(\d{{4}}-\d{{2}}-\d{{2}})", page))
    found |= set(re.findall(rf"date=(\d{{4}}-\d{{2}}-\d{{2}})&league={SN_LEAGUE}", page))
    lo, hi = (REG_START - timedelta(days=7)).isoformat(), (CS_END + timedelta(days=21)).isoformat()
    return {d for d in found if lo <= d <= hi}


def fetch_day(dstr):
    return get_text(f"{SN_URL}?league={SN_LEAGUE}&date={dstr}")


def merge_day(old_games, new_games):
    """같은 날짜의 예전 기록에서 이어받을 것(공식 ID, 끝난 경기의 세트 점수)을 챙긴다."""
    old = {(g["home"], g["away"]): g for g in old_games}
    out = []
    for g in new_games:
        prev = old.get((g["home"], g["away"]))
        if prev:
            if not g["gid"].startswith("sv") and prev["gid"].startswith("sv"):
                g["gid"] = prev["gid"]
                for k in ("url", "ticket"):
                    if prev.get(k) and (k != "ticket" or g["state"] == "scheduled"):
                        g[k] = prev[k]
            if g["state"] == "final" and not g.get("sets") and prev.get("state") == "final" and prev.get("sets"):
                g["sets"] = prev["sets"]
            if not g["venue"] and prev.get("venue"):
                g["venue"] = prev["venue"]
            if "round" not in g and "round" in prev:
                g["round"] = prev["round"]
        out.append(g)
    return out


def collect_schedule():
    old = load("schedule.json", {}) or {}
    games = list(old.get("games", []))
    state = load("collect_state.json", {}) or {}
    checked = state.get("checked", {})
    now = now_kst()
    today = now.date()
    by_date = {}
    for g in games:
        by_date.setdefault(g["date"], []).append(g)

    known = set(by_date)
    try:
        first = fetch_day(today.isoformat())
        known |= discover_dates(first)
    except Exception as e:  # noqa: BLE001
        STATUS["schedule"] = f"실패 — 기존 일정 유지: {str(e)[:160]}"
        print("[ERROR] 일정 수집 실패:", e)
        return False
    debug_write("sportsnavi_today.html", first)

    def age_h(d):
        try:
            return (now - datetime.fromisoformat(checked[d])).total_seconds() / 3600
        except Exception:
            return 1e9

    near, unfinished, future = [], [], []
    for d in sorted(known):
        dd = date.fromisoformat(d)
        gs = by_date.get(d, [])
        if today - timedelta(days=2) <= dd <= today + timedelta(days=1):
            near.append(d)
        elif dd < today and (not gs or any(g["state"] not in ("final", "cancel") for g in gs)):
            unfinished.append(d)
        elif dd > today and age_h(d) >= FUTURE_EVERY_H:
            future.append(d)
    future.sort(key=lambda d: (age_h(d) < 1e9, d))  # 한 번도 확인 안 한 날짜 먼저, 그다음 가까운 날짜부터
    plan = near + unfinished[:FUTURE_BUDGET] + future[:FUTURE_BUDGET]

    report, errors, got = {}, [], 0
    for d in plan:
        try:
            page = first if d == today.isoformat() else fetch_day(d)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{d}: {e}")
            continue
        parsed = [g for g in parse_day(page) if g["date"] == d]
        report[d] = len(parsed)
        checked[d] = now.isoformat(timespec="minutes")
        if parsed:
            by_date[d] = merge_day(by_date.get(d, []), parsed)
            got += 1
        elif DATE_RE.search(flatten(page)) and by_date.get(d):
            errors.append(f"{d}: 경기 0건 (페이지 구조가 바뀌었을 수 있음)")
            debug_write(f"sportsnavi_{d}.html", page)
        if d != today.isoformat():
            time.sleep(0.8)  # 상대 서버에 부담 주지 않게 천천히

    debug_write("parse_report.json", json.dumps({"at": now.isoformat(timespec="minutes"), "plan": plan, "parsed": report,
                                                  "errors": errors}, ensure_ascii=False, indent=1))
    save("collect_state.json", {"checked": {d: checked[d] for d in sorted(checked) if d in known}})

    merged = sorted((g for gs in by_date.values() for g in gs), key=lambda g: (g["date"], g["time"] or "99", g["home"]))
    final = sum(1 for g in merged if g["state"] == "final")
    warn = sum(1 for g in merged if g.get("warn"))
    if not got and plan:
        STATUS["schedule"] = "실패 — 기존 일정 유지: " + (errors[0][:160] if errors else "읽은 경기 없음")
        print("[ERROR]", STATUS["schedule"], errors)
        return False
    STATUS["schedule"] = (f"성공 {len(merged)}경기 (종료 {final}) · 이번에 확인한 날짜 {len(report)}개"
                          + (f" · 일부 실패 {len(errors)}" if errors else "") + (f" · 확인 필요 {warn}" if warn else ""))
    print("[OK]", STATUS["schedule"], report)
    out = {"source": "스포츠나비 (Yahoo! JAPAN) 배구 일정", "games": merged}
    if old.get("_seed") and not got:
        out["_seed"] = True
    return save("schedule.json", out)


# ---------------------------------------------------------------- 뉴스
def detect_teams(text):
    t = norm(text).replace(" ", "")
    hits = []
    for m in TEAM_RE.finditer(t):
        kr = ALIAS[m.group(0)]
        if kr not in hits:
            hits.append(kr)
    kr_names = {"산토리": ["산토리"], "오사카B": ["블루테온"], "스팅스아이치": ["스팅스", "제이텍트"], "WD나고야": ["울프독스"],
                "도쿄GB": ["그레이트베어스", "그레이트 베어스"], "히로시마": ["히로시마 썬더스", "히로시마 선더스"], "사카이": ["사카이 블레이저스"],
                "도레이": ["도레이 애로우즈", "도레이 애로즈"], "보레아스": ["보레아스"], "마쓰모토": ["트라이던츠"],
                "홋카이도YS": ["옐로스타즈", "옐로우 스타즈"], "가고시마": ["프라골라드"]}
    for kr, keys in kr_names.items():
        if kr not in hits and any(k in text for k in keys):
            hits.append(kr)
    return hits


LEAGUE = re.compile(r"SVリーグ|SV\.LEAGUE|SV男子|SVリーグ男子|SV리그|일본\s*배구|일본\s*프로배구", re.I)
NOISE = re.compile(r"チケット転売|占い|ハイキュー|춘계|고교|\bvs\.?\s.*公式サイト|試合詳細")  # 공식 사이트의 경기 페이지는 기사가 아님
WOMEN = re.compile(r"女子|WOMEN|SV女子|여자부|여자배구|NEC川崎|久光|マーヴェラス|デンソー|PFU|埼玉上尾|ヴィクトリーナ|岡山シーガルズ|"
                   r"クインシーズ|アランマーレ|KUROBE|群馬グリーンウイングス|東レ滋賀|Astemo|アルテミス北海道|アリーザ")


def collect_news(limit=40):
    queries = [("SVリーグ 男子 when:2d", "ja"), ("SV.LEAGUE MEN when:2d", "ja"), ("バレーボール SVリーグ when:2d", "ja"),
               ("일본 SV리그 배구 when:7d", "ko"), ("SV리그 남자배구 when:7d", "ko")]
    items, seen, ok = [], set(), 0
    for q, lang in queries:
        loc = "hl=ja&gl=JP&ceid=JP:ja" if lang == "ja" else "hl=ko&gl=KR&ceid=KR:ko"
        url = f"https://news.google.com/rss/search?q={quote(q)}&{loc}"
        try:
            r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, timeout=10)
            r.raise_for_status()
            root = ET.fromstring(r.content)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print("[WARN] news", q, e)
            continue
        for it in root.iter("item"):
            title = (it.findtext("title") or "").strip()
            src = (it.findtext("source") or "").strip()
            if src and title.endswith(" - " + src):
                title = title[: -len(" - " + src)]
            key = re.sub(r"\W", "", title)[:40]
            if not title or key in seen:
                continue
            teams = detect_teams(title)
            if NOISE.search(title) or (WOMEN.search(title) and not teams and "男子" not in title):
                continue  # 여자부 기사 제외
            if not teams and not LEAGUE.search(title):
                continue  # 구단 이름도 SV리그 언급도 없으면 다른 배구 기사
            seen.add(key)
            pub = it.findtext("pubDate") or ""
            try:
                dt = datetime.strptime(pub, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc).astimezone(KST)
            except Exception:
                dt = None
            items.append({"title": title, "link": it.findtext("link") or "", "source": src, "lang": lang,
                          "time": dt.strftime("%m/%d %H:%M") if dt else "", "ts": dt.timestamp() if dt else 0,
                          "teams": teams})
    if not ok:
        STATUS["news"] = "실패 — 기존 기사 유지"
        return False
    items.sort(key=lambda x: -x["ts"])
    now_ts = now_kst().timestamp()
    items = [i for i in items if not i["ts"] or i["ts"] >= now_ts - (8 if i["lang"] == "ko" else 3) * 86400][:limit]
    STATUS["news"] = f"성공 {len(items)}건"
    return save("news.json", {"items": items})



# ---------------------------------------------------------------- 선수단 · 사진 (SV리그 공식 사이트)
SV_SITE = "https://www.svleague.jp"
SLUG_KR = {"suntory": "산토리", "osakab": "오사카B", "stingsaichi": "스팅스아이치", "wdnagoya": "WD나고야", "tokyogb": "도쿄GB",
           "hiroshima": "히로시마", "sakai": "사카이", "trshizuoka": "도레이", "voreas": "보레아스", "matsumototd": "마쓰모토",
           "hokkaidoys": "홋카이도YS", "fkagoshima": "가고시마"}
POS_EN = {"setter": "S", "outside hitter": "OH", "opposite hitter": "OP", "opposite": "OP", "middle blocker": "MB", "libero": "L"}


def _txt(x):
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", x or ""))).strip()


def save_photo(url, code, max_w=260):
    """사진을 data/photos/<번호>.webp 로 저장 (이미 있으면 그대로). 사이트 기준 경로를 돌려준다."""
    rel = f"data/photos/{code}.webp"
    path = os.path.join(ROOT, rel)
    if os.path.exists(path) and os.path.getsize(path) > 500:
        return rel
    try:
        r = requests.get(url, headers={**HEADERS, "Referer": SV_SITE + "/"}, timeout=20)
        if r.status_code != 200 or len(r.content) < 500 or not r.headers.get("content-type", "").startswith("image"):
            return None
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(r.content))
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if im.width > max_w:
            im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        im.save(path, "WEBP", quality=80, method=4)
        return rel
    except Exception as e:  # noqa: BLE001
        print("[WARN] photo", code, e)
        return None


def parse_roster(page):
    """/team/<slug>/player/ → 선수·스태프 목록"""
    players, staff = [], []
    for li in re.findall(r"<li[^>]*>(.*?)</li>", page, re.S):
        if 'class="photo"' not in li or 'class="field"' not in li:
            continue
        pid = re.search(r"player/detail/\?id=(\d+)", li)
        img = re.search(r'<img src="([^"]+)"', li)
        no = _txt((re.search(r"<b>(.*?)</b>", li, re.S) or [None, ""])[1])
        name = _txt((re.search(r"<strong>(.*?)</strong>", li, re.S) or [None, ""])[1])
        roman = _txt((re.search(r"<em>(.*?)</em>", li, re.S) or [None, ""])[1])
        role = _txt((re.search(r"<p>(.*?)</p>", li, re.S) or [None, ""])[1])
        if not name:
            continue
        row = {"name": name, "roman": roman, "img_src": img.group(1) if img else ""}
        if pid:
            row.update({"code": pid.group(1), "no": int(no) if no.isdigit() else None, "pos": POS_EN.get(role.lower(), role)})
            players.append(row)
        else:
            row["role"] = role
            staff.append(row)
    return players, staff


def parse_player(page):
    """/player/detail/?id=… → 프로필 항목 + 시즌별 기록"""
    info = {}
    for k, v in re.findall(r"<li>\s*<span>(.*?)</span>\s*<em>(.*?)</em>\s*</li>", page, re.S):
        info[_txt(k)] = _txt(v)
    career = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        ths = [_txt(x) for x in re.findall(r"<th[^>]*>(.*?)</th>", tr, re.S)]
        tds = [_txt(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(ths) != 2 or len(tds) < 26 or not re.match(r"\d{4}-\d{2}", ths[0]):
            continue
        n = lambda v: None if v in ("", "-") else (float(v) if "." in v else int(v))  # noqa: E731
        career.append({"season": ths[0], "team": ths[1], "g": n(tds[0]), "s": n(tds[1]), "atk": n(tds[5]),
                       "blk": n(tds[12]), "ace": n(tds[14]), "srv": n(tds[17]), "rcv": n(tds[21]), "pts": n(tds[25])})
    birth = info.get("生年月日", "").replace(".", "-")
    age = None
    try:
        b = date.fromisoformat(birth)
        t = now_kst().date()
        age = t.year - b.year - ((t.month, t.day) < (b.month, b.day))
    except Exception:  # noqa: BLE001
        birth = birth or None
    num = lambda v: int(re.sub(r"\D", "", v)) if re.search(r"\d", v or "") else None  # noqa: E731
    return {"birth": birth, "age": age, "height": num(info.get("身長")), "reach": num(info.get("最高到達点")),
            "nation": info.get("リーグ登録国籍") or None, "hometown": info.get("出身地") or None,
            "school": info.get("出身校") or None, "career": career[:8]}


def collect_profiles(force=False, max_age_h=20):
    """12개 구단 선수단(사진·등번호·포지션·프로필·시즌 기록) → data/profiles.json (하루 한 번)"""
    old = load("profiles.json", {}) or {}
    if not force and old.get("updated_at") and not old.get("_manual"):
        try:
            age = now_kst() - datetime.strptime(old["updated_at"], "%Y-%m-%d %H:%M").replace(tzinfo=KST)
            if age < timedelta(hours=max_age_h):
                return False
        except Exception:  # noqa: BLE001
            pass
    try:
        lst = get_text(f"{SV_SITE}/team/sv/men/")
        slugs = [s for s in dict.fromkeys(re.findall(r'href="/team/([a-z0-9_]+)/"', lst)) if s in SLUG_KR]
    except Exception as e:  # noqa: BLE001
        slugs, err = [], e
    if not slugs:
        slugs = list(SLUG_KR)
    old_by = {(t, p.get("code")): p for t, ps in (old.get("teams") or {}).items() for p in ps if p.get("code")}
    out, coaches, fails = {}, {}, []
    for slug in slugs:
        team = SLUG_KR[slug]
        try:
            players, staff = parse_roster(get_text(f"{SV_SITE}/team/{slug}/player/"))
        except Exception as e:  # noqa: BLE001
            fails.append(f"{team}: {e}")
            continue
        if not players:
            fails.append(f"{team}: 선수 0명")
            continue
        hc = next((s for s in staff if "head coach" in s.get("role", "").lower() or s.get("role") in ("監督", "ヘッドコーチ")), None)
        if hc:
            coaches[team] = {"name": hc["name"], "roman": hc["roman"]}
        lst2 = []
        for p in players:
            prev = old_by.get((team, p["code"])) or {}
            try:
                det = parse_player(get_text(f"{SV_SITE}/player/detail/?id={p['code']}", tries=2))
                time.sleep(0.25)
            except Exception as e:  # noqa: BLE001
                print("[WARN] player", p["code"], e)
                det = {k: prev.get(k) for k in ("birth", "age", "height", "reach", "nation", "hometown", "school", "career")}
            img = save_photo(SV_SITE + p["img_src"], p["code"]) if p.get("img_src") and "sample" not in p["img_src"] else None
            lst2.append({"code": p["code"], "no": p["no"], "name": p["name"], "roman": p["roman"], "pos": p["pos"],
                         "img": img or prev.get("img"), **det})
        lst2.sort(key=lambda x: (x["no"] is None, x["no"] or 0))
        out[team] = lst2
        print(f"[OK] {team} 선수 {len(lst2)}명")
    if not out:
        STATUS["profiles"] = "실패 — 기존 선수단 유지" + (f": {fails[0]}" if fails else "")
        return False
    for t, ps in (old.get("teams") or {}).items():   # 이번에 못 받은 팀은 예전 명단 유지
        out.setdefault(t, ps)
    names = (load("names_kr.json", {}) or {}).get("names", {})
    unknown = sorted({p["name"] for ps in out.values() for p in ps if p["name"].replace(" ", "") not in names})
    STATUS["profiles"] = f"성공 {sum(len(v) for v in out.values())}명 · 사진 {sum(1 for v in out.values() for p in v if p.get('img'))}장" \
        + (f" · 실패 {len(fails)}" if fails else "") + (f" · 한글 이름 없음 {len(unknown)}명" if unknown else "")
    return save("profiles.json", {"updated_at": now_kst().strftime("%Y-%m-%d %H:%M"), "source": "SV리그 공식 사이트 선수 명단",
                                  "coaches": coaches, "no_korean_name": unknown, "teams": out})

# ---------------------------------------------------------------- 실시간 (경기 중)
def run_live():
    """오늘 경기만 받아 data/live.json 에 쓴다. 마지막 줄에 CONTINUE / STOP 출력."""
    now = now_kst()
    today = now.date().isoformat()
    sched = [g for g in (load("schedule.json", {}) or {}).get("games", []) if g["date"] == today]
    try:
        games = [g for g in parse_day(fetch_day(today)) if g["date"] == today]
    except Exception as e:  # noqa: BLE001
        print("[ERROR] live:", e)
        print("CONTINUE" if sched else "STOP")
        return
    games = merge_day(sched, games) if games else []
    save("live.json", {"date": today, "updated_at": now.strftime("%Y-%m-%d %H:%M:%S"), "games": games})
    for g in games:
        print(f"  {g['time']} {g['away']} {g.get('sa', '-')}:{g.get('sh', '-')} {g['home']} [{g['state']}] {g.get('status', '')} sets={g.get('sets')}")
    pending = [g for g in (games or sched) if g["state"] not in ("final", "cancel")]
    if not pending:
        print("STOP")
        return
    if any(g["state"] == "live" for g in pending):
        print("CONTINUE")
        return
    soon = False  # 아직 시작 전: 40분 안에 시작하는 경기가 있으면 계속, 아니면 다음 예약 실행에 맡김
    for g in pending:
        if not g["time"]:
            soon = True
            continue
        start = datetime.fromisoformat(f"{g['date']}T{g['time']}:00").replace(tzinfo=KST)
        if timedelta(minutes=-240) <= start - now <= timedelta(minutes=40):
            soon = True
    print("CONTINUE" if soon else "STOP")


# ---------------------------------------------------------------- 자체 점검
SAMPLE = """<html><body><nav><a href="/volley/game/7219?league=7280&amp;date=2026-11-07">11/7</a>
<a href="/volley/game/7219?league=7280&amp;date=2026-11-14">11/14</a><a href="/volley/game/7219?league=7281&amp;date=2026-11-08">SVグロース</a></nav>
<section><div><span>11/8(Sun)</span> <time>13:35</time> <p>レギュラーシーズン 第3節</p><p>エントリオ</p>
<div><img alt=""><span>WD名古屋</span></div><div><b>3</b><ul><li>26 - 24</li><li>22 - 25</li><li>26 - 24</li><li>27 - 25</li></ul><b>1</b>
<a href="https://www.svleague.jp/match/detail/38001/">試合終了<span>外部サイト</span></a></div><div><img alt=""><span>STINGS愛知</span></div></div>
<div><span>11/8(Sun)</span> <time>14:05</time> <p>レギュラーシーズン 第3節</p><p>香陵アリーナ</p>
<div><span>東レ静岡</span></div><div><b>1</b><ul><li>22－25</li><li>16－25</li><li>25－23</li><li>21－25</li></ul><b>3</b>
<a href="https://www.svleague.jp/match/detail/38003/">試合終了</a></div><div><span>大阪Ｂ</span></div></div>
<div><span>11/14(Sat)</span> 13:05 レギュラーシーズン 第4節 おおきにアリーナ舞洲 <a href="https://ticket-v.jp/ticket/?id=38014">チケット購入 外部サイト</a>
<span>サントリー</span> <a href="https://www.svleague.jp/match/detail/38014/">試合前 外部サイト</a> <span>STINGS愛知</span></div>
<div><span>11/14(Sat)</span> 14:05 レギュラーシーズン 第4節 パナソニックアリーナ <span>大阪Ｂ</span> 1 25 - 20 18 - 25 11 - 9 1 第3セット <span>F鹿児島</span></div>
<div><span>4/10(Sat)</span> 23:59 レギュラーシーズン 第21節 調整中 <span>東レ静岡</span> 試合前 <span>東京GB</span></div>
</section></body></html>"""


def selftest():
    gs = parse_day(SAMPLE)
    by = {(g["date"], g["home"]): g for g in gs}
    a = by[("2026-11-08", "WD나고야")]
    assert (a["away"], a["sh"], a["sa"], a["time"], a["venue"], a["round"], a["gid"]) == ("스팅스아이치", 3, 1, "13:35", "엔트리오", 3, "sv38001"), a
    assert a["sets"] == [[26, 24], [22, 25], [26, 24], [27, 25]], a
    b = by[("2026-11-08", "도레이")]
    assert (b["away"], b["sh"], b["sa"], b["state"]) == ("오사카B", 1, 3, "final"), b
    c = by[("2026-11-14", "산토리")]
    assert (c["state"], c["away"], c["ticket"], c["venue"]) == ("scheduled", "스팅스아이치", "https://ticket-v.jp/ticket/?id=38014", "오키니 아레나 마이시마"), c
    d = by[("2026-11-14", "오사카B")]
    assert (d["state"], d["sh"], d["sa"], d["status"]) == ("live", 1, 1, "3세트 진행 중"), d
    e = by[("2027-04-10", "도레이")]
    assert (e["time"], e["venue"], e["away"]) == ("", "", "도쿄GB"), e
    assert discover_dates(SAMPLE) == {"2026-11-07", "2026-11-14"}
    print("selftest OK —", len(gs), "경기")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true", help="오늘 경기 실시간 점수만 수집 (live.json)")
    ap.add_argument("--skip-news", action="store_true")
    ap.add_argument("--selftest", action="store_true", help="내장 샘플로 페이지 읽기 기능 점검")
    ap.add_argument("--parse", metavar="HTML파일", help="저장해 둔 페이지를 읽어 결과만 출력 (구조가 바뀌었을 때 확인용)")
    ap.add_argument("--profiles", action="store_true", help="선수단·사진만 새로 받고 끝")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return
    if args.parse:
        with open(args.parse, encoding="utf-8") as f:
            print(json.dumps(parse_day(f.read()), ensure_ascii=False, indent=1))
        return
    if args.live:
        run_live()
        return
    if args.profiles:
        collect_profiles(force=True)
        meta = load("meta.json", {}) or {}
        meta.setdefault("status", {})["profiles"] = STATUS.get("profiles", "")
        save("meta.json", meta)
        print(STATUS)
        return

    changed = bool(collect_schedule())
    if not args.skip_news:
        changed |= bool(collect_news())
    meta = load("meta.json", {}) or {}
    if changed or meta.get("status") != STATUS:
        save("meta.json", {"updated_at_kst": now_kst().strftime("%Y-%m-%d %H:%M"), "season": SEASON, "status": STATUS})
        print("[OK] 변경 저장")
    else:
        print("변경 없음")
    sys.exit(0)  # 실패해도 워크플로는 초록색으로 (다음 회차 재시도)


if __name__ == "__main__":
    main()
