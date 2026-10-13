/* HIM Dynasty motion layer. Loaded on every page after common.js.
   - Scroll reveals with staggered cascades (cards, panels, table rows),
     including content the pages render later from data.
   - Count-up numbers for stat tiles and scores.
   - Desktop only: 3D tilt with a cursor spotlight on cards, magnetic chips,
     a scroll progress bar, and staggered chart drawing.
   Everything is skipped when the device asks for reduced motion. */
(() => {
  "use strict";
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !("IntersectionObserver" in window)) return;

  const root = document.documentElement;
  root.classList.add("motion");
  const desktop = window.matchMedia("(min-width: 861px) and (pointer: fine)");

  // ---------------------------------------------------------------- //
  // Charts: draw points left to right on first render.
  // ---------------------------------------------------------------- //
  if (window.Chart && window.Chart.defaults) {
    const drawn = new WeakSet();
    const a = window.Chart.defaults.animation;
    a.duration = desktop.matches ? 700 : 450;
    a.easing = "easeOutQuart";
    a.delay = (ctx) => (ctx.type === "data" && ctx.mode === "default" && !drawn.has(ctx.chart)
      ? Math.min(ctx.dataIndex * (desktop.matches ? 12 : 6) + ctx.datasetIndex * 20, 450) : 0);
    a.onComplete = (ctx) => { if (ctx && ctx.chart) drawn.add(ctx.chart); };
  }

  // ---------------------------------------------------------------- //
  // Scroll reveals
  // ---------------------------------------------------------------- //
  const REVEAL = [
    ".panel", ".chart-card", ".pick", ".idea", ".matchup", ".tx", ".stat", ".odds-block",
    ".side-box", ".game", ".verdict-row", ".him-col", ".ass-col", ".team-hero", ".pick-chip",
    ".method li", ".news-card", ".social-card", ".an-group", ".me-bar",
    ".roster-col", ".tend-row", "tbody tr", ".butt-card", ".plan-summary",
    ".ss-card", ".ss-team-card", ".rc-award", ".rc-game", ".hof-card", ".record", ".trade-card", ".fin-chip", ".h-game", ".draft-sum-card", ".ss-matchup", ".cmp-card", ".cmp-verdict", ".duel-row", ".an-week", ".ss-waiver",
  ].join(",");
  const ROW_CAP = 10;

  function stagger(list) {
    // Cascade siblings that come into view together.
    const groups = new Map();
    for (const node of list) {
      const key = node.parentNode;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(node);
    }
    for (const nodes of groups.values()) {
      nodes.forEach((node, i) => {
        const row = node.tagName === "TR";
        const step = row ? 14 : (desktop.matches ? 40 : 28);
        const delay = Math.min(i, row ? ROW_CAP : 8) * step;
        node.style.setProperty("--rv-delay", `${delay}ms`);
        node.classList.add("in");
        countUpWithin(node, delay);
        window.setTimeout(() => {
          node.classList.remove("rv", "in");
          node.style.removeProperty("--rv-delay");
        }, delay + (row ? 380 : 560));
      });
    }
  }

  const io = new IntersectionObserver((entries) => {
    const showing = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    showing.forEach((n) => io.unobserve(n));
    if (showing.length) stagger(showing);
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.04 });

  function scan(scope) {
    if (!scope || scope.nodeType !== 1) return;
    const found = [];
    if (scope.matches && scope.matches(REVEAL)) found.push(scope);
    scope.querySelectorAll(REVEAL).forEach((n) => found.push(n));
    for (const n of found) {
      if (n.dataset.rv) continue;
      n.dataset.rv = "1";
      if (n.tagName === "TR" && n.sectionRowIndex > 14) continue;
      if (n.closest(".topbar, .modal, [data-no-motion], [data-quiet]")) continue;
      n.classList.add("rv");
      io.observe(n);
    }
  }

  // Content the pages render later (after fetching data).
  const mo = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(scan);
  });

  // ---------------------------------------------------------------- //
  // Count-up numbers
  // ---------------------------------------------------------------- //
  const COUNT = ".stat .value, .verdict-score, .mscore, .ss-big, .ss-win, .ss-team-card .ss-points";
  function countUpWithin(node, delay) {
    const targets = node.matches(COUNT) ? [node] : [...node.querySelectorAll(COUNT)];
    targets.forEach((t) => countUp(t, delay));
  }
  function countUp(node, delay) {
    if (node.dataset.counted) return;
    node.dataset.counted = "1";
    const text = node.textContent;
    const m = text.match(/-?\d[\d,]*(\.\d+)?/);
    if (!m) return;
    const target = parseFloat(m[0].replace(/,/g, ""));
    if (!isFinite(target) || target === 0) return;
    const decimals = m[1] ? m[1].length - 1 : 0;
    const commas = m[0].includes(",");
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    const fmt = (v) => {
      const s = commas ? v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : v.toFixed(decimals);
      return before + s + after;
    };
    const dur = desktop.matches ? 650 : 450;
    let start = null;
    let last = fmt(0);
    node.textContent = last;
    const tick = (now) => {
      if (node.textContent !== last) return; // the page changed it: stop
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      last = p < 1 ? fmt(target * eased) : text;
      node.textContent = last;
      if (p < 1) requestAnimationFrame(tick);
    };
    window.setTimeout(() => requestAnimationFrame(tick), delay);
  }

  // ---------------------------------------------------------------- //
  // Desktop: tilt + spotlight, magnetic chips, scroll progress
  // ---------------------------------------------------------------- //
  const TILT = ".pick, .idea, .matchup, .stat, .odds-block, .pick-chip, .news-card, .game, .roster-col, .ss-team-card, .cmp-card, .hof-card, .record, .rc-award";
  let tilted = null;
  let lastMagnet = null;
  let frame = 0;
  function resetTilt(node) {
    if (!node) return;
    node.classList.remove("tilting");
    node.style.removeProperty("transform");
  }
  function onMove(e) {
    if (!desktop.matches) return;
    const card = e.target.closest && e.target.closest(TILT);
    if (tilted && tilted !== card) { resetTilt(tilted); tilted = null; }
    if (card && !card.closest(".modal")) {
      tilted = card;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        const max = r.width > 420 ? 2 : 5;
        card.classList.add("tilting");
        card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        card.style.transform = `perspective(900px) rotateX(${((0.5 - y) * max).toFixed(2)}deg) rotateY(${((x - 0.5) * max).toFixed(2)}deg) translateY(-4px)`;
      });
    }
    const chip = e.target.closest && e.target.closest(".chip, .btn, .small-btn");
    if (lastMagnet && lastMagnet !== chip) { lastMagnet.classList.remove("magnet"); lastMagnet.style.removeProperty("translate"); }
    lastMagnet = chip || null;
    if (chip) {
      const r = chip.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
      const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      chip.classList.add("magnet");
      chip.style.translate = `${(dx * 6).toFixed(1)}px ${(dy * 5).toFixed(1)}px`;
    }
  }

  function progressBar() {
    const bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    let pending = false;
    const update = () => {
      pending = false;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
    };
    window.addEventListener("scroll", () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  function start() {
    scan(document.body);
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", () => { resetTilt(tilted); tilted = null; });
    progressBar();
    requestAnimationFrame(() => root.classList.add("motion-ready"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
