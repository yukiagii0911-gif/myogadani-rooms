// Instagram風 outline-style SVG icons (24x24 grid, stroke 1.6)
export const ICONS = {
  account: `<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.5"/><path d="M5 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/></svg>`,
  "account-plus": `<svg viewBox="0 0 24 24"><circle cx="10" cy="9" r="3.5"/><path d="M3 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/><path d="M18 5v6M15 8h6"/></svg>`,
  "enter-room": `<svg viewBox="0 0 24 24"><rect x="11" y="4" width="9" height="16" rx="1.5"/><path d="M11 12H4"/><path d="M7 9l-3 3 3 3"/></svg>`,
  "exit-room": `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="9" height="16" rx="1.5"/><path d="M13 12h7"/><path d="M17 9l3 3-3 3"/></svg>`,
  bookmark: `<svg viewBox="0 0 24 24"><path d="M7 4h10v17l-5-3.5L7 21V4z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24"><path d="M12 21c-4.5-5-7-7.5-7-11a7 7 0 0 1 14 0c0 3.5-2.5 6-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
  floor: `<svg viewBox="0 0 24 24"><path d="M4 18h4v-4h4v-4h4V6h4"/></svg>`,
  bell: `<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2H4.5L6 16z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`,
  filter: `<svg viewBox="0 0 24 24"><path d="M3 5h18l-7 9v6l-4-2v-4L3 5z"/></svg>`,
  search: `<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15 15l5 5"/></svg>`,
  building: `<svg viewBox="0 0 24 24"><path d="M4 21V6a1 1 0 0 1 1-1h6v16M11 21V3a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v18M4 21h17M7 9h2M7 13h2M7 17h2M14 6h3M14 10h3M14 14h3M14 18h3"/></svg>`,
  list: `<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01"/></svg>`,
  map: `<svg viewBox="0 0 24 24"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v16M15 6v16"/></svg>`,
  clock: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  people: `<svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.5"/><path d="M15 20c0-2.5 1.5-4.5 4-4.5s2 2 2 4.5"/></svg>`,
  "in-room": `<svg viewBox="0 0 24 24"><path d="M3 12l5-5 5 5"/><path d="M8 7v13"/><path d="M14 4h6v16h-6"/></svg>`,
  check: `<svg viewBox="0 0 24 24"><path d="M5 12l5 5L20 7"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>`,
  "chevron-down": `<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
};

/**
 * 指定された要素配下の data-icon 属性を持つすべての要素にアイコンを注入する
 */
export function injectIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    if (ICONS[name]) {
      el.innerHTML = ICONS[name];
    }
  });
}
