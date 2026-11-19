import { ensureChromeStyles } from "./chromeStyles.js";
import {
  chromeStrings,
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";

/** MSAA sample count for EffectComposer render targets. */
export type AntialiasLevel = 0 | 2 | 4 | 8;

export interface ViewerUiState {
  settingsButton: boolean;
  modelBar: boolean;
  paramsBar: boolean;
  viewHelper: boolean;
  axesHelper: boolean;
  planeHelper: boolean;
  antialias: AntialiasLevel;
  /** Browser-native SVG pane (plain SVG only). */
  kernel: boolean;
  /** Three.js canvas (plain SVG only). */
  svg3dx: boolean;
}

export interface SettingsBarOptions {
  initial: ViewerUiState;
  locale?: ViewerLocale;
  /** Show Kernel / svg3dx rows (plain SVG documents). */
  showDisplayModes?: boolean;
  onChange?: (state: ViewerUiState) => void;
}

const AA_LEVELS: AntialiasLevel[] = [0, 2, 4, 8];

/**
 * Top-left gear menu for overlay / helper / antialias visibility.
 * The settings-button toggle can hide this control itself.
 */
export class SettingsBar {
  readonly el: HTMLElement;
  private btn: HTMLButtonElement;
  private panel: HTMLElement;
  private locale: ViewerLocale;
  private state: ViewerUiState;
  private showDisplayModes: boolean;
  private onChange?: (state: ViewerUiState) => void;
  private open = false;
  private suppress = false;
  private rows = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private displayModeSection: HTMLElement;
  private onDocPointerDown: ((e: PointerEvent) => void) | null = null;

  constructor(parent: HTMLElement, options: SettingsBarOptions) {
    this.state = { ...options.initial };
    this.locale = options.locale ?? detectViewerLocale();
    this.showDisplayModes = options.showDisplayModes === true;
    this.onChange = options.onChange;
    ensureChromeStyles();

    this.el = document.createElement("div");
    this.el.className = "svg3dx-settings-bar";
    this.el.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "align-items:flex-start",
      "align-self:flex-start",
      "pointer-events:none",
      "z-index:3",
    ].join(";");

    const frame = document.createElement("div");
    frame.className = "svg3dx-settings-bar__frame";
    frame.style.cssText = [
      "pointer-events:auto",
      "display:flex",
      "flex-direction:column",
      "align-items:stretch",
      "min-width:28px",
      "overflow:hidden",
    ].join(";");

    this.btn = document.createElement("button");
    this.btn.type = "button";
    this.btn.className = "svg3dx-settings-bar__btn";
    this.btn.setAttribute("aria-haspopup", "true");
    this.btn.setAttribute("aria-expanded", "false");
    this.btn.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "align-self:flex-start",
      "width:28px",
      "height:28px",
      "margin:0",
      "padding:0",
      "border:0",
      "background:transparent",
      "cursor:pointer",
      "font:inherit",
      "color:inherit",
      "border-radius:0",
      "box-shadow:none",
    ].join(";");
    // Gear / settings cog (filled), similar to common Setting icons.
    this.btn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.48.48 0 0 0 14 2h-4a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.49.49 0 0 0-.59.22L2.65 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.3.59.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54c.05.24.24.41.48.41h4c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/></svg>';
    this.btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setOpen(!this.open);
    });

    this.panel = document.createElement("div");
    this.panel.className = "svg3dx-settings-bar__panel";
    this.panel.style.cssText = [
      "display:none",
      "flex-direction:column",
      "gap:2px",
      "min-width:11.5rem",
      "padding:0 0 6px",
      "user-select:none",
      "border-top:1px solid var(--svg3dx-chrome-divider, #e5eaf0)",
    ].join(";");

    this.appendToggle("settingsButton", "settingsButton");
    this.appendToggle("modelBar", "modelBar");
    this.appendToggle("paramsBar", "paramsBar");
    this.appendSeparator();
    this.appendToggle("viewHelper", "viewHelper");
    this.appendToggle("axesHelper", "axesHelper");
    this.appendToggle("planeHelper", "planeHelper");
    this.appendSeparator();
    this.appendAntialias();
    this.displayModeSection = document.createElement("div");
    this.displayModeSection.style.cssText =
      "display:none;flex-direction:column;gap:2px;";
    this.displayModeSection.appendChild(this.makeSeparator());
    this.appendToggle("kernel", "kernel", this.displayModeSection);
    this.appendToggle("svg3dx", "svg3dx", this.displayModeSection);
    this.panel.appendChild(this.displayModeSection);

    for (const type of ["pointerdown", "pointerup", "wheel", "click"] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }

    frame.append(this.btn, this.panel);
    this.el.appendChild(frame);
    parent.appendChild(this.el);
    this.applyLocale();
    this.setShowDisplayModes(this.showDisplayModes);
    this.syncButtonVisibility();
  }

  getState(): ViewerUiState {
    return { ...this.state };
  }

  setState(partial: Partial<ViewerUiState>): void {
    this.suppress = true;
    try {
      this.state = { ...this.state, ...partial };
      this.syncInputsFromState();
      this.syncButtonVisibility();
    } finally {
      this.suppress = false;
    }
  }

  setLocale(locale: ViewerLocale): void {
    this.locale = locale;
    this.applyLocale();
  }

  setShowDisplayModes(show: boolean): void {
    this.showDisplayModes = show;
    this.displayModeSection.style.display = show ? "flex" : "none";
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.panel.style.display = open ? "flex" : "none";
    this.btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) this.bindDocClose();
    else this.unbindDocClose();
  }

  /** Host can force the gear visible again after the user hid it. */
  setButtonVisible(visible: boolean): void {
    this.setState({ settingsButton: visible });
    if (visible) this.syncButtonVisibility();
  }

  dispose(): void {
    this.unbindDocClose();
    this.el.remove();
  }

  private syncButtonVisibility(): void {
    this.el.style.display = this.state.settingsButton ? "flex" : "none";
    if (!this.state.settingsButton) this.setOpen(false);
  }

  private emit(): void {
    if (this.suppress) return;
    this.onChange?.({ ...this.state });
  }

  private syncInputsFromState(): void {
    for (const [key, input] of this.rows) {
      const value = this.state[key as keyof ViewerUiState];
      if (input instanceof HTMLInputElement && input.type === "checkbox") {
        input.checked = Boolean(value);
      } else if (input instanceof HTMLSelectElement) {
        input.value = String(value);
      }
    }
  }

  private applyLocale(): void {
    const s = chromeStrings(this.locale);
    this.btn.title = s.settings;
    this.btn.setAttribute("aria-label", s.settings);
    this.labelFor("settingsButton").textContent = s.settingsButton;
    this.labelFor("modelBar").textContent = s.modelBar;
    this.labelFor("paramsBar").textContent = s.paramsBar;
    this.labelFor("viewHelper").textContent = s.viewHelper;
    this.labelFor("axesHelper").textContent = s.axesHelper;
    this.labelFor("planeHelper").textContent = s.planeHelper;
    this.labelFor("kernel").textContent = s.kernel;
    this.labelFor("svg3dx").textContent = s.svg3dx;
    const aaLabel = this.panel.querySelector(
      ".svg3dx-settings-bar__aa-label"
    ) as HTMLElement | null;
    if (aaLabel) aaLabel.textContent = s.antialias;
    const aaSelect = this.rows.get("antialias") as HTMLSelectElement | undefined;
    if (aaSelect) {
      for (const opt of Array.from(aaSelect.options)) {
        const n = Number(opt.value) as AntialiasLevel;
        opt.textContent = n === 0 ? s.antialiasNone : s.antialiasNx(n);
      }
    }
  }

  private labelFor(key: string): HTMLElement {
    return this.panel.querySelector(
      `[data-settings-label="${key}"]`
    ) as HTMLElement;
  }

  private appendToggle(
    key: keyof ViewerUiState,
    labelKey: string,
    parent: HTMLElement = this.panel
  ): void {
    const row = document.createElement("label");
    row.className = "svg3dx-settings-bar__row";
    row.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:4px 10px;cursor:pointer;white-space:nowrap;";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(this.state[key]);
    input.addEventListener("change", () => {
      if (this.suppress) return;
      this.state = { ...this.state, [key]: input.checked };
      if (key === "settingsButton") this.syncButtonVisibility();
      this.emit();
    });

    const span = document.createElement("span");
    span.dataset.settingsLabel = labelKey;

    row.append(input, span);
    parent.appendChild(row);
    this.rows.set(key, input);
  }

  private appendAntialias(): void {
    const row = document.createElement("label");
    row.className = "svg3dx-settings-bar__row";
    row.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;cursor:pointer;white-space:nowrap;";

    const span = document.createElement("span");
    span.className = "svg3dx-settings-bar__aa-label";

    const select = document.createElement("select");
    select.style.cssText = "max-width:5.5rem;padding:1px 4px;";
    for (const level of AA_LEVELS) {
      const opt = document.createElement("option");
      opt.value = String(level);
      opt.textContent = String(level);
      select.appendChild(opt);
    }
    select.value = String(this.state.antialias);
    select.addEventListener("change", () => {
      if (this.suppress) return;
      const n = Number(select.value) as AntialiasLevel;
      this.state.antialias = AA_LEVELS.includes(n) ? n : 0;
      this.emit();
    });

    row.append(span, select);
    this.panel.appendChild(row);
    this.rows.set("antialias", select);
  }

  private appendSeparator(): void {
    this.panel.appendChild(this.makeSeparator());
  }

  private makeSeparator(): HTMLElement {
    const hr = document.createElement("div");
    hr.className = "svg3dx-settings-bar__sep";
    hr.setAttribute("role", "separator");
    hr.style.cssText =
      "height:1px;margin:4px 8px;background:var(--svg3dx-chrome-divider, #e5eaf0);";
    return hr;
  }

  private bindDocClose(): void {
    if (this.onDocPointerDown) return;
    this.onDocPointerDown = (e: PointerEvent) => {
      if (!this.el.contains(e.target as Node)) this.setOpen(false);
    };
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
  }

  private unbindDocClose(): void {
    if (!this.onDocPointerDown) return;
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
    this.onDocPointerDown = null;
  }
}
