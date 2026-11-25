import type { ParamDesc } from "./params.js";
import type { ParamMap } from "./wasm.js";
import { ensureChromeStyles } from "./chromeStyles.js";
import {
  chromeStrings,
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";

export type ParamRowState = {
  /** Has a root-scope param animation track. */
  animated?: boolean;
  /** Explicit external pin (outranks animation). */
  pinned?: boolean;
  /** Document animation clock is playing. */
  playing?: boolean;
};

export interface ParamsBarOptions {
  locale?: ViewerLocale;
  onChange?: (params: ParamMap) => void;
  /** Explicit pin for one key (outranks animation even when value equals `:root`). */
  onPin?: (name: string, value: string | number | boolean) => void;
  /** Clear a single external pin (resume animation / DOM for that key). */
  onUnpin?: (name: string) => void;
  /** Toggle document animation play / pause (from the row play icon). */
  onTogglePlay?: () => void;
  /** Start expanded (default false). */
  expanded?: boolean;
}

/** Inline SVGs — same style as SettingsBar gear (`currentColor`, 24 viewBox). */
const ICON_PLAY =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>';

/**
 * Collapsible Params overlay for the embed viewer — sits under the Model bar.
 * Lists `:root` whitelist params; edits pin external overrides (§2.5).
 */
export class ParamsBar {
  readonly el: HTMLElement;
  private headerBtn: HTMLButtonElement;
  private titleEl: HTMLSpanElement;
  private chevron: HTMLSpanElement;
  private body: HTMLElement;
  private params: ParamMap = {};
  private rowState: Record<string, ParamRowState> = {};
  private lastDescs: ParamDesc[] | undefined;
  private onChange?: (params: ParamMap) => void;
  private onPin?: (name: string, value: string | number | boolean) => void;
  private onUnpin?: (name: string) => void;
  private onTogglePlay?: () => void;
  private expanded: boolean;
  private hasParams = false;
  private locale: ViewerLocale;
  private userVisible = true;
  private documentAllowed = true;
  private inputByName = new Map<string, HTMLInputElement>();
  /** Play / pause / pin status control (one per animated row). */
  private statusBtnByName = new Map<string, HTMLButtonElement>();
  private focusedName: string | null = null;
  /** Input string at focus — blur commits only when it changed. */
  private focusSnapshot = new Map<string, string>();

  constructor(parent: HTMLElement, options: ParamsBarOptions = {}) {
    this.onChange = options.onChange;
    this.onPin = options.onPin;
    this.onUnpin = options.onUnpin;
    this.onTogglePlay = options.onTogglePlay;
    this.expanded = options.expanded === true;
    this.locale = options.locale ?? detectViewerLocale();
    ensureChromeStyles();

    this.el = document.createElement("div");
    this.el.className = "svg3dx-params-bar";
    this.el.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "min-width:11rem",
      "max-width:16rem",
      "pointer-events:auto",
      "user-select:none",
      "overflow:hidden",
    ].join(";");

    this.headerBtn = document.createElement("button");
    this.headerBtn.type = "button";
    this.headerBtn.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:8px",
      "width:100%",
      "margin:0",
      "padding:5px 8px",
      "border:0",
      "background:transparent",
      "font:inherit",
      "color:inherit",
      "cursor:pointer",
      "text-align:left",
    ].join(";");

    this.titleEl = document.createElement("span");
    this.titleEl.style.cssText = "font-weight:600;white-space:nowrap;";

    this.chevron = document.createElement("span");
    this.chevron.setAttribute("aria-hidden", "true");
    this.chevron.style.cssText =
      "font-size:10px;opacity:0.65;transition:transform 0.12s ease;";

    this.headerBtn.append(this.titleEl, this.chevron);
    this.headerBtn.addEventListener("click", () => {
      this.setExpanded(!this.expanded);
    });

    this.body = document.createElement("div");
    this.body.className = "svg3dx-params-bar__body";
    this.body.style.cssText = [
      "display:none",
      "flex-direction:column",
      "gap:6px",
      "padding:0 8px 8px",
      "max-height:min(40vh, 280px)",
      "overflow:auto",
    ].join(";");

    for (const type of ["pointerdown", "pointerup", "wheel", "click"] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }

    this.el.append(this.headerBtn, this.body);
    parent.appendChild(this.el);
    this.applyLocale();
    this.syncExpandedUi();
  }

  setLocale(locale: ViewerLocale): void {
    this.locale = locale;
    this.applyLocale();
    this.setParams(this.params, this.lastDescs, this.rowState);
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.syncExpandedUi();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setVisible(visible: boolean): void {
    this.userVisible = visible;
    this.applyVisibility();
  }

  setDocumentAllowed(allowed: boolean): void {
    this.documentAllowed = allowed;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.el.style.display =
      this.userVisible && this.documentAllowed ? "flex" : "none";
  }

  /**
   * @param committed seed ∪ explicit pins (what `onChange` will emit)
   * @param liveDisplay optional live samples for unpinned animated keys (inputs only)
   */
  setParams(
    committed: ParamMap,
    descs?: ParamDesc[],
    rowState?: Record<string, ParamRowState>,
    liveDisplay?: ParamMap
  ): void {
    const s = chromeStrings(this.locale);
    const shown: ParamMap = { ...committed, ...liveDisplay };
    const list =
      descs ??
      Object.keys(shown)
        .sort()
        .map((name) => ({
          name,
          value: shown[name]!,
          kind:
            typeof shown[name] === "number"
              ? ("number" as const)
              : typeof shown[name] === "boolean"
                ? ("boolean" as const)
                : ("string" as const),
        }));

    const nextState = rowState ?? {};
    if (
      this.lastDescs &&
      descs &&
      paramsFingerprint(this.params) === paramsFingerprint(committed) &&
      descsFingerprint(this.lastDescs) === descsFingerprint(descs) &&
      stateFingerprint(this.rowState) === stateFingerprint(nextState)
    ) {
      this.params = { ...committed };
      this.rowState = { ...nextState };
      this.lastDescs = descs;
      this.applyLiveToInputs(shown);
      this.applyRowChrome();
      return;
    }

    this.params = { ...committed };
    this.rowState = { ...nextState };
    this.lastDescs = descs;
    this.inputByName.clear();
    this.statusBtnByName.clear();

    this.hasParams = list.length > 0;
    this.body.replaceChildren();

    if (!list.length) {
      const empty = document.createElement("div");
      empty.textContent = s.noEditableParams;
      empty.style.cssText = "opacity:0.6;padding-top:6px;";
      this.body.appendChild(empty);
    } else {
      for (const d of list) {
        this.body.appendChild(this.makeRow(d, shown[d.name]));
      }
    }

    this.headerBtn.title = this.hasParams
      ? s.paramsCount(list.length)
      : s.noEditableParams;
  }

  /**
   * Update input DOM from live samples without rebuilding rows or poisoning
   * committed `this.params` (avoids accidental pins when editing another key).
   */
  updateLiveValues(
    liveDisplay: ParamMap,
    rowState?: Record<string, ParamRowState>
  ): void {
    if (rowState) this.rowState = { ...rowState };
    this.applyLiveToInputs(liveDisplay);
    this.applyRowChrome();
  }

  private applyLiveToInputs(shown: ParamMap): void {
    for (const [name, input] of this.inputByName) {
      if (name === this.focusedName) continue;
      if (!(name in shown)) continue;
      const v = shown[name];
      if (input.type === "checkbox") {
        input.checked = Boolean(v);
      } else {
        const next = String(v ?? "");
        if (input.value !== next) input.value = next;
      }
    }
  }

  private applyLocale(): void {
    this.titleEl.textContent = chromeStrings(this.locale).params;
  }

  getParams(): ParamMap {
    return { ...this.params };
  }

  dispose(): void {
    this.el.remove();
  }

  private applyRowChrome(): void {
    const s = chromeStrings(this.locale);
    for (const [name, btn] of this.statusBtnByName) {
      const st = this.rowState[name] ?? {};
      let mode = "";
      let icon = "";
      let title = "";
      if (st.pinned && st.animated) {
        mode = "unpin";
        icon = ICON_PIN;
        title = s.paramPinnedOverAnim;
      } else if (st.animated && st.playing) {
        mode = "pause";
        icon = ICON_PLAY;
        title = s.paramAnimatedPlay;
      } else if (st.animated) {
        mode = "play";
        icon = ICON_PAUSE;
        title = s.paramAnimatedPause;
      }
      const hide = !mode;
      if (btn.hidden !== hide) btn.hidden = hide;
      // Avoid rewriting innerHTML every anim frame — that cancels clicks.
      if (btn.dataset.mode !== mode) {
        btn.dataset.mode = mode;
        btn.innerHTML = icon;
        btn.title = title;
      } else if (btn.title !== title) {
        btn.title = title;
      }
    }
  }

  private makeRow(
    d: ParamDesc,
    shownValue?: string | number | boolean
  ): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:minmax(3.5rem,auto) 1fr auto;gap:6px;align-items:center;padding-top:6px;";

    const nameWrap = document.createElement("span");
    nameWrap.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;min-width:0;";

    const name = document.createElement("span");
    name.textContent = d.name;
    name.style.cssText =
      "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    name.title = d.name;

    nameWrap.append(name);
    row.appendChild(nameWrap);

    const initial = shownValue ?? this.params[d.name] ?? d.value ?? "";

    if (d.kind === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(initial);
      input.addEventListener("change", () => {
        this.commitValue(d.name, input.checked);
      });
      input.addEventListener("focus", () => {
        this.focusedName = d.name;
      });
      input.addEventListener("blur", () => {
        if (this.focusedName === d.name) this.focusedName = null;
      });
      this.inputByName.set(d.name, input);
      row.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = d.kind === "number" ? "number" : "text";
      input.value = String(initial);
      input.style.cssText = "width:100%;min-width:0;padding:2px 6px;";
      const parseInput = (): string | number => {
        const raw = input.value;
        return d.kind === "number" && raw !== "" && !Number.isNaN(Number(raw))
          ? Number(raw)
          : raw;
      };
      const commitFromInput = () => {
        this.commitValue(d.name, parseInput());
        this.focusSnapshot.set(d.name, input.value);
      };
      input.addEventListener("change", commitFromInput);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitFromInput();
          input.blur();
        }
      });
      input.addEventListener("focus", () => {
        this.focusedName = d.name;
        this.focusSnapshot.set(d.name, input.value);
      });
      input.addEventListener("blur", () => {
        if (this.focusedName === d.name) this.focusedName = null;
        // Spinner / IME: commit when the field text changed during focus.
        if (input.value !== this.focusSnapshot.get(d.name)) {
          commitFromInput();
        }
        this.focusSnapshot.delete(d.name);
      });
      this.inputByName.set(d.name, input);
      row.appendChild(input);
    }

    const status = document.createElement("button");
    status.type = "button";
    status.className = "svg3dx-params-bar__icon-btn";
    status.hidden = true;
    status.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mode = status.dataset.mode;
      if (mode === "unpin") this.onUnpin?.(d.name);
      else if (mode === "pause" || mode === "play") this.onTogglePlay?.();
    });
    this.statusBtnByName.set(d.name, status);
    row.appendChild(status);

    this.applyRowChrome();
    return row;
  }

  private commitValue(
    name: string,
    value: string | number | boolean
  ): void {
    this.params[name] = value;
    // Explicit pin outranks animation even when value equals the `:root` seed.
    if (this.onPin) {
      this.onPin(name, value);
      this.onChange?.({ ...this.params });
      return;
    }
    this.onChange?.({ ...this.params });
  }

  private syncExpandedUi(): void {
    this.body.style.display = this.expanded ? "flex" : "none";
    this.chevron.textContent = this.expanded ? "▾" : "▸";
    this.headerBtn.setAttribute("aria-expanded", this.expanded ? "true" : "false");
  }
}

function paramsFingerprint(params: ParamMap): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("\n");
}

function descsFingerprint(descs: ParamDesc[]): string {
  return descs.map((d) => `${d.name}:${d.kind}`).join("|");
}

function stateFingerprint(state: Record<string, ParamRowState>): string {
  return Object.keys(state)
    .sort()
    .map((k) => {
      const s = state[k]!;
      return `${k}:${s.animated ? 1 : 0}${s.pinned ? 1 : 0}${s.playing ? 1 : 0}`;
    })
    .join("|");
}
