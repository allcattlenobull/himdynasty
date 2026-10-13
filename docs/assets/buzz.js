/* HIM Dynasty Buzz: news and live social posts for the whole league, one
   team, or one player. Everything from outside sources is set with
   textContent; links and images must be https. */
(() => {
  "use strict";
  const { el, dot, teamLink, assignColors } = window.HIM;

  const ESPN_PLAYER_NEWS = "https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players?limit=25&playerId=";
  const BSKY_SEARCH = "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?limit=25&sort=latest&q=";
  const SLEEPER_TRENDING = "https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=15";
  const INSIDERS = [["AdamSchefter", "Adam Schefter"], ["RapSheet", "Ian Rapoport"], ["TomPelissero", "Tom Pelissero"], ["FantasyLabsNFL", "FantasyLabs NFL"]];
  const BLOCK_LABELS = new Set(["porn", "sexual", "nudity", "graphic-media", "gore", "nsfl"]);

  let latest, news, trade;
  let players = {};      // sleeper id -> player card + owner
  let scope = { kind: "league" };
  let shown = 40;
  let socialTimer = null;

  const https = (u) => (typeof u === "string" && /^https:\/\//i.test(u) ? u : null);

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }

  function headshot(p, cls = "headshot") {
    const img = el("img", null, cls);
    img.alt = "";
    img.loading = "lazy";
    img.src = p.pos === "DEF"
      ? `https://sleepercdn.com/images/team_logos/nfl/${encodeURIComponent(String(p.id).toLowerCase())}.png`
      : `https://sleepercdn.com/content/nfl/players/thumb/${encodeURIComponent(p.id)}.jpg`;
    img.addEventListener("error", () => { img.style.visibility = "hidden"; });
    return img;
  }

  // ------------------------------------------------------------------ //
  // Scope
  // ------------------------------------------------------------------ //
  function scopePlayers() {
    if (scope.kind === "player") return [players[scope.id]].filter(Boolean);
    if (scope.kind === "team") return Object.values(players).filter((p) => String(p.owner) === String(scope.id));
    return Object.values(players);
  }

  function setScope(next, push = true) {
    scope = next;
    shown = 40;
    if (push) {
      const q = scope.kind === "team" ? `?team=${scope.id}` : scope.kind === "player" ? `?player=${scope.id}` : "";
      history.replaceState(null, "", `buzz.html${q}`);
    }
    renderScope();
    renderNews();
    renderXLinks();
    loadSocial();
    if (scope.kind === "player") loadLivePlayerNews(players[scope.id]);
  }

  function renderScope() {
    const tabs = document.getElementById("scope-tabs");
    tabs.replaceChildren();
    const b = el("button", "Whole league", scope.kind === "league" ? "chip is-current" : "chip");
    b.type = "button";
    b.addEventListener("click", () => setScope({ kind: "league" }));
    tabs.appendChild(b);
    document.getElementById("team-pick").value = scope.kind === "team" ? String(scope.id) : "";
    const title = document.getElementById("scope-title");
    title.replaceChildren();
    if (scope.kind === "league") title.textContent = `Everyone rostered in the league (${Object.keys(players).length} players)`;
    if (scope.kind === "team") {
      title.appendChild(dot(Number(scope.id)));
      title.appendChild(teamLink(Number(scope.id), latest.teams[scope.id].team.trim()));
      title.appendChild(document.createTextNode(` · ${scopePlayers().length} players`));
    }
    if (scope.kind === "player") {
      const p = players[scope.id];
      title.appendChild(headshot(p));
      title.appendChild(el("span", `${p.name} · ${p.pos} · ${p.nfl} · `, "team"));
      title.appendChild(teamLink(p.owner, latest.teams[p.owner].team.trim()));
    }
  }

  // ------------------------------------------------------------------ //
  // News
  // ------------------------------------------------------------------ //
  function newsItems() {
    const items = (news && news.items) || [];
    if (scope.kind === "league") return items;
    const ids = new Set(scopePlayers().map((p) => p.id));
    return items.filter((it) => it.players.some((id) => ids.has(id)));
  }

  function newsCard(it) {
    const card = el("article", null, "news-card");
    const who = el("div", null, "news-who");
    for (const id of it.players.slice(0, 3)) {
      const p = players[id];
      if (!p) continue;
      const chip = el("button", null, "news-player");
      chip.type = "button";
      chip.appendChild(headshot(p, "headshot small"));
      chip.appendChild(el("span", p.name, "team"));
      chip.appendChild(dot(p.owner));
      chip.title = `${p.name} · ${latest.teams[p.owner].team.trim()}`;
      chip.addEventListener("click", () => setScope({ kind: "player", id }));
      who.appendChild(chip);
    }
    who.appendChild(el("span", `${it.source} · ${ago(it.published)}`, "owner news-meta"));
    card.appendChild(who);
    card.appendChild(el("h3", it.headline, "news-headline"));
    if (it.body && it.body !== it.headline) card.appendChild(el("p", it.body, "news-body"));
    const link = https(it.link);
    if (link) {
      const a = el("a", "Read more", "news-link");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      card.appendChild(a);
    }
    return card;
  }

  function renderNews() {
    const host = document.getElementById("news");
    const items = newsItems();
    host.replaceChildren();
    if (!items.length) {
      host.appendChild(el("p", news ? "No news in the last three weeks for this scope." : "News appears after the next morning update.", "muted"));
      return;
    }
    items.slice(0, shown).forEach((it) => host.appendChild(newsCard(it)));
    if (items.length > shown) {
      const more = el("button", `Show more (${items.length - shown} left)`, "chip");
      more.type = "button";
      more.addEventListener("click", () => { shown += 40; renderNews(); });
      host.appendChild(more);
    }
  }

  async function loadLivePlayerNews(p) {
    if (!p || !p.espn_id) return;
    try {
      const res = await fetch(ESPN_PLAYER_NEWS + encodeURIComponent(p.espn_id));
      if (!res.ok) return;
      const data = await res.json();
      const have = new Set(((news && news.items) || []).map((x) => x.id));
      const fresh = [];
      for (const f of data.feed || []) {
        const id = String(f.id);
        if (have.has(id)) continue;
        fresh.push({
          id,
          published: f.published || f.lastModified,
          source: f.type === "Rotowire" ? "RotoWire via ESPN" : "ESPN",
          headline: f.headline || "",
          body: (f.story || f.description || "").slice(0, 700),
          link: (((f.links || {}).web || {}).href) || null,
          players: [p.id],
        });
      }
      if (fresh.length && scope.kind === "player" && scope.id === p.id) {
        news = news || { items: [] };
        news.items = fresh.concat(news.items).sort((a, b) => (a.published < b.published ? 1 : -1));
        renderNews();
      }
    } catch (e) { /* live news is a bonus; the nightly feed still shows */ }
  }

  // ------------------------------------------------------------------ //
  // Live social (Bluesky) and X
  // ------------------------------------------------------------------ //
  function socialTargets() {
    const list = scopePlayers().filter((p) => p.pos !== "DEF" && p.pos !== "K");
    list.sort((a, b) => (b.ppg || 0) - (a.ppg || 0));
    return list.slice(0, scope.kind === "player" ? 1 : scope.kind === "team" ? 6 : 8);
  }

  function renderXLinks() {
    const host = document.getElementById("x-links");
    host.replaceChildren();
    const targets = socialTargets();
    if (!targets.length) return;
    const query = targets.map((p) => `"${p.name}"`).join(" OR ");
    const a = el("a", `Live on X: ${scope.kind === "player" ? targets[0].name : `top ${targets.length} players`}`, "btn btn-yes small-btn");
    a.href = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
    a.target = "_blank";
    a.rel = "noopener";
    host.appendChild(a);
    document.getElementById("social-who").textContent =
      scope.kind === "player" ? targets[0].name : targets.map((p) => p.name).join(", ");
  }

  function blocked(post) {
    const labels = (post.labels || []).concat((post.author && post.author.labels) || []);
    return labels.some((l) => BLOCK_LABELS.has(l.val));
  }

  function postCard(post, matched) {
    const card = el("article", null, "social-card");
    const head = el("div", null, "social-head");
    const avatar = https(post.author.avatar);
    if (avatar) {
      const img = el("img", null, "headshot small");
      img.src = avatar;
      img.alt = "";
      img.loading = "lazy";
      head.appendChild(img);
    }
    const who = el("div");
    who.appendChild(el("div", post.author.displayName || post.author.handle, "team"));
    who.appendChild(el("div", `@${post.author.handle} · ${ago(post.indexedAt || post.record.createdAt)}`, "owner"));
    head.appendChild(who);
    if (matched) {
      const tag = el("button", matched.name, "chip mini");
      tag.type = "button";
      tag.addEventListener("click", () => setScope({ kind: "player", id: matched.id }));
      head.appendChild(tag);
    }
    card.appendChild(head);
    card.appendChild(el("p", (post.record && post.record.text) || "", "social-text"));
    const rkey = (post.uri || "").split("/").pop();
    const a = el("a", "View on Bluesky", "news-link");
    a.href = `https://bsky.app/profile/${encodeURIComponent(post.author.handle)}/post/${encodeURIComponent(rkey)}`;
    a.target = "_blank";
    a.rel = "noopener";
    card.appendChild(a);
    return card;
  }

  async function loadSocial() {
    clearTimeout(socialTimer);
    const host = document.getElementById("social");
    const targets = socialTargets();
    if (!targets.length) { host.replaceChildren(el("p", "No players to search.", "muted")); return; }
    if (!host.childElementCount) host.appendChild(el("p", "Loading live posts…", "muted"));
    const token = JSON.stringify(scope);
    const seen = new Set();
    const posts = [];
    await Promise.all(targets.map(async (p) => {
      try {
        const res = await fetch(BSKY_SEARCH + encodeURIComponent(`"${p.name}"`));
        if (!res.ok) return;
        const data = await res.json();
        const last = p.name.split(" ").slice(-1)[0].toLowerCase();
        for (const post of data.posts || []) {
          const text = ((post.record && post.record.text) || "").toLowerCase();
          if (seen.has(post.uri) || blocked(post) || !text.includes(last)) continue;
          seen.add(post.uri);
          posts.push({ post, p });
        }
      } catch (e) { /* skip this player */ }
    }));
    if (token !== JSON.stringify(scope)) return;
    posts.sort((a, b) => ((a.post.indexedAt || "") < (b.post.indexedAt || "") ? 1 : -1));
    host.replaceChildren();
    if (!posts.length) host.appendChild(el("p", "No recent posts found. Try the X button for more.", "muted"));
    posts.slice(0, 30).forEach(({ post, p }) => host.appendChild(postCard(post, scope.kind === "player" ? null : p)));
    socialTimer = setTimeout(async () => {
      if (document.hidden) return;
      host.dataset.quiet = "1"; // auto refresh: no entrance animation
      try { await loadSocial(); } finally { delete host.dataset.quiet; }
    }, 120000);
  }

  function renderXEmbed(handle) {
    const host = document.getElementById("x-embed");
    host.replaceChildren();
    const a = el("a", `Posts by @${handle}`, "twitter-timeline");
    a.href = `https://twitter.com/${handle}`;
    a.setAttribute("data-height", "560");
    a.setAttribute("data-dnt", "true");
    a.setAttribute("data-theme", getComputedStyle(document.documentElement).getPropertyValue("--scheme").trim() === "light" ? "light" : "dark");
    host.appendChild(a);
    const open = el("a", `Open @${handle} on X`, "news-link");
    open.href = `https://x.com/${handle}`;
    open.target = "_blank";
    open.rel = "noopener";
    host.appendChild(open);
    if (window.twttr && window.twttr.widgets) window.twttr.widgets.load(host);
  }

  function setupX() {
    const tabs = document.getElementById("x-tabs");
    let current = INSIDERS[0][0];
    const draw = () => {
      tabs.replaceChildren();
      for (const [handle, name] of INSIDERS) {
        const b = el("button", name, handle === current ? "chip is-current" : "chip");
        b.type = "button";
        b.addEventListener("click", () => { current = handle; draw(); renderXEmbed(handle); });
        tabs.appendChild(b);
      }
    };
    draw();
    renderXEmbed(current);
    const s = document.createElement("script");
    s.src = "https://platform.twitter.com/widgets.js";
    s.async = true;
    s.charset = "utf-8";
    document.body.appendChild(s);
  }

  // ------------------------------------------------------------------ //
  // Sleeper trending
  // ------------------------------------------------------------------ //
  async function loadTrending() {
    const host = document.getElementById("trending");
    try {
      const res = await fetch(SLEEPER_TRENDING);
      const list = await res.json();
      const known = {};
      for (const a of (trade && trade.assets) || []) if (a.kind === "player") known[a.id.slice(1)] = a;
      host.replaceChildren();
      for (const t of list) {
        const p = players[t.player_id];
        const k = known[t.player_id];
        const name = p ? p.name : k ? k.name : null;
        if (!name) continue;
        const li = el("li");
        const btn = el(p ? "button" : "span", name, p ? "linkish team" : "team");
        if (p) { btn.type = "button"; btn.addEventListener("click", () => setScope({ kind: "player", id: t.player_id })); }
        li.appendChild(btn);
        li.appendChild(el("span", ` ${(p || k).pos} · ${(p || k).nfl || "FA"} · `, "owner"));
        li.appendChild(p ? teamLink(p.owner, latest.teams[p.owner].team.trim()) : el("span", "free agent in HIM", "owner up"));
        li.appendChild(el("span", ` +${t.count.toLocaleString()}`, "owner"));
        host.appendChild(li);
      }
      if (!host.childElementCount) host.appendChild(el("li", "Nothing trending right now.", "muted"));
    } catch (e) {
      host.replaceChildren(el("li", "Sleeper trending is unavailable right now.", "muted"));
    }
  }

  // ------------------------------------------------------------------ //
  // Load
  // ------------------------------------------------------------------ //
  async function load() {
    try {
      const get = (u) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      [latest, news, trade] = await Promise.all([window.HIM.loadData(), get("data/news.json"), get("data/trade.json")]);
    } catch (err) {
      document.getElementById("updated").textContent = `Could not load league data (${err.message}).`;
      return;
    }
    assignColors(latest.standings.map((t) => t.roster_id));
    for (const [rid, t] of Object.entries(latest.teams)) {
      const r = t.roster;
      for (const p of [...r.starters.map((s) => s.player).filter(Boolean), ...r.bench, ...r.taxi, ...r.ir]) {
        players[p.id] = Object.assign({}, p, { owner: Number(rid) });
      }
    }
    if (news && news.players) {
      for (const [sid, info] of Object.entries(news.players)) if (players[sid] && !players[sid].espn_id) players[sid].espn_id = info.espn_id;
    }
    document.getElementById("updated").textContent = news
      ? `${news.items.length} stories from the last 21 days · collected ${new Date(news.generated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
      : "News collects every morning; live social works now.";

    const teamPick = document.getElementById("team-pick");
    teamPick.appendChild(el("option", "Pick a team…"));
    teamPick.firstChild.value = "";
    for (const row of latest.standings) {
      const o = el("option", latest.teams[row.roster_id].team.trim());
      o.value = String(row.roster_id);
      teamPick.appendChild(o);
    }
    teamPick.addEventListener("change", () => { if (teamPick.value) setScope({ kind: "team", id: teamPick.value }); });

    const dl = document.getElementById("player-list");
    const labelToId = {};
    Object.values(players).sort((a, b) => a.name.localeCompare(b.name)).forEach((p) => {
      const label = `${p.name} (${p.pos}, ${p.nfl}) · ${latest.teams[p.owner].team.trim()}`;
      labelToId[label] = p.id;
      const o = document.createElement("option");
      o.value = label;
      dl.appendChild(o);
    });
    const input = document.getElementById("player-pick");
    const pick = () => { const id = labelToId[input.value]; if (id) { input.value = ""; setScope({ kind: "player", id }); } };
    input.addEventListener("change", pick);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") pick(); });

    const params = new URLSearchParams(location.search);
    if (params.get("player") && players[params.get("player")]) scope = { kind: "player", id: params.get("player") };
    else if (params.get("team") && latest.teams[params.get("team")]) scope = { kind: "team", id: params.get("team") };
    setScope(scope, false);
    setupX();
    loadTrending();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadSocial(); });
  }

  load();
})();
