import type { ParamDesc } from "./params.js";
import type { ParamMap } from "./wasm.js";

export interface ParamsBarOptions {
  onChange?: (params: ParamMap) => void;
  /** Start expanded (default false). */
  expanded?: boolean;
}

/**
 * Collapsible Params overlay for the embed viewer — sits under the Model bar.
 * Lists `:root` external params; edits trigger `onChange` for live re-eval.
 */
export class ParamsBar {
  readonly el: HTMLElement;
  private headerBtn: HTMLButtonElement;
  private chevron: HTMLSpanElement;
  private body: HTMLElement;
  private params: ParamMap = {};
  private onChange?: (params: ParamMap) => void;
  private expanded: boolean;
  private hasParams = false;

  constructor(parent: HTMLElement, options: ParamsBarOptions = {}) {
    this.onChange = options.onChange;
    this.expanded = options.expanded === true;

    this.el = document.createElement("div");
    this.el.className = "svg3dx-params-bar";
    this.el.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "min-width:11rem",
      "max-width:16rem",
      "background:rgba(255,255,255,0.92)",
      "border:1px solid #c5ced8",
      "border-radius:6px",
      "box-shadow:0 1px 2px rgba(15,23,42,0.06)",
      "font:12px/1.3 system-ui,sans-serif",
      "color:#1f2937",
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

    const title = document.createElement("span");
    title.textContent = "Params";
    title.style.cssText = "font-weight:600;white-space:nowrap;";

    this.chevron = document.createElement("span");
    this.chevron.setAttribute("aria-hidden", "true");
    this.chevron.style.cssText =
      "font-size:10px;opacity:0.65;transition:transform 0.12s ease;";

    this.headerBtn.append(title, this.chevron);
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
      "border-top:1px solid #e5eaf0",
      "max-height:min(40vh, 280px)",
      "overflow:auto",
    ].join(";");

    for (const type of ["pointerdown", "pointerup", "wheel", "click"] as const) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }

    this.el.append(this.headerBtn, this.body);
    parent.appendChild(this.el);
    this.syncExpandedUi();
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.syncExpandedUi();
  }

  isExpanded(): boolean {
    return this.expanded;
  }

  setParams(params: ParamMap, descs?: ParamDesc[]): void {
    this.params = { ...params };
    const list =
      descs ??
      Object.keys(this.params)
        .sort()
        .map((name) => ({
          name,
          value: this.params[name]!,
          kind:
            typeof this.params[name] === "number"
              ? ("number" as const)
              : typeof this.params[name] === "boolean"
                ? ("boolean" as const)
                : ("string" as const),
        }));

    this.hasParams = list.length > 0;
    this.body.replaceChildren();

    if (!list.length) {
      const empty = document.createElement("div");
      empty.textContent = "No editable params";
      empty.style.cssText = "opacity:0.6;padding-top:6px;";
      this.body.appendChild(empty);
    } else {
      for (const d of list) {
        this.body.appendChild(this.makeRow(d));
      }
    }

    this.headerBtn.title = this.hasParams
      ? `${list.length} param${list.length === 1 ? "" : "s"}`
      : "No editable params";
  }

  getParams(): ParamMap {
    return { ...this.params };
  }

  dispose(): void {
    this.el.remove();
  }

  private makeRow(d: ParamDesc): HTMLElement {
    const row = document.createElement("label");
    row.style.cssText =
      "display:grid;grid-template-columns:minmax(3.5rem,auto) 1fr;gap:6px;align-items:center;padding-top:6px;";

    const name = document.createElement("span");
    name.textContent = d.name;
    name.style.cssText =
      "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    name.title = d.name;
    row.appendChild(name);

    if (d.kind === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(this.params[d.name]);
      input.addEventListener("change", () => {
        this.params[d.name] = input.checked;
        this.emitChange();
      });
      row.appendChild(input);
    } else {
      const input = document.createElement("input");
      input.type = d.kind === "number" ? "number" : "text";
      input.value = String(this.params[d.name] ?? d.value ?? "");
      input.style.cssText = [
        "width:100%",
        "min-width:0",
        "padding:2px 6px",
        "border:1px solid #c5ced8",
        "border-radius:4px",
        "background:#fff",
        "font:inherit",
        "color:inherit",
      ].join(";");
      const commit = () => {
        const raw = input.value;
        this.params[d.name] =
          d.kind === "number" && raw !== "" && !Number.isNaN(Number(raw))
            ? Number(raw)
            : raw;
        this.emitChange();
      };
      input.addEventListener("change", commit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          input.blur();
        }
      });
      row.appendChild(input);
    }

    return row;
  }

  private emitChange(): void {
    this.onChange?.({ ...this.params });
  }

  private syncExpandedUi(): void {
    this.body.style.display = this.expanded ? "flex" : "none";
    this.chevron.textContent = this.expanded ? "▾" : "▸";
    this.headerBtn.setAttribute("aria-expanded", this.expanded ? "true" : "false");
  }
}
