import { ensureChromeStyles } from "./chromeStyles.js";
import {
  chromeStrings,
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";

export interface ModelBarOptions {
  locale?: ViewerLocale;
  onChange?: (modelId: string) => void;
}

/** Top-left model label + select overlay for the embed viewer. */
export class ModelBar {
  readonly el: HTMLElement;
  private labelEl: HTMLLabelElement;
  private select: HTMLSelectElement;
  private onChange?: (modelId: string) => void;
  private suppress = false;
  private locale: ViewerLocale;

  constructor(parent: HTMLElement, options: ModelBarOptions = {}) {
    this.onChange = options.onChange;
    this.locale = options.locale ?? detectViewerLocale();
    ensureChromeStyles();

    this.el = document.createElement("div");
    this.el.className = "svg3dx-model-bar";
    this.el.style.cssText = [
      "display:none",
      "align-items:center",
      "gap:6px",
      "padding:4px 8px",
      "pointer-events:auto",
      "user-select:none",
      "align-self:flex-start",
    ].join(";");

    this.labelEl = document.createElement("label");
    this.labelEl.style.cssText = "font-weight:600;white-space:nowrap;";
    this.labelEl.htmlFor = "svg3dx-model-select";

    this.select = document.createElement("select");
    this.select.id = "svg3dx-model-select";
    this.select.style.cssText = [
      "min-width:7rem",
      "max-width:14rem",
      "padding:2px 6px",
    ].join(";");
    this.select.addEventListener("change", () => {
      if (this.suppress) return;
      const id = this.select.value;
      if (id) this.onChange?.(id);
    });

    // Keep orbit / pick from seeing UI gestures.
    for (const type of ["pointerdown", "pointerup", "wheel", "click"] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }

    this.el.append(this.labelEl, this.select);
    parent.appendChild(this.el);
    this.applyLocale();
  }

  setLocale(locale: ViewerLocale): void {
    this.locale = locale;
    this.applyLocale();
  }

  private applyLocale(): void {
    this.labelEl.textContent = chromeStrings(this.locale).model;
  }

  /**
   * Refresh options from evaluation models.
   * Hidden when there are no models.
   */
  setModels(models: { id: string }[], activeId: string | null | undefined): void {
    this.suppress = true;
    try {
      this.select.replaceChildren();
      if (!models.length) {
        this.el.style.display = "none";
        return;
      }

      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.id;
        this.select.appendChild(opt);
      }

      const ids = new Set(models.map((m) => m.id));
      const next =
        activeId && ids.has(activeId) ? activeId : models[0]!.id;
      this.select.value = next;
      this.el.style.display = "flex";
    } finally {
      this.suppress = false;
    }
  }

  getValue(): string | null {
    return this.select.value || null;
  }

  dispose(): void {
    this.el.remove();
  }
}
