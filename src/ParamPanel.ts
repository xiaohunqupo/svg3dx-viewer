import type { ParamDesc } from "./params.js";
import type { ParamMap } from "./wasm.js";

export interface ParamPanelOptions {
  onChange?: (params: ParamMap) => void;
}

/** Lightweight parameter form for embed hosts. */
export class ParamPanel {
  readonly el: HTMLElement;
  private params: ParamMap = {};
  private onChange?: (params: ParamMap) => void;

  constructor(container: HTMLElement, options: ParamPanelOptions = {}) {
    this.el = document.createElement("div");
    this.el.className = "svg3dx-param-panel";
    this.el.style.cssText =
      "display:flex;flex-direction:column;gap:0.4rem;font:13px/1.4 system-ui,sans-serif;";
    container.appendChild(this.el);
    this.onChange = options.onChange;
  }

  setParams(params: ParamMap, descs?: ParamDesc[]): void {
    this.params = { ...params };
    this.el.replaceChildren();
    const list = descs ?? Object.keys(this.params).sort().map((name) => ({
      name,
      value: this.params[name],
      kind: typeof this.params[name] === "number"
        ? ("number" as const)
        : typeof this.params[name] === "boolean"
          ? ("boolean" as const)
          : ("string" as const),
    }));

    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No editable params";
      empty.style.opacity = "0.6";
      this.el.appendChild(empty);
      return;
    }

    for (const d of list) {
      const row = document.createElement("label");
      row.style.cssText = "display:grid;grid-template-columns:7rem 1fr;gap:0.5rem;align-items:center;";
      const name = document.createElement("span");
      name.textContent = d.name;
      name.style.fontWeight = "600";
      row.appendChild(name);

      if (d.kind === "boolean") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(this.params[d.name]);
        input.addEventListener("change", () => {
          this.params[d.name] = input.checked;
          this.onChange?.({ ...this.params });
        });
        row.appendChild(input);
      } else {
        const input = document.createElement("input");
        input.type = d.kind === "number" ? "number" : "text";
        input.value = String(this.params[d.name] ?? d.value ?? "");
        input.style.cssText = "padding:0.25rem 0.4rem;border:1px solid #c5ced8;border-radius:4px;";
        input.addEventListener("change", () => {
          const raw = input.value;
          this.params[d.name] =
            d.kind === "number" && raw !== "" && !Number.isNaN(Number(raw))
              ? Number(raw)
              : raw;
          this.onChange?.({ ...this.params });
        });
        row.appendChild(input);
      }
      this.el.appendChild(row);
    }
  }

  getParams(): ParamMap {
    return { ...this.params };
  }

  dispose(): void {
    this.el.remove();
  }
}
