/* Theme: Auto (follow the device), Light, or Dark.
   Loaded in <head> so the chosen theme applies before the page paints.
   Any element with [data-theme-toggle] gets a three-way switch. Pages listen
   for the "him-themechange" event to recolor charts. */
(() => {
  "use strict";
  const KEY = "him-theme";
  const root = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; }
  }
  function write(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* private mode: still works for this visit */ }
  }
  function apply(value) {
    if (value === "light" || value === "dark") root.setAttribute("data-theme", value);
    else root.removeAttribute("data-theme");
    document.dispatchEvent(new CustomEvent("him-themechange"));
  }

  let current = read();
  apply(current);

  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
  if (media && media.addEventListener) {
    media.addEventListener("change", () => { if (current === "auto") apply("auto"); });
  }

  const ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  };
  const LABELS = { auto: "Auto theme", light: "Light theme", dark: "Dark theme" };

  function mount() {
    document.querySelectorAll("[data-theme-toggle]").forEach((host) => {
      host.classList.add("theme-toggle");
      host.setAttribute("role", "group");
      host.setAttribute("aria-label", "Theme");
      host.replaceChildren();
      for (const mode of ["auto", "light", "dark"]) {
        const b = document.createElement("button");
        b.type = "button";
        b.title = LABELS[mode];
        b.setAttribute("aria-label", LABELS[mode]);
        b.setAttribute("aria-pressed", String(mode === current));
        b.innerHTML = ICONS[mode];
        b.addEventListener("click", () => {
          current = mode;
          write(mode);
          apply(mode);
          document.querySelectorAll("[data-theme-toggle] button").forEach((x, i) => {
            x.setAttribute("aria-pressed", String(["auto", "light", "dark"][i % 3] === mode));
          });
        });
        host.appendChild(b);
      }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
