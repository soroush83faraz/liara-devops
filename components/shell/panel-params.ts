// Pure helpers for the `?service=&tab=` deep link. Kept free of React/Next so they can be unit-tested.

export interface PanelParams {
  service?: string;
  tab?: string;
}

const SERVICE_RE = /^[\w.:@-]{1,128}$/;
const TAB_RE = /^[a-z0-9_-]{1,32}$/i;

/** Read and validate the deep-link params; anything malformed is ignored. */
export function parsePanelParams(search: string | URLSearchParams): PanelParams {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  const service = sp.get("service");
  const tab = sp.get("tab");
  const out: PanelParams = {};
  if (service && SERVICE_RE.test(service)) {
    out.service = service;
    if (tab && TAB_RE.test(tab)) out.tab = tab;
  }
  return out;
}

/** Apply panel state to an existing query string, preserving unrelated params. Returns "" or "?a=b". */
export function buildPanelSearch(currentSearch: string, panel: { open: boolean; service?: string; tab?: string }): string {
  const sp = new URLSearchParams(currentSearch);
  sp.delete("service");
  sp.delete("tab");
  if (panel.open && panel.service) {
    sp.set("service", panel.service);
    if (panel.tab) sp.set("tab", panel.tab);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
