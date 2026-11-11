/* 일본 SV리그 남자부 정적 대시보드 — data/*.json 을 읽어 9개 탭을 렌더링 */

const DATA = {};
const FILES = ["meta", "teams", "schedule", "standings", "players", "news", "events", "last_season", "profiles", "tickets", "names_kr"];
const VBTV_URL = "https://tv.volleyballworld.com/";          // 일본 밖 중계 (유료)
const JSPORTS_URL = "https://jod.jsports.co.jp/volleyball";    // 일본 안 중계 (유료)
const OFFICIAL_URL = "https://www.svleague.jp/match/sv/men/";

/* ---------- 마이팀 (보는 사람 브라우저에 저장) ---------- */
const MYTEAM_KEY = "svleague_myteam";
let MY_TEAM = null;
function loadMyTeam() { try { MY_TEAM = localStorage.getItem(MYTEAM_KEY) || null; } catch (e) { MY_TEAM = null; } }
function saveMyTeam(name) {
  MY_TEAM = name || null;
  try { name ? localStorage.setItem(MYTEAM_KEY, name) : localStorage.removeItem(MYTEAM_KEY); } catch (e) { /* 이번 방문 동안만 유지 */ }
}
const isMine = (name) => !!MY_TEAM && name === MY_TEAM;

/* 어두운 구단색은 어두운 배경에서 안 보이므로 밝게 보정 */
function readable(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return "#94a3b8";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum >= 0.35) return hex;
  const mix = (c) => Math.round(c + (255 - c) * 0.45);
  return `#${[mix(r), mix(g), mix(b)].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}

async function loadAll() {
  await Promise.all(FILES.map(async (f) => {
    try {
      const res = await fetch(`data/${f}.json?t=${Date.now()}`, { cache: "no-store" });
      DATA[f] = res.ok ? await res.json() : null;
    } catch (e) { DATA[f] = null; }
  }));
  await loadLive();
}

/* ---------- 실시간 점수 (live 브랜치의 live.json) ----------
   경기 중엔 Actions가 live 브랜치에 live.json 을 올린다.
   GitHub Pages 를 다시 빌드하지 않으므로 빠르다. API 한도(시간당 60회)를 넘으면 raw 주소로 대체. */
const FALLBACK_REPO = "leejeongeunnnn/svleague_";
function repoSlug() {
  const h = location.hostname;
  if (h.endsWith(".github.io")) {
    const repo = location.pathname.split("/").filter(Boolean)[0];
    if (repo) return `${h.split(".")[0]}/${repo}`;
  }
  return FALLBACK_REPO;
}
async function fetchLive() {
  if (!location.hostname || /^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return null;   // 로컬 미리보기에선 건너뜀
  const slug = repoSlug();
  const tries = [
    () => fetch(`https://api.github.com/repos/${slug}/contents/live.json?ref=live`, { cache: "no-store", headers: { Accept: "application/vnd.github.raw+json" } }),
    () => fetch(`https://raw.githubusercontent.com/${slug}/live/live.json?t=${Date.now()}`, { cache: "no-store" }),
  ];
  for (const t of tries) {
    try { const r = await t(); if (r.ok) return await r.json(); } catch (e) { /* 다음 방법 */ }
  }
  return null;
}
async function loadLive() {
  const L = await fetchLive();
  DATA.live = L;
  if (!L || L.date !== todayStr() || !Array.isArray(L.games) || !DATA.schedule) return;
  const games = (DATA.schedule.games || []).slice();
  const keyOf = (g) => `${g.date}|${g.home}|${g.away}`;
  const idx = Object.fromEntries(games.map((g, i) => [keyOf(g), i]));
  L.games.forEach(g => {
    const k = keyOf(g);
    if (k in idx) {
      const old = games[idx[k]];
      games[idx[k]] = { ...old, ...g, sets: g.sets || old.sets };
    } else games.push(g);
  });
  DATA.schedule = { ...DATA.schedule, games };
}

