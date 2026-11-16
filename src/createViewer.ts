import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ViewHelper } from "./vendor/ViewHelper.js";
import { applyWorldUp, DEFAULT_EYE_OFFSET, WORLD_UP } from "./coords.js";
import { Svg3dxViewer } from "./scene.js";
import { ParamPanel } from "./ParamPanel.js";
import { ModelBar } from "./ModelBar.js";
import { ParamsBar } from "./ParamsBar.js";
import { extractStyleParams, listParams } from "./params.js";
import { initWasm, parseSvg, type ParamMap } from "./wasm.js";
import type { EvaluationResult } from "./types.js";

// Before any Object3D / lookAt / controls: svg3dx Z-up.
applyWorldUp();

const PICK_DRAG_PX = 5;

export interface CreateViewerOptions {
  /** Mount param panel into this element (optional). */
  paramsEl?: HTMLElement | null;
  /** Initial external params. */
  params?: ParamMap;
  /** Prefer this s3dx:model id. */
  model?: string;
  /** Render mode override: solid | wireframe | hidden-line */
  mode?: string;
  background?: number | string;
  onParamsChange?: (params: ParamMap) => void;
  onWarnings?: (warnings: string[]) => void;
  onResult?: (result: EvaluationResult) => void;
  /** Fired when the user picks a model from the top-left Model bar. */
  onModelChange?: (modelId: string) => void;
  /**
   * Show top-left Model label + select (default true).
   * Hidden automatically when the document has no models.
   */
  modelBar?: boolean;
  /**
   * Show collapsible Params panel under the Model bar (default true).
   * Lists `:root` external params; edits re-evaluate the model.
   */
  paramsBar?: boolean;
  /**
   * Show top-right orientation gizmo (default true).
   * When false, the helper is not rendered and its clicks are ignored.
   */
  viewHelper?: boolean;
  /**
   * Handle ViewHelper gizmo clicks (default true).
   * Set false when a host (e.g. studio interact) owns pointer routing.
   * Ignored when `viewHelper` is false.
   */
  viewHelperClick?: boolean;
}

/**
 * Embeddable svg3dx 查看器：在 container 内创建 canvas + 可选参数面板。
 */
export async function createViewer(
  container: HTMLElement,
  options: CreateViewerOptions = {}
): Promise<EmbedViewer> {
  await initWasm();
  const viewer = new EmbedViewer(container, options);
  return viewer;
}

export class EmbedViewer {
  readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly viewHelper: ViewHelper;
  readonly viewer: Svg3dxViewer;
  readonly paramPanel: ParamPanel | null;
  readonly modelBar: ModelBar | null;
  readonly paramsBar: ParamsBar | null;
  /** Whether the top-right ViewHelper gizmo is shown. */
  readonly viewHelperVisible: boolean;

  private canvasWrap: HTMLElement;
  private leftChrome: HTMLElement | null = null;
  private svgText = "";
  private params: ParamMap;
  private model?: string;
  private mode?: string;
  private lastResult: EvaluationResult | null = null;
  private raf = 0;
  private clock = new THREE.Clock();
  private onParamsChange?: (params: ParamMap) => void;
  private onWarnings?: (warnings: string[]) => void;
  private onResult?: (result: EvaluationResult) => void;
  private onModelChange?: (modelId: string) => void;
  private onPointerDown: ((event: PointerEvent) => void) | null = null;
  private onPointerUp: ((event: PointerEvent) => void) | null = null;
  private pointerDown: { x: number; y: number; button: number } | null = null;

