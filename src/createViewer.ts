import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { ViewHelper } from "./vendor/ViewHelper.js";
import {
  applyWorldUp,
  DEFAULT_EYE_OFFSET,
  TOP_EYE_OFFSET,
  WORLD_UP,
} from "./coords.js";
import { Svg3dxViewer } from "./scene.js";
import { ParamPanel } from "./ParamPanel.js";
import { ModelBar } from "./ModelBar.js";
import { ParamsBar } from "./ParamsBar.js";
import { DisplayModeBar, type DisplayModeState } from "./DisplayModeBar.js";
import { ensureChromeStyles } from "./chromeStyles.js";
import {
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";
import {
  emptyEvaluationResult,
  isSvg3dxDocument,
} from "./documentKind.js";
import { extractStyleParams, listParams } from "./params.js";
import { initWasm, parseSvg, type ParamMap } from "./wasm.js";
import type { EvaluationResult } from "./types.js";

// Before any Object3D / lookAt / controls: svg3dx Z-up.
applyWorldUp();

const PICK_DRAG_PX = 5;
const AXES_UNIT = 1;

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
   * Hidden automatically for plain SVG (no `svg3d="true"`).
   */
  paramsBar?: boolean;
  /**
   * Show Kernel / svg3dx display-mode toggles for plain SVG (default true).
   * Both modes start enabled. Hidden for svg3dx documents.
   */
  displayModeBar?: boolean;
  /**
   * Overlay chrome language (`zh` / `en`). Default: browser language.
   * Call `setLocale` later when the host app language changes.
   */
  locale?: ViewerLocale;
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
  /**
   * Show world-origin XYZ axes in the scene (default true).
   * Lives outside the svg3dx root so document reloads do not dispose it.
   */
  axesHelper?: boolean;
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
  readonly displayModeBar: DisplayModeBar | null;
  /** Whether the top-right ViewHelper gizmo is shown. */
  readonly viewHelperVisible: boolean;
  /** Whether the world-origin XYZ axes are shown. */
  readonly axesHelperVisible: boolean;

  private stage: HTMLElement;
  private canvasWrap: HTMLElement;
  private kernelHost: HTMLElement;
  private leftChrome: HTMLElement | null = null;
  private svgText = "";
  private params: ParamMap;
  private model?: string;
  private mode?: string;
  private lastResult: EvaluationResult | null = null;
  /** True when the loaded document has no `svg3d="true"`. */
  private plainSvg = false;
  private displayModes: DisplayModeState = { kernel: true, svg3dx: true };
  private locale: ViewerLocale;
  private raf = 0;
  private resizeRaf = 0;
  /** Re-fit once the canvas has a real size (initial layout often 0×0 / tiny). */
  private pendingFit = false;
  /**
   * Keep auto-framing on layout/aspect changes until the user orbits/pans/zooms.
   * Avoids “off-center / clipped” after panel resize or HiDPI first paint.
   */
  private autoFit = true;
  private lastCssSize = { w: 0, h: 0 };
  private clock = new THREE.Clock();
  private onParamsChange?: (params: ParamMap) => void;
  private onWarnings?: (warnings: string[]) => void;
  private onResult?: (result: EvaluationResult) => void;
  private onModelChange?: (modelId: string) => void;
  private onPointerDown: ((event: PointerEvent) => void) | null = null;
  private onPointerUp: ((event: PointerEvent) => void) | null = null;
  private pointerDown: { x: number; y: number; button: number } | null = null;
  /** Official outline postprocessing (webgl_postprocessing_outline). */
  private composer: EffectComposer;
  private outlinePass: OutlinePass;
  private fxaaPass: ShaderPass;
  private axesHelper: THREE.AxesHelper | null = null;

  constructor(container: HTMLElement, options: CreateViewerOptions = {}) {
    this.container = container;
    this.params = { ...(options.params ?? {}) };
    this.model = options.model;
    this.mode = options.mode;
    this.onParamsChange = options.onParamsChange;
    this.onWarnings = options.onWarnings;
    this.onResult = options.onResult;
    this.onModelChange = options.onModelChange;
    this.locale = options.locale ?? detectViewerLocale();

    container.style.position = container.style.position || "relative";
    ensureChromeStyles();

    this.stage = document.createElement("div");
    this.stage.className = "svg3dx-stage";
    this.stage.style.cssText =
      "position:absolute;inset:0;display:flex;flex-direction:row;min-width:0;min-height:0;overflow:hidden;";
    container.appendChild(this.stage);

    this.kernelHost = document.createElement("div");
    this.kernelHost.className = "svg3dx-kernel-host";
    this.kernelHost.style.cssText =
      "display:none;flex:1 1 0;min-width:0;min-height:0;overflow:auto;";
    this.stage.appendChild(this.kernelHost);

    this.canvasWrap = document.createElement("div");
    // min-height:0 so flex/grid parents can shrink; hosts set their own min size.
    this.canvasWrap.style.cssText =
      "position:relative;flex:1 1 0;width:auto;height:auto;min-width:0;min-height:0;overflow:hidden;";
    this.stage.appendChild(this.canvasWrap);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0xe8eef2);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    this.camera.up.copy(WORLD_UP);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keep CSS size = container; buffer size may be larger via pixelRatio.
    // Without this, setSize(w,h,false) leaves canvas layout at bitmap size (w*pr)
    // and the view overflows / looks off-center on HiDPI.
    this.renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;";
    this.canvasWrap.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // OrbitControls event map is `never` under some @types/three versions.
    (
      this.controls as unknown as {
        addEventListener: (type: string, listener: () => void) => void;
      }
    ).addEventListener("start", () => {
      this.autoFit = false;
      this.pendingFit = false;
    });

    // Official three.js editor-style XYZ orientation gizmo (top-right).
    this.viewHelperVisible = options.viewHelper !== false;
    this.renderer.autoClear = false;
    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.center = this.controls.target;
    this.viewHelper.setLabels("X", "Y", "Z");
    this.viewHelper.adaptToBackground(this.scene.background as THREE.Color);

    // Selection outline — same stack as three.js `webgl_postprocessing_outline`.
    // MSAA on composer RTs (renderer.antialias alone does not apply through EffectComposer).
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const composerTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(size.width * pr)),
      Math.max(1, Math.floor(size.height * pr)),
      { type: THREE.HalfFloatType, samples: 4 }
    );
    composerTarget.texture.name = "EffectComposer.rt1";
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(1, 1),
      this.scene,
      this.camera
    );
    this.outlinePass.edgeStrength = 4;
    this.outlinePass.edgeThickness = 1.5;
    this.outlinePass.edgeGlow = 0.15;
    this.outlinePass.pulsePeriod = 0;
    this.outlinePass.visibleEdgeColor.set(0xff9a2e);
    this.outlinePass.hiddenEdgeColor.set(0xb36a10);
    this.composer.addPass(this.outlinePass);
    this.composer.addPass(new OutputPass());
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);

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

    this.axesHelperVisible = options.axesHelper !== false;
    if (this.axesHelperVisible) {
      this.axesHelper = new THREE.AxesHelper(AXES_UNIT);
      this.axesHelper.name = "svg3dx-world-axes";
      // Keep outside Svg3dxViewer.root so document reloads do not dispose it.
      this.scene.add(this.axesHelper);
    }

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
    const wantDisplayModeBar = options.displayModeBar !== false;
    if (wantModelBar || wantParamsBar || wantDisplayModeBar) {
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
      // Overlay the whole stage so chrome stays visible in kernel-only mode.
      container.appendChild(this.leftChrome);
    }

    this.displayModeBar = wantDisplayModeBar
      ? new DisplayModeBar(this.leftChrome!, {
          initial: this.displayModes,
          locale: this.locale,
          onChange: (state) => {
            this.displayModes = state;
            this.applyDisplayLayout();
          },
        })
      : null;

    this.modelBar = wantModelBar
      ? new ModelBar(this.leftChrome!, {
          locale: this.locale,
          onChange: (id) => {
            void this.setModel(id, { fitCamera: true });
            this.onModelChange?.(id);
          },
        })
      : null;

    this.paramsBar = wantParamsBar
      ? new ParamsBar(this.leftChrome!, {
          locale: this.locale,
          onChange: onParamsEdited,
        })
      : null;

    const ro = new ResizeObserver(() => this.scheduleResize());
    ro.observe(this.canvasWrap);
    ro.observe(this.stage);
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
      this.paint();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * Objects that receive the official OutlinePass contour
   * (does not alter materials).
   */
  setSelectedObjects(objects: THREE.Object3D[]): void {
    this.outlinePass.selectedObjects = objects;
  }

  getSelectedObjects(): THREE.Object3D[] {
    return this.outlinePass.selectedObjects;
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

  /** True when the last loaded document is plain SVG (no `svg3d="true"`). */
  isPlainSvg(): boolean {
    return this.plainSvg;
  }

  getDisplayModes(): DisplayModeState {
    return { ...this.displayModes };
  }

  setDisplayModes(state: Partial<DisplayModeState>): void {
    this.displayModes = {
      kernel: state.kernel ?? this.displayModes.kernel,
      svg3dx: state.svg3dx ?? this.displayModes.svg3dx,
    };
    this.displayModeBar?.setState(this.displayModes);
    this.applyDisplayLayout();
  }

  getLocale(): ViewerLocale {
    return this.locale;
  }

  /** Update overlay chrome language (Model / Params / Display toggles). */
  setLocale(locale: ViewerLocale): void {
    this.locale = locale;
    this.displayModeBar?.setLocale(locale);
    this.modelBar?.setLocale(locale);
    this.paramsBar?.setLocale(locale);
  }

  private async reload(
    options: { fitCamera?: boolean } = {}
  ): Promise<EvaluationResult> {
    this.plainSvg = !isSvg3dxDocument(this.svgText);
    this.applyDisplayLayout();

    let result: EvaluationResult;
    if (this.plainSvg) {
      // Core refuses evaluation without svg3d="true"; still show 2D via svg2d + kernel.
      result = emptyEvaluationResult();
    } else {
      result = await parseSvg(this.svgText, this.params, this.model);
    }

    this.lastResult = result;
    if (result.warnings.length) this.onWarnings?.(result.warnings);
    this.viewer.fromResult(
      result,
      this.mode,
      // Always pass markup so ordinary SVG tags become XY-plane primitives.
      this.svgText
    );
    this.syncAxesHelperSize();
    this.syncKernelHost();
    this.syncChromeForDocument(result);
    if (options.fitCamera !== false) {
      this.autoFit = true;
      // Plain SVG → ViewHelper +Z home; svg3dx → CAD iso. No other differences.
      const framed = this.viewer.fitCamera(
        this.camera,
        this.controls,
        this.fitCameraOptions()
      );
      const w = this.canvasWrap.clientWidth;
      const h = this.canvasWrap.clientHeight;
      // Fit before layout settles uses a wrong aspect — redo on next good resize.
      this.pendingFit = framed && (w < 32 || h < 32);
    }
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
    if (this.plainSvg) {
      this.modelBar.setModels([], null);
      return;
    }
    const models = result?.models ?? [];
    const active =
      this.model ??
      result?.active_model ??
      models.find((m) => m.active)?.id ??
      models[0]?.id ??
      null;
    this.modelBar.setModels(models, active);
  }

  private syncChromeForDocument(result: EvaluationResult | null): void {
    this.displayModeBar?.setVisible(this.plainSvg);
    if (this.plainSvg) {
      if (this.paramsBar) this.paramsBar.el.style.display = "none";
      this.syncModelBar(result);
      return;
    }
    if (this.paramsBar) this.paramsBar.el.style.display = "flex";
    this.syncParamsUi(result);
    this.syncModelBar(result);
  }

  /** Browser-native SVG pane for plain documents (内核 mode). */
  private syncKernelHost(): void {
    this.kernelHost.replaceChildren();
    if (!this.plainSvg || !this.svgText.trim()) return;
    if (typeof DOMParser === "undefined") return;
    const parsed = new DOMParser().parseFromString(this.svgText, "image/svg+xml");
    if (parsed.querySelector("parsererror")) {
      const pre = document.createElement("pre");
      pre.textContent = this.svgText;
      pre.style.cssText =
        "margin:0;padding:12px;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap;";
      this.kernelHost.appendChild(pre);
      return;
    }
    const root = parsed.documentElement;
    if (!root || root.localName.toLowerCase() !== "svg") return;
    const svg = document.importNode(root, true) as unknown as SVGSVGElement;
    if (!svg.getAttribute("xmlns")) {
      svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    }
    this.kernelHost.appendChild(svg);
  }

  private applyDisplayLayout(): void {
    if (!this.plainSvg) {
      this.kernelHost.style.display = "none";
      this.canvasWrap.style.display = "block";
      this.canvasWrap.style.flex = "1 1 0";
      this.scheduleResize();
      return;
    }
    const showKernel = this.displayModes.kernel;
    const showSvg3dx = this.displayModes.svg3dx;
    this.kernelHost.style.display = showKernel ? "flex" : "none";
    this.kernelHost.style.flex = showKernel ? "1 1 0" : "0 0 0";
    this.canvasWrap.style.display = showSvg3dx ? "block" : "none";
    this.canvasWrap.style.flex = showSvg3dx ? "1 1 0" : "0 0 0";
    this.scheduleResize();
  }

  /** Plain SVG uses ViewHelper +Z; otherwise default CAD iso. */
  private fitCameraOptions(): { eyeOffset?: THREE.Vector3 } {
    return this.plainSvg ? { eyeOffset: TOP_EYE_OFFSET } : {};
  }

  /**
   * Coalesce ResizeObserver bursts (panel drag) to one apply per frame.
   * setSize clears the drawing buffer — paint immediately after to avoid a black flash.
   */
  private scheduleResize(): void {
    if (this.resizeRaf) return;
    this.resizeRaf = requestAnimationFrame(() => {
      this.resizeRaf = 0;
      this.resize();
    });
  }

  private resize(): void {
    const w = this.canvasWrap.clientWidth || 1;
    const h = this.canvasWrap.clientHeight || 1;
    const prev = this.lastCssSize;
    const sizeUnchanged = w === prev.w && h === prev.h;
    if (sizeUnchanged) {
      if (this.pendingFit && w >= 32 && h >= 32) {
        this.pendingFit = false;
        this.viewer.fitCamera(
          this.camera,
          this.controls,
          this.fitCameraOptions()
        );
        this.paint();
      }
      return;
    }
    const prevAspect = prev.w > 0 && prev.h > 0 ? prev.w / prev.h : 0;
    const nextAspect = w / h;
    const aspectDelta =
      prevAspect > 0 ? Math.abs(nextAspect - prevAspect) / prevAspect : 1;
    this.lastCssSize = { w, h };
    const pr = this.renderer.getPixelRatio();
    this.camera.aspect = nextAspect;
    this.camera.updateProjectionMatrix();
    // false: CSS already 100%; only update drawing buffer.
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxaaPass.material.uniforms["resolution"].value.set(
      1 / (w * pr),
      1 / (h * pr)
    );
    const shouldRefit =
      (this.pendingFit && w >= 32 && h >= 32) ||
      (this.autoFit && w >= 32 && h >= 32 && aspectDelta > 0.08);
    if (shouldRefit) {
      this.pendingFit = false;
      this.viewer.fitCamera(
        this.camera,
        this.controls,
        this.fitCameraOptions()
      );
    }
    // Buffer/targets were reallocated and cleared; redraw before the browser paints.
    this.paint();
  }

  private paint(): void {
    // Ensure full-canvas viewport after ViewHelper (or any pass) may have changed it.
    const el = this.renderer.domElement;
    this.renderer.setViewport(0, 0, el.clientWidth || 1, el.clientHeight || 1);
    this.renderer.setScissorTest(false);
    this.composer.render();
    if (this.viewHelperVisible) {
      this.viewHelper.render(this.renderer);
    }
  }

  /** Scale world axes from content bounds (no-op when axes are disabled). */
  private syncAxesHelperSize(): void {
    if (!this.axesHelper) return;
    this.viewer.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.viewer.root);
    let len = 10;
    if (!box.isEmpty()) {
      len = Math.max(box.getSize(new THREE.Vector3()).length() * 0.2, 1);
    }
    this.axesHelper.scale.setScalar(len / AXES_UNIT);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    if (this.resizeRaf) {
      cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = 0;
    }
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
    this.outlinePass.selectedObjects = [];
    this.viewHelper.dispose();
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
      this.axesHelper.geometry.dispose();
      const mat = this.axesHelper.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
      this.axesHelper = null;
    }
    const ro = (this as unknown as { _ro?: ResizeObserver })._ro;
    ro?.disconnect();
    this.displayModeBar?.dispose();
    this.paramsBar?.dispose();
    this.modelBar?.dispose();
    this.leftChrome?.remove();
    this.paramPanel?.dispose();
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.renderer.dispose();
    this.kernelHost.replaceChildren();
    this.stage.remove();
  }
}