/* ---------- 유틸 ---------- */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const emptyBox = (msg) => `<div class="empty">${esc(msg)}</div>`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
function todayStr() {   // 한국과 일본은 같은 시간대
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function dateLabel(d) {
  const dt = new Date(d + "T00:00:00+09:00");
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(dt);
  const v = Object.fromEntries(p.map(x => [x.type, x.value]));
  return `${v.month}월 ${v.day}일 (${WD[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(v.weekday)]})`;
}
function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00+09:00") - new Date(a + "T00:00:00+09:00")) / 86400000); }
/* 선수 이름: 일본어 등록명 → 한글 (data/names_kr.json) */
const kn = (n) => (((DATA.names_kr || {}).names || {})[String(n || "").replace(/\s/g, "")]) || n;
const fmt3 = (v) => (v == null || v === "" || !isFinite(v)) ? "-" : Number(v).toFixed(3);
const fmtRate = (v) => (v == null || !isFinite(v)) ? "-" : Number(v).toFixed(3).replace(/^0\./, ".");

let TEAM = {};
function buildTeamMap() {
  TEAM = {};
  const tk = (DATA.tickets && DATA.tickets.teams) || {};
  ((DATA.teams && DATA.teams.teams) || []).forEach(t => { TEAM[t.name] = { ...t, ticket: tk[t.name] || null }; });
}
const colorOf = (name) => readable((TEAM[name] || {}).color || "#64748b");
const dot = (name) => `<span class="dot" style="background:${colorOf(name)}"></span>`;

function allGames() {
  const g = (DATA.schedule && DATA.schedule.games) || [];
  return g.slice().sort((a, b) => (a.date + (a.time || "99")).localeCompare(b.date + (b.time || "99")));
}
const KIND_LABEL = { regular: "정규리그", cs: "챔피언십" };
const roundLabel = (g) => g.kind === "regular" ? (g.round ? `${g.round}절` : "정규리그") : (g.series || KIND_LABEL[g.kind] || "");

/* ---------- 순위 계산 (결과에서 직접 집계) ----------
   SV리그 순위 기준: 승률 → 포인트 → 세트율 → 득실점률
   포인트: 3-0/3-1 승 3점, 3-2 승 2점, 2-3 패 1점 */
function computeTable(games, teams) {
  const T = {};
  teams.forEach(n => { T[n] = { team: n, games: 0, w: 0, l: 0, pts: 0, sw: 0, sl: 0, pw: 0, pl: 0, hasPts: true, form: [] }; });
  games.filter(g => g.state === "final" && g.sh != null && g.sa != null).forEach(g => {
    const sh = +g.sh, sa = +g.sa;
    [[g.home, sh, sa, 0], [g.away, sa, sh, 1]].forEach(([n, my, op, side]) => {
      const r = T[n]; if (!r) return;
      r.games++; r.sw += my; r.sl += op;
      const win = my > op;
      if (win) { r.w++; r.pts += op <= 1 ? 3 : 2; } else { r.l++; r.pts += my === 2 ? 1 : 0; }
      r.form.push(win ? "W" : "L");
      if (Array.isArray(g.sets) && g.sets.length) {
        g.sets.forEach(s => { r.pw += +s[side]; r.pl += +s[1 - side]; });
      } else r.hasPts = false;
    });
  });
  const rows = Object.values(T).map(r => ({
    ...r,
    rate: r.games ? r.w / r.games : null,
    set_ratio: r.sl ? r.sw / r.sl : (r.sw ? Infinity : null),
    pt_ratio: (r.hasPts && r.pl) ? r.pw / r.pl : null,
  }));
  const v = (x) => x == null ? -1 : x;
  rows.sort((a, b) => v(b.rate) - v(a.rate) || b.pts - a.pts || v(b.set_ratio) - v(a.set_ratio) || v(b.pt_ratio) - v(a.pt_ratio));
  rows.forEach((r, i) => r.rank = i + 1);
  return rows;
}
function seasonTable() {
  const official = DATA.standings && DATA.standings.rows && DATA.standings.rows.length ? DATA.standings.rows : null;
  const reg = allGames().filter(g => g.kind === "regular");
  const computed = computeTable(reg, Object.keys(TEAM));
  if (official) {
    const formOf = Object.fromEntries(computed.map(r => [r.team, r.form]));
    return { rows: official.map(r => ({ ...r, form: formOf[r.team] || [] })), source: DATA.standings.source || "공식 순위" };
  }
  if (reg.some(g => g.state === "final")) return { rows: computed, source: "경기 결과로 자동 집계" };
  return null;
}

/* ---------- 경기 카드 ---------- */
function gameCard(g, opts = {}) {
  const live = g.state === "live";
  const fin = g.state === "final";
  const showScore = (fin || live) && g.sh != null && g.sa != null;
  let hw = "", aw = "";
  if (fin) { if (+g.sh > +g.sa) hw = "winner"; else if (+g.sa > +g.sh) aw = "winner"; }
  const sc = (v) => showScore ? esc(v) : "-";
  const mine = isMine(g.home) || isMine(g.away);
  const tag = g.kind !== "regular" ? [KIND_LABEL[g.kind], g.series].filter((t, i, a) => t && a.indexOf(t) === i).join(" · ") : "";
  let sets = "";
  if (Array.isArray(g.sets) && g.sets.length) {
    sets = `<div class="set-line">${g.sets.map((s, i) =>
      `<span title="${i + 1}세트" class="${live && i === g.sets.length - 1 ? "cur" : ""}"><b class="${+s[1] > +s[0] ? "w" : ""}">${esc(s[1])}</b><i>:</i><b class="${+s[0] > +s[1] ? "w" : ""}">${esc(s[0])}</b></span>`).join("")}</div>`;
  }
  const status = live ? (g.status || "경기 중") : fin ? (g.status || "경기 종료") : g.state === "cancel" ? (g.status || "취소") : (g.time ? `${g.time} 시작` : "시간 미정");
  const canOpen = !!(TEAM[g.home] && TEAM[g.away] && g.gid);
  const more = canOpen ? ` <b class="more">${live || fin ? "상세 ›" : "미리보기 ›"}</b>` : "";
  const place = [g.venue, g.kind === "regular" && g.round ? `${g.round}절` : ""].filter(Boolean).join(" · ");
  return `<div class="game ${live ? "is-live" : ""} ${mine ? "is-mine" : ""} ${canOpen ? "clickable" : ""}"${canOpen ? ` data-gid="${esc(g.gid)}" role="button" tabindex="0"` : ""}>
    ${(tag || live || mine || opts.showDate) ? `<div class="series">${mine ? '<span class="mine-star">⭐</span> ' : ""}${live ? '<span class="live-pill">LIVE</span> ' : ""}${opts.showDate ? `<span class="g-date">${esc(dateLabel(g.date))}</span> ` : ""}${esc(tag)}</div>` : ""}
    <div class="game-row">
      <span class="game-team">${dot(g.away)}${esc(g.away)}</span>
      <span class="game-score ${aw}">${sc(g.sa)}</span>
    </div>
    <div class="game-row">
      <span class="game-team">${dot(g.home)}${esc(g.home)} <span class="home-tag">홈</span></span>
      <span class="game-score ${hw}">${sc(g.sh)}</span>
    </div>
    ${sets}
    ${watchLinks(g)}
    <div class="game-meta">
      <span>${esc(place)}</span>
      <span class="${live ? "status-live" : ""}">${esc(status)}${more}</span>
    </div>
  </div>`;
}

/* 중계 · 예매 · 공식 기록 버튼 */
function ticketOf(team) {
  const t = (TEAM[team] || {}).ticket;
  return t && t.url ? t : null;
}
function watchLinks(g, big) {
  const btns = [];
  const today = todayStr();
  if (g.state === "live") btns.push(`<a class="wbtn live" href="${VBTV_URL}" target="_blank" rel="noopener">▶ VBTV 중계</a>`);
  else if (big && g.state === "scheduled" && g.date === today) btns.push(`<a class="wbtn" href="${VBTV_URL}" target="_blank" rel="noopener">📺 VBTV 중계</a>`);
  if (g.state === "scheduled" && g.date >= today) {
    const url = g.ticket || (ticketOf(g.home) || {}).url;
    if (url) btns.push(`<a class="wbtn ticket" href="${esc(url)}" target="_blank" rel="noopener">🎟️ 예매</a>`);
  }
  if (big) btns.push(`<a class="wbtn" href="${esc(g.url || OFFICIAL_URL)}" target="_blank" rel="noopener">📄 공식 ${g.state === "final" ? "기록" : "경기 페이지"}</a>`);
  return btns.length ? `<div class="wbtns">${btns.join("")}</div>` : "";
}

/* ---------- 1. 경기 일정 ---------- */
let SCHED_FILTER = "all";
let SCHED_ALL = false;
function renderSchedule() {
  const p = document.getElementById("panel-schedule");
  const today = todayStr();
  const ev = DATA.events || {};
  let games = allGames();
  if (SCHED_FILTER === "mine") games = games.filter(g => isMine(g.home) || isMine(g.away));
  else if (SCHED_FILTER !== "all") games = games.filter(g => g.kind === SCHED_FILTER);
  if (!SCHED_ALL) games = games.filter(g => { const d = daysBetween(today, g.date); return d >= -10 && d <= 14; });

  let html = `<h2 class="section-title">🔥 경기 일정 &amp; 결과</h2>`;

  const start = ev.regular && ev.regular.start;
  if (start && today < start) {
    html += `<div class="countdown card"><div class="cd-num">D-${daysBetween(today, start)}</div><div><div class="cd-title">${esc(ev.title || "SV리그 남자")} 개막</div>
      <div class="hint" style="margin:2px 0 0">${esc(ev.regular.opener || "")}</div></div></div>`;
  }

  const liveN = allGames().filter(g => g.date === today && g.state === "live").length;
  const todayN = allGames().filter(g => g.date === today).length;
  if (todayN) {
    html += `<div class="live-banner ${liveN ? "on" : ""}">${liveN ? '<span class="live-dot"></span> 지금 ' + liveN + "경기 진행 중" : "오늘 " + todayN + "경기"}
      <span class="lb-time">${DATA.live && DATA.live.date === today ? `실시간 ${esc(DATA.live.updated_at.slice(11, 16))} 기준` : `갱신 ${esc((DATA.meta || {}).updated_at_kst || "-")}`} · 경기 중엔 1~2분마다 자동 갱신</span></div>`;
  }

  const filters = [["all", "전체"], ["regular", "정규리그"], ["cs", "챔피언십"]];
  if (MY_TEAM) filters.push(["mine", `⭐ ${MY_TEAM}`]);
  html += `<div class="stage-tabs">${filters.map(([k, l]) =>
    `<button class="stage-chip ${SCHED_FILTER === k ? "active" : ""}" data-sf="${k}">${esc(l)}</button>`).join("")}
    <button class="stage-chip ${SCHED_ALL ? "active" : ""}" data-sall="1">${SCHED_ALL ? "📅 전체 기간" : "📅 최근·다가오는 2주"}</button></div>`;

  if (DATA.schedule && DATA.schedule._seed) {
    html += `<p class="hint">ℹ️ 지금은 2026년 11월 11일에 직접 정리한 일정·결과예요 (11월 8일 경기까지 반영). 자동 수집이 처음 돌면 최신 내용으로 바뀝니다.</p>`;
  }

  if (!games.length) {
    html += emptyBox(SCHED_FILTER === "cs" ? `챔피언십은 ${ev.cs ? ev.cs.start.slice(5).replace("-", "월 ") + "일" : "4월 말"}부터 열려요.` : SCHED_ALL ? "표시할 경기가 없습니다." : "앞뒤 2주 안에 경기가 없어요. '최근·다가오는 2주'를 눌러 전체 기간으로 바꿔 보세요.");
  } else {
    const byDate = {};
    games.forEach(g => (byDate[g.date] = byDate[g.date] || []).push(g));
    Object.keys(byDate).sort().forEach(d => {
      html += `<div class="day-group" ${d === today ? 'id="sched-today"' : ""}><div class="day-head">${esc(dateLabel(d))}${d === today ? '<span class="today-badge">오늘</span>' : ""}</div>
        <div class="game-grid">${byDate[d].map(g => gameCard(g)).join("")}</div></div>`;
    });
  }
  html += `<p class="hint" style="margin-top:14px">경기 시간은 일본 현지 시각 = 한국 시각 (시차 없음) · 위쪽 팀이 원정, 아래쪽이 홈 · 세트 점수는 원정:홈</p>`;
  p.innerHTML = html;
  p.querySelectorAll("[data-sf]").forEach(b => b.onclick = () => { SCHED_FILTER = b.dataset.sf; renderSchedule(); });
  p.querySelector("[data-sall]").onclick = () => { SCHED_ALL = !SCHED_ALL; renderSchedule(); };
}

/* ---------- 2. 순위 ---------- */
function formChips(form, n = 5) {
  return (form || []).slice(-n).map(f => `<span class="form-chip sm ${f}">${f === "W" ? "승" : "패"}</span>`).join("");
}
function rankTable(rows, opts = {}) {
  const hasRatio = rows.some(r => r.set_ratio != null);
  const hasPt = rows.some(r => r.pt_ratio != null);
  const hasForm = !opts.noForm && rows.some(r => r.form && r.form.length);
  const cuts = opts.cuts || [];
  const rate = (r) => r.rate != null ? r.rate : (r.games ? r.w / r.games : null);
  return `<div class="league-card card"><table class="rank"><thead><tr>
    <th>순위</th><th style="text-align:left">팀</th><th>경기</th><th>승</th><th>패</th><th>승률</th><th>포인트</th>
    ${hasRatio ? '<th class="opt">세트율</th>' : ""}${hasPt ? '<th class="opt">득실점률</th>' : ""}${hasForm ? "<th>최근</th>" : ""}
  </tr></thead><tbody>${rows.map(r => `<tr class="${isMine(r.team) ? "mine-row" : ""} ${cuts.includes(r.rank) ? "cut" : ""}">
    <td class="num">${r.rank}</td><td class="team">${dot(r.team)} ${esc(r.team)}${r.note ? ` <span class="hint" style="margin:0;font-weight:400">${esc(r.note)}</span>` : ""}</td>
    <td class="num">${r.games}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num"><b>${fmtRate(rate(r))}</b></td><td class="num">${r.pts}</td>
    ${hasRatio ? `<td class="num opt">${r.set_ratio === Infinity ? "MAX" : fmt3(r.set_ratio)}</td>` : ""}${hasPt ? `<td class="num opt">${fmt3(r.pt_ratio)}</td>` : ""}
    ${hasForm ? `<td><span class="form-inline">${formChips(r.form)}</span></td>` : ""}
  </tr>`).join("")}</tbody></table>
  ${opts.foot ? `<div class="hint" style="margin:10px 0 0">${opts.foot}</div>` : ""}</div>`;
}
function renderStandings() {
  const p = document.getElementById("panel-standings");
  const ev = DATA.events || {};
  const cur = seasonTable();
  let html = `<h2 class="section-title">🏆 ${esc((ev.season || "") + " ")}SV리그 남자 순위</h2>`;
  if (cur) {
    html += rankTable(cur.rows, { cuts: [2, 6], foot: `출처: ${esc(cur.source)} · ${esc(ev.rank_rule || "")}<br>${esc(ev.points_rule || "")}<br>점선 위 6팀이 챔피언십 진출 (1·2위는 세미파이널 직행, 3~6위는 쿼터파이널부터)` });
  } else {
    html += emptyBox("첫 경기가 끝나면 이 자리에 순위표가 나옵니다.");
  }
  html += rankChartHtml();
  const ls = DATA.last_season;
  if (ls && ls.standings) {
    html += `<div class="sched-sub">📜 지난 시즌 정규리그 순위 (${esc(ls.season)})</div>`;
    html += rankTable(ls.standings.map(r => ({ ...r })), { cuts: [2, 6], foot: esc(ls.standings_note || "") });
  }
  p.innerHTML = html;
  bindRankChart(p);
}

/* ---------- 3. 챔피언십 ---------- */
let CS_TAB = "now";
function seriesLines(st) {
  return `${st.series ? st.series.map(s => `<div class="ps-info">${esc(s.date)} · ${esc(s.away)} <b>${s.sa} : ${s.sh}</b> ${esc(s.home)} (홈)</div>`).join("") : ""}
    ${st.summary ? `<div class="ps-info">${esc(st.summary)}</div>` : ""}`;
}
function renderCS() {
  const p = document.getElementById("panel-cs");
  const ev = DATA.events || {};
  const ls = DATA.last_season || {};
  let html = `<h2 class="section-title">🏅 챔피언십</h2>
    <div class="stage-tabs">${[["now", "🏅 이번 시즌"], ["last", "📜 지난 시즌"]].map(([k, l]) =>
      `<button class="stage-chip ${CS_TAB === k ? "active" : ""}" data-cs="${k}">${l}</button>`).join("")}</div>`;

  if (CS_TAB === "now") {
    const cs = ev.cs || {};
    html += `<p class="hint">정규리그 상위 ${cs.teams || 6}팀이 나가는 토너먼트 · ${esc(cs.start || "")} ~ ${esc(cs.end || "")}</p>
      <div class="card">${(cs.rounds || []).map(r => `
      <div class="ps-game" style="margin-bottom:10px"><div class="ps-badge">${esc(r.short)}</div>
      <div class="ps-info"><div class="ps-match">${esc(r.name)}</div>${esc(r.format)}<br><span class="ps-rules">${esc(r.rule)}</span></div></div>`).join("")}</div>`;
    const cur = seasonTable();
    if (cur && cur.rows.length >= 6) {
      const r = cur.rows, t = (i) => `${dot(r[i].team)}${isMine(r[i].team) ? "<b>" + esc(r[i].team) + "</b>" : esc(r[i].team)}`;
      html += `<div class="card"><b>지금 순위대로라면</b><div class="ps-info" style="margin-top:6px;line-height:1.9">
        세미파이널 직행: ${t(0)} (1위) · ${t(1)} (2위)<br>
        쿼터파이널 ①: ${t(2)} (3위) vs ${t(5)} (6위)<br>
        쿼터파이널 ②: ${t(3)} (4위) vs ${t(4)} (5위)
        ${r[6] ? `<br><span class="ps-rules">6위 ${esc(r[5].team)} ${r[5].w}승 ${r[5].l}패 · 7위 ${esc(r[6].team)} ${r[6].w}승 ${r[6].l}패</span>` : ""}
      </div></div>`;
    }
    const csGames = allGames().filter(g => g.kind === "cs");
    html += csGames.length ? `<div class="game-grid">${csGames.map(g => gameCard(g, { showDate: true })).join("")}</div>`
      : emptyBox("챔피언십 대진은 정규리그가 끝나는 4월 18일 뒤에 정해져요. 경기가 잡히면 여기에 나옵니다.");
  }

  if (CS_TAB === "last" && ls.postseason) {
    html += `<p class="hint">${esc(ls.title || "")}</p>`;
    ls.postseason.forEach(st => {
      html += `<div class="card"><div class="ps-match">${esc(st.stage)} <span class="hint">(${esc(st.format)})</span> → 🏅 ${dot(st.winner)}${esc(st.winner)}</div>${seriesLines(st)}</div>`;
    });
    if (ls.sources) html += `<p class="hint">출처: ${ls.sources.map(esc).join(" · ")}</p>`;
  }
  p.innerHTML = html;
  p.querySelectorAll("[data-cs]").forEach(b => b.onclick = () => { CS_TAB = b.dataset.cs; renderCS(); });
}

/* ---------- 4. 선수 기록 ---------- */
let PL_CAT = null;
let PL_SORT = null;
function renderPlayers() {
  const p = document.getElementById("panel-players");
  const pl = DATA.players || {};
  const cats = pl.categories || {};
  const keys = Object.keys(cats).filter(k => cats[k] && cats[k].rows && cats[k].rows.length);
  let html = `<h2 class="section-title">🏐 선수 기록${pl.as_of ? ` <span class="hint" style="margin:0">${esc(pl.as_of)} 현재</span>` : ""}</h2>`;
  if (keys.length) {
    if (!PL_CAT || !keys.includes(PL_CAT)) PL_CAT = keys[0];
    const c = cats[PL_CAT];
    const cols = c.columns || [];
    let rows = c.rows.slice();
    if (PL_SORT) rows.sort((a, b) => (parseFloat(b[PL_SORT]) || 0) - (parseFloat(a[PL_SORT]) || 0));
    html += `<p class="hint">ℹ️ 개인 기록은 자동으로 갱신되지 않는 스냅샷이에요. 최신 기록은 <a href="https://www.svleague.jp/record/" target="_blank" rel="noopener">SV리그 공식 기록 페이지</a>에서 볼 수 있어요.</p>
      <div class="stage-tabs">${keys.map(k => `<button class="stage-chip ${k === PL_CAT ? "active" : ""}" data-pc="${esc(k)}">${esc(k)}</button>`).join("")}</div>
      <div class="card table-scroll"><table class="stats"><thead><tr><th>#</th><th style="text-align:left">선수</th><th style="text-align:left">팀</th>
      ${cols.map(col => `<th data-ps="${esc(col)}">${esc(col)}${PL_SORT === col ? " ▼" : ""}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${isMine(r.team) ? "mine-row" : ""}"><td class="num">${esc(PL_SORT ? i + 1 : (r.rank || i + 1))}</td><td class="pname"><a class="plink" data-pteam="${esc(r.team)}" data-pname="${esc(r.name)}">${esc(kn(r.name))}</a><div class="gm-pos">${esc(r.name)}</div></td><td class="pteam">${dot(r.team)}${esc(r.team)}</td>
        ${cols.map(col => `<td class="num">${esc(r[col] == null ? "-" : r[col])}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div><p class="hint">${c.note ? esc(c.note) + "<br>" : ""}출처: ${esc(pl.source || "-")} · 열 제목을 누르면 정렬 · 이름을 누르면 선수단 탭으로 · 작은 글씨는 일본어 등록명</p>`;
  } else {
    html += emptyBox("개인 기록이 아직 없어요.");
  }
  const ls = DATA.last_season;
  if (ls && ls.awards) {
    html += `<div class="sched-sub">🏅 지난 시즌 (${esc(ls.season)}) 시상 · 부문 1위</div><div class="card">${ls.awards.map(a =>
      `<div class="mt-pl ${isMine(a.team) ? "mine" : ""}"><span>${esc(a.award)}</span><span class="num"><b>${esc(a.name)}</b> · ${dot(a.team)}${esc(a.team)}</span></div>`).join("")}</div>`;
  }
  p.innerHTML = html;
  p.querySelectorAll("[data-pc]").forEach(b => b.onclick = () => { PL_CAT = b.dataset.pc; PL_SORT = null; renderPlayers(); });
  p.querySelectorAll("th[data-ps]").forEach(th => th.onclick = () => { PL_SORT = th.dataset.ps; renderPlayers(); });
  p.querySelectorAll(".plink").forEach(a => a.onclick = () => openProfile(a.dataset.pteam, a.dataset.pname));
}

/* ---------- 5. 선수단 ---------- */
const POS_ORDER = ["S", "OH", "OP", "MB", "L"];
const POS_FULL = { S: "세터", OH: "아웃사이드 히터", OP: "아포짓", MB: "미들블로커", L: "리베로" };
let SQ_TEAM = null, SQ_OPEN = null;
function statLines(team, name) {   // 개인 기록 스냅샷에서 이 선수의 순위 찾기
  const cats = (DATA.players || {}).categories || {};
  const key = String(name || "").replace(/\s/g, "");
  return Object.entries(cats).map(([k, c]) => {
    const r = (c.rows || []).find(x => x.team === team && String(x.name).replace(/\s/g, "") === key);
    return r ? `${k} ${r.rank}위 (${r[c.columns[k === "득점" ? 1 : 0]]})` : "";
  }).filter(Boolean);
}
function openProfile(team, name) {
  const key = String(name || "").replace(/\s/g, "");
  const p = (((DATA.profiles || {}).teams || {})[team] || []).find(x => String(x.name).replace(/\s/g, "") === key);
  SQ_TEAM = team; SQ_OPEN = p ? p.name : name; showTab("squad"); renderSquad();
  setTimeout(() => { const el = document.querySelector(`.pf-card[data-open="1"]`); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }, 60);
}
const NATION_KR = { "日本": "일본", "アメリカ": "미국", "アメリカ合衆国": "미국", "ブラジル": "브라질", "フランス": "프랑스", "ポーランド": "폴란드", "イタリア": "이탈리아",
  "ドイツ": "독일", "カナダ": "캐나다", "キューバ": "쿠바", "イラン": "이란", "アルゼンチン": "아르헨티나", "チュニジア": "튀니지", "ルーマニア": "루마니아",
  "ロシア": "러시아", "台湾": "대만", "チャイニーズタイペイ": "대만", "中国": "중국", "韓国": "한국", "フィリピン": "필리핀", "フィンランド": "핀란드", "エストニア": "에스토니아",
  "デンマーク": "덴마크", "ノルウェー": "노르웨이", "チェコ": "체코", "スロベニア": "슬로베니아", "イスラエル": "이스라엘", "スペイン": "스페인", "ベルギー": "벨기에",
  "セルビア": "세르비아", "ウクライナ": "우크라이나", "オランダ": "네덜란드", "タイ": "태국", "インドネシア": "인도네시아", "ベトナム": "베트남", "オーストラリア": "호주",
  "カザフスタン": "카자흐스탄", "ブルガリア": "불가리아", "トルコ": "튀르키예", "エジプト": "이집트", "アルジェリア": "알제리", "ナイジェリア": "나이지리아", "スロバキア": "슬로바키아" };
const nationKr = (n) => NATION_KR[n] || n || "";
const isForeign = (p) => p.nation && p.nation !== "日本";
const fmtN = (v, d = 0) => v == null || v === "" ? "-" : Number(v).toFixed(d);
const seasonShort = (x) => { const m = /^(\d{2})(\d{2})-(\d{2})/.exec(x || ""); return m ? `${m[2]}-${m[3]}` : (x || ""); };
function profileCard(team, p) {
  const open = SQ_OPEN === p.name;
  const st = statLines(team, p.name);
  const body = [p.age != null ? `${p.age}세` : "", p.height ? `${p.height}cm` : "", isForeign(p) ? nationKr(p.nation) : ""].filter(Boolean).join(" · ");
  let html = `<div class="card pf-card ${open ? "open" : ""}" data-open="${open ? 1 : 0}" data-pn="${esc(p.name)}" role="button" tabindex="0">
    <div class="pf-head">
      ${p.img ? `<img class="pf-img" src="${esc(p.img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div class="pf-no" style="color:${colorOf(team)}">${p.no ?? "–"}</div>
      <div class="pf-names"><div class="pf-name">${esc(kn(p.name))}</div><div class="pf-jp">${esc(POS_FULL[p.pos] || p.pos || "")}${body ? " · " + esc(body) : ""}</div></div>
      <div class="pf-badges">${isForeign(p) ? '<span class="pf-ik">외국인</span>' : ""}</div>
    </div>
    ${st.length ? `<div class="pf-stat">${st.map(esc).join(" · ")}</div>` : ""}`;
  if (open) {
    html += `<div class="pf-row"><span>🏷️</span><span>${esc(p.name)}${p.roman ? " · " + esc(p.roman) : ""}</span></div>
      ${p.nation ? `<div class="pf-row"><span>🌏</span><span>${esc(nationKr(p.nation))}${p.hometown ? " · " + esc(p.hometown) : ""}</span></div>` : ""}
      ${p.school ? `<div class="pf-row"><span>🎓</span><span>${esc(p.school)}</span></div>` : ""}
      ${p.birth ? `<div class="pf-row"><span>🎂</span><span>${esc(p.birth)}</span></div>` : ""}
      ${p.reach ? `<div class="pf-row"><span>⬆️</span><span>최고 도달점 ${esc(p.reach)}cm</span></div>` : ""}`;
    if (p.career && p.career.length) {
      html += `<div class="table-scroll" style="margin-top:6px"><table class="gm-tbl"><thead><tr><th class="l">시즌</th><th>경기</th><th>세트</th><th>득점</th><th>공격%</th><th>블로킹/S</th><th>서브에이스</th><th>리시브%</th></tr></thead><tbody>
        ${p.career.map(c => `<tr><td class="l" style="white-space:nowrap">${esc(seasonShort(c.season))}${/V\.LEAGUE|Vリーグ/.test(c.season) && !/SV/.test(c.season) ? " V" : ""}</td><td>${fmtN(c.g)}</td><td>${fmtN(c.s)}</td><td>${fmtN(c.pts)}</td><td>${fmtN(c.atk, 1)}</td><td>${fmtN(c.blk, 2)}</td><td>${fmtN(c.ace)}</td><td>${fmtN(c.rcv, 1)}</td></tr>`).join("")}
        </tbody></table></div><div class="hint" style="margin:4px 0 0">SV리그 공식 기록 · 공격% = 공격 성공률 · 리시브% = 서브리시브 성공률 · /S = 세트당</div>`;
    }
  } else html += `<div class="pf-more">눌러서 프로필 보기 ›</div>`;
  return html + `</div>`;
}
function coachOf(team) {
  const t = TEAM[team] || {};
  if (t.coach) return t.coach;
  const c = (((DATA.profiles || {}).coaches) || {})[team];
  return c ? (kn(c.name) !== c.name ? kn(c.name) : c.name) : "";
}
function renderSquad() {
  const p = document.getElementById("panel-squad");
  const pr = (DATA.profiles || {}).teams || {};
  const teams = ((DATA.teams && DATA.teams.teams) || []).map(t => t.name);
  if (!SQ_TEAM || !teams.includes(SQ_TEAM)) SQ_TEAM = (MY_TEAM && teams.includes(MY_TEAM)) ? MY_TEAM : teams[0];
  let html = `<h2 class="section-title">👥 선수단</h2>
    <div class="stage-tabs">${teams.map(t => `<button class="stage-chip ${t === SQ_TEAM ? "active" : ""}" data-sq="${esc(t)}" style="${t === SQ_TEAM ? `background:${colorOf(t)};border-color:${colorOf(t)};color:#0b0f17` : ""}">${esc(t)}</button>`).join("")}</div>`;
  const lst = pr[SQ_TEAM] || [];
  if (!lst.length) {
    html += emptyBox("이 팀의 선수 명단이 아직 없어요.");
  } else {
    const t = TEAM[SQ_TEAM] || {};
    const ages = lst.filter(x => x.age != null).map(x => x.age), hs = lst.filter(x => x.height).map(x => x.height);
    const avg = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : "-";
    html += `<div class="pf-summary"><div><b>${lst.length}명</b><span>등록 선수</span></div><div><b>${avg(ages)}${ages.length ? "세" : ""}</b><span>평균 나이</span></div>
      <div><b>${avg(hs)}${hs.length ? "cm" : ""}</b><span>평균 키</span></div><div><b>${esc(coachOf(SQ_TEAM) || "-")}</b><span>감독</span></div>
      <div><b>${lst.filter(isForeign).length || "-"}${lst.some(isForeign) ? "명" : ""}</b><span>외국인</span></div></div>
      ${t.foreign && !lst.some(x => x.nation) ? `<div class="card"><b>🌏 외국인 선수</b><div class="hint" style="margin:6px 0 0">${esc(t.foreign)}</div></div>` : ""}`;
    POS_ORDER.concat([""]).forEach(pos => {
      const grp = lst.filter(x => pos ? x.pos === pos : !POS_ORDER.includes(x.pos));
      if (!grp.length) return;
      html += `<div class="sched-sub">${esc(POS_FULL[pos] || "기타")} <span class="hint" style="margin:0">${grp.length}명</span></div>
        <div class="pf-grid">${grp.map(x => profileCard(SQ_TEAM, x)).join("")}</div>`;
    });
    html += `<p class="hint" style="margin-top:12px">출처: ${esc((DATA.profiles || {}).source || "")} · ${esc((DATA.profiles || {}).updated_at || "")} 기준 · 사진 © SV.LEAGUE · 이름은 한글 표기 (카드를 누르면 일본어 등록명) · 하루 한 번 자동 갱신</p>`;
  }
  p.innerHTML = html;
  p.querySelectorAll("[data-sq]").forEach(b => b.onclick = () => { SQ_TEAM = b.dataset.sq; SQ_OPEN = null; renderSquad(); });
  p.querySelectorAll(".pf-card").forEach(c => c.onclick = (e) => {
    if (e.target.closest("a")) return;
    SQ_OPEN = SQ_OPEN === c.dataset.pn ? null : c.dataset.pn; renderSquad();
  });
}

/* ---------- 6. 경기장 ---------- */
let MAP = null;
function renderArenas() {
  const p = document.getElementById("panel-arenas");
  const arenas = (DATA.teams && DATA.teams.arenas) || [];
  p.innerHTML = `<h2 class="section-title">🏟️ 경기장 안내</h2><div id="map"></div>
    <p class="hint">구단마다 홈 경기장을 여러 곳 써요. 아래는 대표 경기장이고, 경기별 장소는 일정 탭에 나옵니다.</p>
    <div class="stadium-grid">${arenas.map(a => `<div class="card stadium-card" style="${a.team ? `border-top:4px solid ${colorOf(a.team)}` : ""}">
      <div class="sc-name">${esc(a.name)}</div>
      <div class="sc-team">${a.team ? `${dot(a.team)}${esc((TEAM[a.team] || {}).full || a.team)} 홈` : esc(a.note || "")}</div>
      <div class="sc-row">📍 ${esc(a.city)}</div>
      <div class="sc-row" style="color:var(--muted)">${esc(a.jp || "")}</div>
      <div class="wbtns" style="margin-top:8px">
        <a class="wbtn" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.jp || a.name)}" target="_blank" rel="noopener">🗺️ 지도</a>
        ${a.team && ticketOf(a.team) ? `<a class="wbtn ticket" href="${esc(ticketOf(a.team).url)}" target="_blank" rel="noopener">🎟️ 예매</a>` : ""}
      </div>
    </div>`).join("")}</div>`;
  setTimeout(() => {
    if (typeof L === "undefined") return;
    if (MAP) { MAP.remove(); MAP = null; }
    MAP = L.map("map", { scrollWheelZoom: false }).setView([37.2, 137.2], 5);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { attribution: "Tiles © Esri", maxZoom: 16 }).addTo(MAP);
    arenas.forEach(a => {
      const c = a.team ? colorOf(a.team) : "#94a3b8";
      L.circleMarker([a.lat, a.lng], { radius: isMine(a.team) ? 11 : 8, color: "#fff", weight: 1.5, fillColor: c, fillOpacity: .95 })
        .addTo(MAP).bindPopup(`<b>${esc(a.name)}</b><br>${esc(a.team || a.note || "")}`);
    });
  }, 30);
}

/* ---------- 7. 팀 소개 ---------- */
function teamCard(t) {
  const home = (TEAM[t.name] || {}).ticket;
  return `<div class="card team-card" style="border-top-color:${colorOf(t.name)}">
    <div class="tc-head"><span class="tc-name">${esc(t.full)}</span><span class="tc-year">${esc(t.jp || "")}</span></div>
    <div class="tc-jp">📍 ${esc(t.city)} · ${esc(t.arena)}${t.founded ? ` &nbsp;|&nbsp; 창단 ${esc(t.founded)}` : ""}</div>
    <div class="tc-jp">지난 시즌: ${esc(t.last)}</div>
    <div class="tc-intro">${esc(t.intro)}</div>
    <div class="tc-foot">감독 <b>${esc(coachOf(t.name) || "-")}</b>${t.titles && t.titles !== "-" ? ` · 🏆 ${esc(t.titles)}` : ""}</div>
    <div class="tc-foot">외국인 <b>${esc(t.foreign || "-")}</b></div>
    ${home && home.homepage ? `<div class="wbtns" style="margin-top:8px"><a class="wbtn" href="${esc(home.homepage)}" target="_blank" rel="noopener">🔗 구단 홈페이지</a><a class="wbtn ticket" href="${esc(home.url)}" target="_blank" rel="noopener">🎟️ 예매</a></div>` : ""}
  </div>`;
}
function renderTeams() {
  const p = document.getElementById("panel-teams");
  const ts = (DATA.teams && DATA.teams.teams) || [];
  const ev = DATA.events || {};
  p.innerHTML = `<h2 class="section-title">📣 팀 소개 (${ts.length}개 구단)</h2>
    <div class="card"><b>${esc(ev.title || "")}</b><div class="hint" style="margin:6px 0 0;line-height:1.7">${esc((ev.regular || {}).format || "")}<br>${esc(ev.new_rules || "")}</div></div>
    <p class="hint">2026년 11월 기준. 지난 시즌 성적순 (신규 참가 팀은 뒤).</p>
    <div class="team-grid">${ts.map(teamCard).join("")}</div>`;
}

/* ---------- 8. 기사 ---------- */
let NEWS_MINE = false;
function newsList(items) {
  return items.map(n => `<div class="card news-card">
    <div class="news-top">${n.lang === "ko" ? '<span class="news-cat" style="border:1px solid #64748b">한국어</span>' : ""}${(n.teams || []).map(t => `<span class="news-cat" style="border:1px solid ${colorOf(t)}">${esc(t)}</span>`).join("")}</div>
    <div class="news-title"><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a></div>
    <div class="news-meta"><span>${esc(n.source || "")}</span><span>${esc(n.time || "")}</span></div>
  </div>`).join("");
}
function renderNews() {
  const p = document.getElementById("panel-news");
  let items = (DATA.news && DATA.news.items) || [];
  if (NEWS_MINE && MY_TEAM) items = items.filter(n => (n.teams || []).includes(MY_TEAM));
  p.innerHTML = `<h2 class="section-title">📰 SV리그 기사</h2>
    ${MY_TEAM ? `<div class="stage-tabs"><button class="stage-chip ${!NEWS_MINE ? "active" : ""}" data-nm="0">전체</button><button class="stage-chip ${NEWS_MINE ? "active" : ""}" data-nm="1">⭐ ${esc(MY_TEAM)}</button></div>` : ""}
    ${items.length ? newsList(items) : emptyBox("아직 수집된 기사가 없어요. 자동 수집이 돌면 최근 SV리그 남자 기사가 모입니다.")}
    <p class="hint">출처: Google 뉴스 검색 (제목·링크만 표시, 본문은 각 언론사에서) · 대부분 일본어 기사예요</p>`;
  p.querySelectorAll("[data-nm]").forEach(b => b.onclick = () => { NEWS_MINE = b.dataset.nm === "1"; renderNews(); });
}

/* ---------- 0. 마이팀 ---------- */
function renderPicker() {
  const ts = (DATA.teams && DATA.teams.teams) || [];
  return `<p class="hint">응원하는 팀을 고르면 일정·순위·기사에서 그 팀이 강조돼요. (이 브라우저에만 저장)</p>
    <div class="pick-grid">${ts.map(t => `<button class="pick-team ${isMine(t.name) ? "active" : ""}" style="--tc:${colorOf(t.name)}" data-pick="${esc(t.name)}">${dot(t.name)} ${esc(t.full)}</button>`).join("")}</div>`;
}
function renderMyTeam() {
  const p = document.getElementById("panel-myteam");
  if (!MY_TEAM || !TEAM[MY_TEAM]) {
    p.innerHTML = `<h2 class="section-title">⭐ 마이팀 고르기</h2>${renderPicker()}`;
  } else {
    const t = TEAM[MY_TEAM];
    const today = todayStr();
    const games = allGames().filter(g => g.home === MY_TEAM || g.away === MY_TEAM);
    const next = games.filter(g => g.state !== "final" && g.state !== "cancel" && g.date >= today).slice(0, 4);
    const past = games.filter(g => g.state === "final").reverse();
    const cur = seasonTable();
    const me = cur ? cur.rows.find(r => r.team === MY_TEAM) : null;
    const last = (DATA.last_season && DATA.last_season.standings || []).find(r => r.team === MY_TEAM);
    const st = me && me.games ? me : last;
    const stLabel = st === me ? "이번 시즌" : "지난 시즌 정규리그";
    let html = `<div class="mt-hero" style="--tc:${colorOf(MY_TEAM)}">
      <div class="mt-top"><div><div class="mt-league">SV리그 남자 · ${esc(t.city)} · ${esc(t.arena)}</div><div class="mt-name">${esc(t.full)}</div></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><button class="btn-ghost" id="mt-change">팀 바꾸기</button>
      ${ticketOf(MY_TEAM) ? `<a class="wbtn ticket" href="${esc(ticketOf(MY_TEAM).url)}" target="_blank" rel="noopener">🎟️ 홈경기 예매</a>` : ""}</div></div>
      ${st ? `<div class="mt-stats"><div><b>${st.rank}위</b><span>${stLabel}</span></div><div><b>${st.w}승 ${st.l}패</b><span>${st.games}경기</span></div>
        <div><b>${fmtRate(st.games ? st.w / st.games : null)}</b><span>승률</span></div><div><b>${st.pts}</b><span>포인트</span></div></div>` : ""}
    </div>`;

    html += `<div class="sched-sub">📅 다음 경기</div>`;
    if (next.length) {
      html += next.map(g => {
        const dd = daysBetween(today, g.date);
        return `<div class="mt-next"><div class="mt-next-date">${dd === 0 ? "오늘" : "D-" + dd} · ${esc(dateLabel(g.date))}</div>${gameCard(g)}</div>`;
      }).join("");
    } else html += emptyBox("예정된 경기 정보가 아직 없어요.");

    if (past.length) {
      html += `<div class="sched-sub">🏐 최근 경기</div><div class="form-row">${past.slice(0, 10).reverse().map(g => {
        const mine = g.home === MY_TEAM ? +g.sh : +g.sa, op = g.home === MY_TEAM ? +g.sa : +g.sh;
        return `<span class="form-chip ${mine > op ? "W" : "L"}" title="${esc(g.date)}">${mine > op ? "승" : "패"}</span>`;
      }).join("")}</div>
      <div class="card"><table class="rank mt-results"><tbody>${past.slice(0, 8).map(g => {
        const home = g.home === MY_TEAM, opp = home ? g.away : g.home;
        const mine = home ? +g.sh : +g.sa, op = home ? +g.sa : +g.sh;
        return `<tr><td class="mt-date">${esc(g.date.slice(5).replace("-", "/"))}</td><td>${home ? "vs" : "@"} ${dot(opp)}${esc(opp)} <span class="hint">${esc(roundLabel(g))}</span></td>
          <td class="num"><span class="form-chip sm ${mine > op ? "W" : "L"}">${mine > op ? "승" : "패"}</span> <b>${mine}:${op}</b></td></tr>`;
      }).join("")}</tbody></table></div>`;
    }

    const regPast = past.filter(g => g.kind === "regular");
    if (regPast.length) {
      const h2h = {};
      regPast.forEach(g => {
        const home = g.home === MY_TEAM, opp = home ? g.away : g.home;
        const win = (home ? +g.sh : +g.sa) > (home ? +g.sa : +g.sh);
        h2h[opp] = h2h[opp] || { w: 0, l: 0 }; win ? h2h[opp].w++ : h2h[opp].l++;
      });
      html += `<div class="sched-sub">⚔️ 상대 전적 (정규리그)</div><div class="card">${Object.entries(h2h).map(([o, r]) =>
        `<div class="bar-row"><span>${dot(o)}${esc(o)}</span><div class="bar"><i style="width:${(r.w / (r.w + r.l)) * 100}%"></i></div><b>${r.w}승 ${r.l}패</b></div>`).join("")}</div>`;
    }

    html += `<div class="sched-sub">📣 팀 정보</div>${teamCard(t)}`;
    const news = ((DATA.news && DATA.news.items) || []).filter(n => (n.teams || []).includes(MY_TEAM)).slice(0, 5);
    if (news.length) html += `<div class="sched-sub">📰 ${esc(MY_TEAM)} 기사</div>${newsList(news)}`;
    p.innerHTML = html;
    p.querySelector("#mt-change").onclick = () => { p.innerHTML = `<h2 class="section-title">⭐ 마이팀 바꾸기</h2>${renderPicker()}<button class="btn-ghost danger" id="mt-clear" style="margin-top:12px">마이팀 해제</button>`; bindPicker(p); p.querySelector("#mt-clear").onclick = () => { saveMyTeam(null); if (SCHED_FILTER === "mine") SCHED_FILTER = "all"; renderAll(); }; };
  }
  bindPicker(p);
}
function bindPicker(root) {
  root.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { saveMyTeam(b.dataset.pick); renderAll(); showTab("myteam"); });
}
function updateChip() {
  const c = document.getElementById("myteam-chip");
  c.textContent = MY_TEAM ? `⭐ ${MY_TEAM}` : "⭐ 마이팀 설정";
  if (MY_TEAM) document.documentElement.style.setProperty("--mine", colorOf(MY_TEAM));
  else document.documentElement.style.removeProperty("--mine");
}

/* ---------- 경기 상세 · 미리보기 ---------- */
const GM = { gid: null };
function openGame(gid) {
  GM.gid = gid;
  document.body.classList.add("gm-lock");
  document.getElementById("game-modal").classList.add("open");
  renderGameModal();
}
function closeGame() {
  GM.gid = null;
  document.body.classList.remove("gm-lock");
  document.getElementById("game-modal").classList.remove("open");
}
function teamForm(team, before, n = 5) {
  return allGames().filter(g => g.state === "final" && (g.home === team || g.away === team) && (!before || g.date < before)).slice(-n).map(g => {
    const mine = g.home === team ? +g.sh : +g.sa, op = g.home === team ? +g.sa : +g.sh;
    return { g, win: mine > op, mine, op, opp: g.home === team ? g.away : g.home };
  });
}
function renderGameModal() {
  const body = document.getElementById("gm-body");
  if (!GM.gid || !body) return;
  const g = allGames().find(x => x.gid === GM.gid);
  if (!g) { body.innerHTML = emptyBox("경기 정보를 찾을 수 없어요."); return; }
  const A = g.away, H = g.home;
  const live = g.state === "live", fin = g.state === "final", sched = g.state === "scheduled";
  const today = todayStr(), dd = daysBetween(today, g.date);
  const cur = seasonTable();
  const last = (DATA.last_season && DATA.last_season.standings) || [];
  const rowOf = (t) => cur ? cur.rows.find(r => r.team === t) : null;
  const lastOf = (t) => last.find(r => r.team === t);
  const mid = sched ? `<b class="td-vs">VS</b>` : `<b>${g.sa ?? "-"}<i>:</i>${g.sh ?? "-"}</b>`;
  const statusLine = live ? `<span class="live-dot"></span> ${esc(g.status || "경기 중")} · 1~2분마다 갱신`
    : sched ? `${dd === 0 ? "오늘 경기" : dd > 0 ? `D-${dd}` : ""} · 경기 미리보기` : esc(g.status || "");
  let html = `<div class="gm-head">
      <div class="gm-meta">${esc(dateLabel(g.date))} ${esc(g.time || "")} · ${esc(g.venue || "장소 미정")} · ${esc(roundLabel(g))}</div>
      <div class="gm-score">
        <div class="gm-t ${sched || +g.sa > +g.sh ? "win" : ""}">${dot(A)}${esc(A)}<small>원정</small></div>
        ${mid}
        <div class="gm-t ${sched || +g.sh > +g.sa ? "win" : ""}">${dot(H)}${esc(H)}<small>홈</small></div>
      </div>
      <div class="td-status ${live ? "on" : ""}">${statusLine}</div>
      ${watchLinks(g, true)}
    </div>`;

  if (Array.isArray(g.sets) && g.sets.length) {
    const tot = (side) => g.sets.reduce((s, x) => s + (+x[side]), 0);
    html += `<table class="gm-line"><thead><tr><th></th>${g.sets.map((s, i) => `<th>${i + 1}세트</th>`).join("")}<th>세트</th><th>총점</th></tr></thead><tbody>
      <tr><td class="team">${dot(A)}${esc(A)}</td>${g.sets.map(s => `<td class="${+s[1] > +s[0] ? "scored" : ""}">${s[1]}</td>`).join("")}<td class="tot">${g.sa ?? "-"}</td><td>${tot(1)}</td></tr>
      <tr><td class="team">${dot(H)}${esc(H)}</td>${g.sets.map(s => `<td class="${+s[0] > +s[1] ? "scored" : ""}">${s[0]}</td>`).join("")}<td class="tot">${g.sh ?? "-"}</td><td>${tot(0)}</td></tr>
    </tbody></table>`;
  } else if (live) html += emptyBox("세트 점수를 기다리는 중이에요. 1~2분 뒤 자동으로 나타나요.");

  // 두 팀 성적 비교
  const statBox = (t) => {
    const r = rowOf(t), l = lastOf(t), f = teamForm(t, fin ? g.date : null);
    return `<div class="card gm-card pv-team" style="border-top:3px solid ${colorOf(t)}">
      <div class="mt-ph">${dot(t)}${esc(t)}</div>
      ${r && r.games ? `<div class="pv-big">${r.rank}<small>위</small></div><div class="pv-sub">${r.w}승 ${r.l}패 · 승률 ${fmtRate(r.rate != null ? r.rate : r.w / r.games)} · ${r.pts}포인트</div>`
          : `<div class="pv-big">-</div><div class="pv-sub">아직 경기 없음</div>`}
      <div class="pv-sub">${l ? `지난 시즌 정규 ${l.rank}위 (${l.w}승 ${l.l}패)` : "올 시즌 SV리그 신규 참가"}</div>
      <div class="form-row" style="margin:8px 0 0">${f.length ? f.map(x => `<span class="form-chip sm ${x.win ? "W" : "L"}" title="${esc(x.g.date)} vs ${esc(x.opp)} ${x.mine}:${x.op}">${x.win ? "승" : "패"}</span>`).join("") : '<span class="hint" style="margin:0">이전 경기 없음</span>'}</div>
      <div class="pv-sub" style="margin-top:2px">${fin ? "이 경기 전" : "최근"} ${f.length}경기</div>
    </div>`;
  };
  html += `<div class="sched-sub">📊 두 팀 지금 <span class="hint" style="margin:0">순위는 현재 기준</span></div><div class="gm-two">${statBox(A)}${statBox(H)}</div>`;

  // 맞대결
  const meet = allGames().filter(x => x.state === "final" && x.gid !== g.gid && ((x.home === A && x.away === H) || (x.home === H && x.away === A)));
  const all = fin ? meet.concat([g]).sort((a, b) => a.date.localeCompare(b.date)) : meet;
  const aw = all.filter(x => (x.home === A ? +x.sh : +x.sa) > (x.home === A ? +x.sa : +x.sh)).length;
  html += `<div class="sched-sub">⚔️ 이번 시즌 맞대결</div><div class="card">`;
  if (all.length) {
    html += `<div class="pv-h2h"><span>${dot(A)}<b>${esc(A)}</b></span><b class="pv-h2h-n">${aw} : ${all.length - aw}</b><span><b>${esc(H)}</b>${dot(H)}</span></div>
      ${all.slice().reverse().map(x => {
        const sa = x.home === A ? x.sh : x.sa, sh = x.home === A ? x.sa : x.sh;
        return `<div class="mt-pl ${x.gid === g.gid ? "" : "clickable"}" ${x.gid === g.gid ? "" : `data-gid="${esc(x.gid)}"`}><span class="mt-date">${esc(x.date.slice(5).replace("-", "/"))} · ${esc(roundLabel(x))} · ${esc(x.home)} 홈</span><span class="num"><b>${sa} : ${sh}</b>${x.gid === g.gid ? " (이 경기)" : " ›"}</span></div>`;
      }).join("")}`;
  } else html += `<div class="hint" style="margin:0">이번 시즌 첫 맞대결이에요.</div>`;
  const left = allGames().filter(x => x.state === "scheduled" && x.gid !== g.gid && ((x.home === A && x.away === H) || (x.home === H && x.away === A)));
  if (left.length) html += `<div class="pv-note">📅 남은 맞대결: ${left.map(x => `${esc(x.date.slice(5).replace("-", "/"))} (${esc(x.home)} 홈)`).join(" · ")}</div>`;
  const ps = ((DATA.last_season || {}).postseason || []).filter(st =>
    (st.series || []).some(x => [x.home, x.away].includes(A) && [x.home, x.away].includes(H)) || (st.summary && st.summary.includes(A) && st.summary.includes(H)));
  if (ps.length) html += `<div class="pv-note">📜 지난 시즌 ${ps.map(st => `${esc(st.stage)}에서 만나 <b>${esc(st.winner)}</b> 승리`).join(" · ")}</div>`;
  html += `</div>`;

  // 외국인 선수
  const fx = (t) => esc((TEAM[t] || {}).foreign || "-").replace(/, /g, "<br>");
  html += `<div class="sched-sub">🌏 외국인 선수</div><div class="gm-two"><div class="card gm-card"><div class="mt-ph">${dot(A)}${esc(A)}</div><div class="pv-fx">${fx(A)}</div></div><div class="card gm-card"><div class="mt-ph">${dot(H)}${esc(H)}</div><div class="pv-fx">${fx(H)}</div></div></div>`;
  html += `<p class="hint" style="margin-top:10px">선발 라인업·개인 기록 등 자세한 내용은 '공식 ${fin ? "기록" : "경기 페이지"}' 버튼으로 SV리그 사이트에서 볼 수 있어요 (일본어).</p>`;
  body.innerHTML = html;
}

/* ---------- 순위 변동 그래프 ---------- */
let RC_MODE = "rank", RC_FOCUS = null;
function rankHistory() {
  const reg = allGames().filter(g => g.kind === "regular" && g.state === "final");
  if (!reg.length) return null;
  const teams = Object.keys(TEAM);
  const dates = [...new Set(reg.map(g => g.date))].sort();
  return dates.map(d => {
    const rows = computeTable(reg.filter(g => g.date <= d), teams);
    return { date: d, rows: Object.fromEntries(rows.map(r => [r.team, { rank: r.rank, pts: r.pts, w: r.w, l: r.l }])) };
  });
}
function rankChartHtml() {
  const hist = rankHistory();
  if (!hist || hist.length < 2) return `<div class="sched-sub">📈 순위 변동</div>` + emptyBox("경기일이 이틀 이상 쌓이면 순위 변동 그래프가 나와요.");
  const teams = Object.keys(TEAM);
  if (!RC_FOCUS || !teams.includes(RC_FOCUS)) RC_FOCUS = (MY_TEAM && teams.includes(MY_TEAM)) ? MY_TEAM : Object.entries(hist[hist.length - 1].rows).sort((a, b) => a[1].rank - b[1].rank)[0][0];
  const isRank = RC_MODE === "rank";
  // 숨겨진 탭에서도 그려지므로 화면 너비 기준 (본문 최대 1080px, 여백·카드 안쪽 여백 제외)
  const W = Math.round(Math.max(300, Math.min(720, Math.min(window.innerWidth, 1080) - 66))), H = W < 480 ? 330 : 310, pL = 26, pR = W < 480 ? 104 : 122, pT = 14, pB = 26;
  const n = hist.length;
  const maxPts = Math.max(3, ...hist.flatMap(h => Object.values(h.rows).map(r => r.pts)));
  const x = (i) => pL + (W - pL - pR) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => isRank ? pT + (H - pT - pB) * (v - 1) / (teams.length - 1) : pT + (H - pT - pB) * (1 - v / maxPts);
  const val = (r) => isRank ? r.rank : r.pts;
  const ticks = isRank ? teams.map((_, i) => i + 1) : [0, Math.round(maxPts / 2), maxPts];
  const xt = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  const ends = teams.map(t => ({ t, y: y(val(hist[n - 1].rows[t])) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  const over = ends[ends.length - 1].y - (H - pB);   // 아래로 넘친 만큼 위로 당김
  if (over > 0) ends.forEach(e => { e.y -= over; });
  const endY = Object.fromEntries(ends.map(e => [e.t, e.y]));
  const order = teams.filter(t => t !== RC_FOCUS).concat([RC_FOCUS]);
  const lines = order.map(t => {
    const f = t === RC_FOCUS, c = f ? colorOf(t) : "#475569";
    const d = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val(h.rows[t])).toFixed(1)}`).join("");
    const lastR = hist[n - 1].rows[t];
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f ? 3 : 1.5}" stroke-linejoin="round" stroke-linecap="round" opacity="${f ? 1 : .9}"/>
      ${f ? hist.map((h, i) => `<circle cx="${x(i)}" cy="${y(val(h.rows[t]))}" r="4" fill="${c}" stroke="#1c2230" stroke-width="2"/>`).join("") : ""}
      <text x="${W - pR + 8}" y="${endY[t] + 4}" class="rc-lab ${f ? "f" : ""}" ${f ? `fill="${c}"` : ""}>${esc(t)} ${isRank ? lastR.rank + "위" : lastR.pts}</text>`;
  }).join("");
  return `<div class="sched-sub">📈 ${isRank ? "순위" : "포인트"} 변동 <span style="margin-left:auto;display:flex;gap:6px">
      <button class="stage-chip ${isRank ? "active" : ""}" data-rcm="rank">순위</button><button class="stage-chip ${!isRank ? "active" : ""}" data-rcm="pts">포인트</button></span></div>
    <div class="card">
      <div class="stage-tabs" style="margin-bottom:8px">${teams.map(t => `<button class="stage-chip ${t === RC_FOCUS ? "active" : ""}" data-rcf="${esc(t)}" style="${t === RC_FOCUS ? `background:${colorOf(t)};border-color:${colorOf(t)};color:#0b0f17` : ""}">${esc(t)}</button>`).join("")}</div>
      <div class="rc-wrap" data-n="${n}" data-w="${W}" data-pr="${pR}">
      <svg viewBox="0 0 ${W} ${H}" class="rc-svg" role="img" aria-label="${isRank ? "순위" : "포인트"} 변동 그래프">
        ${ticks.map(v => `<line x1="${pL}" x2="${W - pR}" y1="${y(v)}" y2="${y(v)}" class="flow-grid"/><text x="${pL - 6}" y="${y(v) + 4}" class="rc-tick" text-anchor="end">${v}</text>`).join("")}
        ${xt.map(i => `<text x="${x(i)}" y="${H - 6}" class="rc-tick" text-anchor="middle">${hist[i].date.slice(5).replace("-", "/")}</text>`).join("")}
        ${lines}
        <line class="rc-cross" x1="0" x2="0" y1="${pT}" y2="${H - pB}" style="display:none"/>
      </svg>
      <div class="flow-tip rc-tip" style="display:none"></div></div>
      <div class="hint" style="margin:6px 0 0">선택한 팀만 색으로 강조 · 그래프를 훑으면 그날의 전체 순위 · 팀마다 치른 경기 수가 다를 수 있어요</div>
    </div>`;
}
function bindRankChart(root) {
  root.querySelectorAll("[data-rcm]").forEach(b => b.onclick = () => { RC_MODE = b.dataset.rcm; renderStandings(); });
  root.querySelectorAll("[data-rcf]").forEach(b => b.onclick = () => { RC_FOCUS = b.dataset.rcf; renderStandings(); });
  const w = root.querySelector(".rc-wrap");
  if (!w) return;
  const hist = rankHistory(), n = hist.length, svg = w.querySelector("svg"), tip = w.querySelector(".rc-tip"), cross = w.querySelector(".rc-cross");
  const W = +w.dataset.w, pL = 26, pR = +w.dataset.pr;
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), sc = r.width / W;
    const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / sc;
    const i = Math.max(0, Math.min(n - 1, Math.round((cx - pL) / ((W - pL - pR) / Math.max(1, n - 1)))));
    const px = pL + (W - pL - pR) * (n === 1 ? 0.5 : i / (n - 1));
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
    const rows = Object.entries(hist[i].rows).sort((a, b) => a[1].rank - b[1].rank);
    tip.innerHTML = `<b>${esc(dateLabel(hist[i].date))}</b>` + rows.map(([t, v]) => `<div class="${t === RC_FOCUS ? "f" : ""}">${v.rank}. ${dot(t)}${esc(t)} <span>${v.w}승 ${v.l}패 · ${v.pts}P</span></div>`).join("");
    tip.style.display = "";
    tip.style.left = Math.min(Math.max(px * sc, 95), r.width - 95) + "px";
  };
  const hide = () => { tip.style.display = "none"; cross.style.display = "none"; };
  w.addEventListener("mousemove", move); w.addEventListener("touchstart", move, { passive: true }); w.addEventListener("touchmove", move, { passive: true });
  w.addEventListener("mouseleave", hide);
}

