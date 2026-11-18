/** Shared overlay chrome tokens (Model / Params bars). Hosts can override via CSS vars. */
const STYLE_ID = "svg3dx-viewer-chrome-styles";

const CSS = `
.svg3dx-model-bar,
.svg3dx-params-bar,
.svg3dx-display-mode-bar {
  background: var(--svg3dx-chrome-bg, rgba(255, 255, 255, 0.92));
  border: 1px solid var(--svg3dx-chrome-border, #c5ced8);
  border-radius: 6px;
  box-shadow: 0 1px 2px var(--svg3dx-chrome-shadow, rgba(15, 23, 42, 0.06));
  font: 12px/1.3 system-ui, sans-serif;
  color: var(--svg3dx-chrome-fg, #1f2937);
}

.svg3dx-model-bar select,
.svg3dx-params-bar input[type="text"],
.svg3dx-params-bar input[type="number"] {
  border: 1px solid var(--svg3dx-chrome-border, #c5ced8);
  border-radius: 4px;
  background: var(--svg3dx-chrome-input-bg, #fff);
  color: inherit;
  font: inherit;
}

.svg3dx-params-bar__body {
  border-top: 1px solid var(--svg3dx-chrome-divider, #e5eaf0);
}

.svg3dx-kernel-host {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--svg3dx-kernel-bg, transparent);
}

.svg3dx-kernel-host > svg {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  flex: 0 0 auto;
}
`;

/** Inject once; safe to call from multiple chrome widgets. */
export function ensureChromeStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}