  constructor(container: HTMLElement, options: CreateViewerOptions = {}) {
    this.container = container;
    this.params = { ...(options.params ?? {}) };
    this.model = options.model;
    this.mode = options.mode;
    this.onParamsChange = options.onParamsChange;
    this.onWarnings = options.onWarnings;
    this.onResult = options.onResult;
    this.onModelChange = options.onModelChange;

    container.style.position = container.style.position || "relative";
    this.canvasWrap = document.createElement("div");
    this.canvasWrap.style.cssText =
      "position:relative;width:100%;height:100%;min-height:240px;";
    container.appendChild(this.canvasWrap);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0xe8eef2);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    this.camera.up.copy(WORLD_UP);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.canvasWrap.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    // Official three.js editor-style XYZ orientation gizmo (top-right).
    this.viewHelperVisible = options.viewHelper !== false;
    this.renderer.autoClear = false;
    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.center = this.controls.target;
    this.viewHelper.setLabels("X", "Y", "Z");
    this.viewHelper.adaptToBackground(this.scene.background as THREE.Color);

    if (this.viewHelperVisible && options.viewHelperClick !== false) {
      this.onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        this.pointerDown = {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
        };
      };
      this.onPointerUp = (event: PointerEvent) => {
        const down = this.pointerDown;
        this.pointerDown = null;
        if (!down || down.button !== 0 || event.button !== 0) return;
        const dx = event.clientX - down.x;
        const dy = event.clientY - down.y;
        if (dx * dx + dy * dy > PICK_DRAG_PX * PICK_DRAG_PX) return;
        this.viewHelper.handleClick(event);
      };
      this.renderer.domElement.addEventListener(
        "pointerdown",
        this.onPointerDown
      );
      this.renderer.domElement.addEventListener("pointerup", this.onPointerUp);
    }

    // PBR (esp. metalness>0) needs an environment; without it metals look near-black
    // and even white dielectrics read as dull gray under sparse lights.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b8c0, 0.65));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    // Key light from the default eye side (same iso as fitCamera)
    key.position.copy(DEFAULT_EYE_OFFSET).multiplyScalar(4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-DEFAULT_EYE_OFFSET.x, -DEFAULT_EYE_OFFSET.y, DEFAULT_EYE_OFFSET.z).normalize().multiplyScalar(4);
    this.scene.add(fill);

    this.viewer = new Svg3dxViewer(this.scene);

    const onParamsEdited = (p: ParamMap) => {
      void this.setParams(p);
      this.onParamsChange?.(p);
    };

    this.paramPanel = options.paramsEl
      ? new ParamPanel(options.paramsEl, { onChange: onParamsEdited })
      : null;

    const wantModelBar = options.modelBar !== false;
    const wantParamsBar = options.paramsBar !== false;
    if (wantModelBar || wantParamsBar) {
      this.leftChrome = document.createElement("div");
      this.leftChrome.className = "svg3dx-left-chrome";
      this.leftChrome.style.cssText = [
        "position:absolute",
        "top:10px",
        "left:10px",
        "z-index:2",
        "display:flex",
        "flex-direction:column",
        "align-items:stretch",
        "gap:6px",
        "max-width:min(16rem, calc(100% - 20px))",
        "pointer-events:none",
      ].join(";");
      // Children re-enable pointer events.
      this.canvasWrap.appendChild(this.leftChrome);
    }

    this.modelBar = wantModelBar
      ? new ModelBar(this.leftChrome!, {
          onChange: (id) => {
            void this.setModel(id, { fitCamera: true });
            this.onModelChange?.(id);
          },
        })
      : null;

    this.paramsBar = wantParamsBar
      ? new ParamsBar(this.leftChrome!, { onChange: onParamsEdited })
      : null;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvasWrap);
    (this as unknown as { _ro: ResizeObserver })._ro = ro;

    this.resize();
    const tick = () => {
      const delta = this.clock.getDelta();
      // Skip OrbitControls while ViewHelper owns the camera, otherwise lookAt
      // fights the axis-home animation every frame.
      if (this.viewHelperVisible && this.viewHelper.animating) {
        this.viewHelper.update(delta);
      } else {
        this.controls.update();
      }
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.viewHelperVisible) {
        this.viewHelper.render(this.renderer);
      }
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  async loadSvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    this.svgText = svgText;
    this.params = extractStyleParams(svgText);
    return this.reload({ fitCamera: options.fitCamera !== false });
  }

  /**
   * Update document text + re-evaluate without reframing the camera.
   * Use when only `<style>` / params changed so the viewport does not "flash".
   */
  async applySvg(
    svgText: string,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    this.svgText = svgText;
    this.params = extractStyleParams(svgText);
    return this.reload({ fitCamera: options.fitCamera === true });
  }

  async setParams(params: ParamMap): Promise<EvaluationResult | null> {
    this.params = { ...params };
    if (!this.svgText) return null;
    return this.reload({ fitCamera: false });
  }

  getParams(): ParamMap {
    return { ...this.params };
  }

  /**
   * Prefer this `s3dx:model` id for evaluation / display.
   * Reloads geometry when document text is already loaded.
   */
  async setModel(
    model: string | undefined,
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult | null> {
    const next = model || undefined;
    if (this.model === next && this.lastResult) {
      this.syncModelBar(this.lastResult);
      return this.lastResult;
    }
    // First host binding to the model already shown by document `active` — skip re-eval.
    if (this.model === undefined && next && this.lastResult) {
      const shown =
        this.lastResult.active_model ??
        this.lastResult.models.find((m) => m.active)?.id ??
        this.lastResult.models[0]?.id;
      if (shown === next) {
        this.model = next;
        this.syncModelBar(this.lastResult);
        return this.lastResult;
      }
    }
    this.model = next;
    if (!this.svgText) {
      this.syncModelBar(this.lastResult);
      return null;
    }
    return this.reload({ fitCamera: options.fitCamera !== false });
  }

  getModel(): string | undefined {
    return this.model;
  }

  setMode(mode: string | undefined): void {
    this.mode = mode;
  }

  /** Update Three.js scene clear / backdrop color (hex number or CSS color string). */
  setBackground(color: number | string): void {
    const bg = new THREE.Color(color);
    this.scene.background = bg;
    this.viewHelper.adaptToBackground(bg);
  }

  getResult(): EvaluationResult | null {
    return this.lastResult;
  }

  private async reload(
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    const result = await parseSvg(this.svgText, this.params, this.model);
    this.lastResult = result;
    if (result.warnings.length) this.onWarnings?.(result.warnings);
    this.viewer.fromResult(result, this.mode, this.svgText);
    if (options.fitCamera !== false) {
      this.viewer.fitCamera(this.camera, this.controls);
    }
    this.syncParamsUi(result);
    this.syncModelBar(result);
    this.onResult?.(result);
    return result;
  }

  private syncParamsUi(result: EvaluationResult | null): void {
    const descs = listParams(this.params, result);
    this.paramPanel?.setParams(this.params, descs);
    this.paramsBar?.setParams(this.params, descs);
  }

  private syncModelBar(result: EvaluationResult | null): void {
    if (!this.modelBar) return;
    const models = result?.models ?? [];
    const active =
      this.model ??
      result?.active_model ??
      models.find((m) => m.active)?.id ??
      models[0]?.id ??
      null;
    this.modelBar.setModels(models, active);
  }

  private resize(): void {
    const w = this.canvasWrap.clientWidth || 1;
    const h = this.canvasWrap.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    if (this.onPointerDown) {
      this.renderer.domElement.removeEventListener(
        "pointerdown",
        this.onPointerDown
      );
    }
    if (this.onPointerUp) {
      this.renderer.domElement.removeEventListener(
        "pointerup",
        this.onPointerUp
      );
    }
    this.viewHelper.dispose();
    const ro = (this as unknown as { _ro?: ResizeObserver })._ro;
    ro?.disconnect();
    this.paramsBar?.dispose();
    this.modelBar?.dispose();
    this.leftChrome?.remove();
    this.paramPanel?.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.canvasWrap.remove();
  }
}