/* ---------- 탭 · 전체 렌더 ---------- */
const RENDER = { myteam: renderMyTeam, schedule: renderSchedule, standings: renderStandings, cs: renderCS, players: renderPlayers, squad: renderSquad, arenas: renderArenas, teams: renderTeams, news: renderNews };
let CUR_TAB = "schedule";
function showTab(name) {
  CUR_TAB = name;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "arenas") renderArenas();
  try { history.replaceState(null, "", "#" + name); } catch (e) { }
}
function renderAll() {
  buildTeamMap();
  updateChip();
  Object.entries(RENDER).forEach(([k, fn]) => { if (k !== "arenas") { try { fn(); } catch (e) { console.error(k, e); document.getElementById("panel-" + k).innerHTML = emptyBox("이 탭을 그리다 오류가 났어요: " + e.message); } } });
  if (CUR_TAB === "arenas") renderArenas();
  if (GM.gid) renderGameModal();
  const m = DATA.meta || {};
  document.getElementById("updated-at").textContent = `갱신: ${m.updated_at_kst || "—"}`;
}

/* 경기가 있는 날엔 화면을 띄워 둔 채로도 75초마다 새 데이터를 받아 온다 */
function scheduleRefresh() {
  setInterval(async () => {
    if (document.hidden) return;
    const today = todayStr();
    if (!allGames().some(g => g.date === today && g.state !== "final" && g.state !== "cancel")) return;
    await loadAll(); renderAll();
  }, 75 * 1000);
}

(async function init() {
  loadMyTeam();
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => showTab(t.dataset.tab));
  document.getElementById("myteam-chip").onclick = () => showTab("myteam");
  document.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const mp = e.target.closest("#gm-body .mt-pl.clickable[data-gid]");
    if (mp) { openGame(mp.dataset.gid); return; }
    const c = e.target.closest(".game.clickable[data-gid]");
    if (c) openGame(c.dataset.gid);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeGame();
    if (e.key === "Enter" && e.target.matches && e.target.matches(".game.clickable[data-gid]")) openGame(e.target.dataset.gid);
  });
  await loadAll();
  renderAll();
  const h = (location.hash || "").slice(1);
  showTab(RENDER[h] ? h : (MY_TEAM ? "myteam" : "schedule"));
  document.getElementById("loader").classList.add("hide");
  scheduleRefresh();
})();
