import { ensureChromeStyles } from "./chromeStyles.js";
import {
  chromeStrings,
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";

export interface DisplayModeState {
  /** Browser-native SVG rendering. */
  kernel: boolean;
  /** Three.js svg3dx / svg2d canvas. */
  svg3dx: boolean;
}

export interface DisplayModeBarOptions {
  /** Initial mode flags (default both on). */
  initial?: Partial<DisplayModeState>;
  locale?: ViewerLocale;
  onChange?: (state: DisplayModeState) => void;
}

/**
 * Top-left display-mode toggles for plain (non-svg3dx) SVG documents.
 * Labels: Kernel / 内核 = browser native SVG; svg3dx = Three.js view.
 */
export class DisplayModeBar {
  readonly el: HTMLElement;
  private titleEl: HTMLSpanElement;
  private kernelLabel: HTMLSpanElement;
  private svg3dxLabel: HTMLSpanElement;
  private kernelInput: HTMLInputElement;
  private svg3dxInput: HTMLInputElement;
  private onChange?: (state: DisplayModeState) => void;
  private suppress = false;
  private locale: ViewerLocale;

  constructor(parent: HTMLElement, options: DisplayModeBarOptions = {}) {
    this.onChange = options.onChange;
    this.locale = options.locale ?? detectViewerLocale();
    ensureChromeStyles();

    const initial: DisplayModeState = {
      kernel: options.initial?.kernel !== false,
      svg3dx: options.initial?.svg3dx !== false,
    };

    this.el = document.createElement("div");
    this.el.className = "svg3dx-display-mode-bar";
    this.el.style.cssText = [
      "display:none",
      "align-items:center",
      "flex-wrap:wrap",
      "gap:10px",
      "padding:4px 8px",
      "pointer-events:auto",
      "user-select:none",
      "align-self:flex-start",
    ].join(";");

    this.titleEl = document.createElement("span");
    this.titleEl.style.cssText = "font-weight:600;white-space:nowrap;";

    const kernel = this.makeToggle(initial.kernel);
    this.kernelInput = kernel.input;
    this.kernelLabel = kernel.labelSpan;

    const svg3dx = this.makeToggle(initial.svg3dx);
    this.svg3dxInput = svg3dx.input;
    this.svg3dxLabel = svg3dx.labelSpan;

    for (const type of ["pointerdown", "pointerup", "wheel", "click"] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }

    this.el.append(this.titleEl, kernel.row, svg3dx.row);
    parent.appendChild(this.el);
    this.applyLocale();
  }

  getState(): DisplayModeState {
    return {
      kernel: this.kernelInput.checked,
      svg3dx: this.svg3dxInput.checked,
    };
  }

  setState(state: Partial<DisplayModeState>): void {
    this.suppress = true;
    try {
      if (state.kernel !== undefined) this.kernelInput.checked = state.kernel;
      if (state.svg3dx !== undefined) this.svg3dxInput.checked = state.svg3dx;
    } finally {
      this.suppress = false;
    }
  }

  setLocale(locale: ViewerLocale): void {
    this.locale = locale;
    this.applyLocale();
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? "flex" : "none";
  }

  dispose(): void {
    this.el.remove();
  }

  private applyLocale(): void {
    const s = chromeStrings(this.locale);
    this.titleEl.textContent = s.display;
    this.kernelLabel.textContent = s.kernel;
    this.svg3dxLabel.textContent = s.svg3dx;
  }

  private makeToggle(checked: boolean): {
    row: HTMLElement;
    input: HTMLInputElement;
    labelSpan: HTMLSpanElement;
  } {
    const row = document.createElement("label");
    row.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap;";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => {
      if (this.suppress) return;
      this.onChange?.(this.getState());
    });

    const labelSpan = document.createElement("span");
    row.append(input, labelSpan);
    return { row, input, labelSpan };
  }
}
