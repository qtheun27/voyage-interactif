/* Packs de pays. Pour en ajouter un : créer packs/{ISO3}.js sur le modèle de MLT.js et l'ajouter ici. */
export const ICONS = {
  dome:'<svg viewBox="0 0 24 24"><path d="M4 21h16v-6H4z"/><path d="M6 15a6 6 0 0 1 12 0z"/><path d="M12 9V4M10.5 5.5h3"/></svg>',
  fort:'<svg viewBox="0 0 24 24"><path d="M3 21V10h3v2h3v-2h6v2h3v-2h3v11z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/></svg>',
  boat:'<svg viewBox="0 0 24 24"><path d="M3 15h18l-3 5H6z"/><path d="M12 15V4l6 9h-6"/></svg>',
  wave:'<svg viewBox="0 0 24 24"><path d="M2 14c2.5-3 5-3 7.5 0s5 3 7.5 0 4-2 5-1v6H2z"/></svg>',
  sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="4"/><path d="M12 3v2M12 17v2M4 11h2M18 11h2M6.3 5.3l1.4 1.4M16.3 15.3l1.4 1.4M6.3 16.7l1.4-1.4M16.3 6.7l1.4-1.4"/><path d="M3 21h18"/></svg>',
  stones:'<svg viewBox="0 0 24 24"><path d="M4 21V9h4v12M16 21V9h4v12M3 8h18v-2H3z"/></svg>',
  cliff:'<svg viewBox="0 0 24 24"><path d="M3 21V8l5-3 4 4 3-2 2 14z"/><path d="M17 21h4v-3"/></svg>'
};
const LOADERS = {
  MLT: () => import("./MLT.js")
};
export async function loadPack(iso3){
  const f = LOADERS[String(iso3 || "").toUpperCase()];
  if (!f) return null;
  try { return (await f()).default; } catch(_){ return null; }
}
