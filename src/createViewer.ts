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
import { ParamsBar, type ParamRowState } from "./ParamsBar.js";
import { DisplayModeBar, type DisplayModeState } from "./DisplayModeBar.js";
import {
  SettingsBar,
  type AntialiasLevel,
  type ViewerUiState,
} from "./SettingsBar.js";
import { ensureChromeStyles } from "./chromeStyles.js";
import {
  detectViewerLocale,
  type ViewerLocale,
} from "./chromeLocale.js";
import {
  emptyEvaluationResult,
  isSvg3dxDocument,
} from "./documentKind.js";
import {
  extractStyleParams,
  externalOverridesFromDisplay,
  listParams,
  pruneOverridesToSeed,
} from "./params.js";
import {
  OUTLINE_OVERLAY_FS_ALPHA,
  SELECTION_EDGE,
  SELECTION_EDGE_HIDDEN,
  SELECTION_OUTLINE_TUNING,
  applySelectionEdgeColors,
} from "./selectionStyle.js";
import { initWasm, parseSvg, type ParamMap } from "./wasm.js";
import type { EvaluationResult } from "./types.js";
import { PlaneHelper } from "./PlaneHelper.js";
import { AnimationRuntime } from "./animation/runtime.js";
import type { AnimationDesc } from "./animation/types.js";

// Before any Object3D / lookAt / controls: svg3dx Z-up.
applyWorldUp();

const PICK_DRAG_PX = 5;
const AXES_UNIT = 1;
/** Unit size for PlaneHelper before screen-based scaling. */
const PLANE_UNIT = 10;
/** Soft blue-gray so the plane stays readable over pale/white faces. */
const PLANE_COLOR = 0x7eb6e8;
/** Plane edge length as a fraction of the shorter viewport side (world units). */
const PLANE_SCREEN_FRACTION = 0.55;
/** AxesHelper length vs plane half-extent (>1 → tips past the plane edge). */
const AXES_OVER_PLANE_HALF = 1.15;

export interface CreateViewerOptions {
  /** Mount param panel into this element (optional). */
  paramsEl?: HTMLElement | null;
  /** Initial external params. */
  params?: ParamMap;
  /** Prefer this s3dx:model id. */
  model?: string;
  /**
   * Keep skipped if/if-not branches in evaluation results (default false).
   * Hosts that preview false branches (e.g. an editor) set this true.
   */
  retainInactive?: boolean;
  /**
   * Extra named defs `<g>` ids to evaluate beyond the active model
   * (on-demand preview). Empty by default.
   */
  extraDefs?: string[];
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
   * Show top-left settings gear menu (default true).
   * The menu can also hide this button itself; restore via `setUiState`.
   */
  settingsBar?: boolean;
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
   * Show world-origin XYZ axes via official `THREE.AxesHelper` (default true).
   * Length is slightly longer than the PlaneHelper half-extent.
   */
  axesHelper?: boolean;
  /**
   * Show world XY reference plane (`PlaneHelper`: outer frame + fill, default true).
   * Alias: `gridHelper`.
   */
  planeHelper?: boolean;
  /** @deprecated Use `planeHelper`. */
  gridHelper?: boolean;
  /**
   * MSAA sample count for the EffectComposer path: 0 | 2 | 4 | 8 (default 4).
   * 0 disables antialiasing (including FXAA).
   */
  antialias?: AntialiasLevel;
  /**
   * Base URL for resolving relative `s3dx:gltf` hrefs (and future assets).
   * Defaults to `window.location.href` when unset.
   */
  documentBaseUrl?: string;
  /**
   * Local sidecar assets: relative path (e.g. `assets/foo.glb`) → fetchable URL.
   * Takes precedence over documentBaseUrl for matching hrefs.
   */
  documentAssetUrls?: Record<string, string>;
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
  readonly settingsBar: SettingsBar | null;
  /** Whether the top-right ViewHelper gizmo is shown. */
  viewHelperVisible: boolean;
  /** Whether the world-origin XYZ axes are shown. */
  axesHelperVisible: boolean;
  /** Whether the world XY PlaneHelper is shown. */
  planeHelperVisible: boolean;

  /**
   * Place axes + plane on `source`'s world origin and orientation.
   * Pass `null` to return them to the world origin.
   */
  setHelperFrame(source: THREE.Object3D | null): void {
    this.helperFrame = source;
    this.syncHelperFrame();
    this.invalidate();
  }

  private stage: HTMLElement;
  private canvasWrap: HTMLElement;
  private kernelHost: HTMLElement;
  private leftChrome: HTMLElement | null = null;
  private svgText = "";
  /** Document base URL for resolving relative `s3dx:gltf` / asset hrefs. */
  private documentBaseUrl?: string;
  /** Local sidecar map: relative href → blob:/http URL (studio). */
  private documentAssetUrls?: Record<string, string>;
  /**
   * Explicit host / UI external overrides only (spec §2.3 highest priority).
   * Must not be seeded from `:root` — that would pin DOM defaults above animation.
   */
  private params: ParamMap;
  /** `:root` direct literals for ParamsBar display / whitelist. */
  private seedParams: ParamMap = {};
  private model?: string;
  private mode?: string;
  private retainInactive = false;
  private extraDefs: string[] = [];
  private lastResult: EvaluationResult | null = null;
  /** Bumped on every reload so overlapping glTF hydrates cannot commit stale scenes. */
  private reloadGeneration = 0;
  /** Serialize `fromResult` (async glTF hydrate) across overlapping reloads. */
  private fromResultQueue: Promise<void> = Promise.resolve();
  /** True when the loaded document has no `svg3d="true"`. */
  private plainSvg = false;
  private displayModes: DisplayModeState = { kernel: true, svg3dx: true };
  private uiPrefs: {
    settingsButton: boolean;
    modelBar: boolean;
    paramsBar: boolean;
  };
  private antialias: AntialiasLevel = 4;
  private locale: ViewerLocale;
  private viewHelperClickEnabled = true;
  private raf = 0;
  private resizeRaf = 0;
  /**
   * When true, keep requesting frames even if the camera is idle
   * (e.g. future skeletal / clip animation). Hosts toggle via
   * `setContinuousRender`.
   */
  private continuousRender = false;
  /** SMIL-shaped animation clock (draft 0.2 §10). */
  private readonly animation = new AnimationRuntime();
  /** Last sampled param overrides from the animation clock. */
  private animParamOverrides: ParamMap = {};
  /** Coalesce animation-driven reloads to one in-flight request. */
  private animReloadQueued = false;
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
  private planeHelper: PlaneHelper | null = null;
  /**
   * When set, axes + plane copy this object's world origin and orientation
   * (parent frame while the editor drills into a child). Null = world origin.
   */
  private helperFrame: THREE.Object3D | null = null;
  private readonly helperAnchor = new THREE.Vector3();
  private readonly helperPos = new THREE.Vector3();
  private readonly helperQuat = new THREE.Quaternion();
  private readonly helperScale = new THREE.Vector3();
  private outlineOverlayReady = false;
  /**
   * Scenes drawn after EffectComposer (e.g. TransformControls). Kept out of
   * the main scene so OutlinePass depth / edges do not pick them up.
   */
  private overlayScenes: THREE.Scene[] = [];

  constructor(container: HTMLElement, options: CreateViewerOptions = {}) {
    this.container = container;
    this.params = { ...(options.params ?? {}) };
    this.documentBaseUrl = options.documentBaseUrl;
    this.documentAssetUrls = options.documentAssetUrls
      ? { ...options.documentAssetUrls }
      : undefined;
    this.model = options.model;
    this.mode = options.mode;
    this.retainInactive = options.retainInactive === true;
    this.extraDefs = [...(options.extraDefs ?? [])].filter(Boolean);
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
    const controlsEvents = this.controls as unknown as {
      addEventListener: (type: string, listener: () => void) => void;
    };
    controlsEvents.addEventListener("start", () => {
      this.autoFit = false;
      this.pendingFit = false;
      // Damping applies inside update(); kick the on-demand loop.
      this.invalidate();
    });
    controlsEvents.addEventListener("change", () => {
      this.invalidate();
    });

    // Official three.js editor-style XYZ orientation gizmo (top-right).
    this.viewHelperVisible = options.viewHelper !== false;
    this.renderer.autoClear = false;
    this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    this.viewHelper.center = this.controls.target;
    this.viewHelper.setLabels("X", "Y", "Z");
    this.viewHelper.adaptToBackground(this.scene.background as THREE.Color);

    this.antialias = this.normalizeAntialias(options.antialias ?? 4);

    // Selection outline — same stack as three.js `webgl_postprocessing_outline`.
    // MSAA on composer RTs (renderer.antialias alone does not apply through EffectComposer).
    const size = this.renderer.getSize(new THREE.Vector2());
    const pr = this.renderer.getPixelRatio();
    const composerTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(size.width * pr)),
      Math.max(1, Math.floor(size.height * pr)),
      { type: THREE.HalfFloatType, samples: this.antialias }
    );
    composerTarget.texture.name = "EffectComposer.rt1";
    this.composer = new EffectComposer(this.renderer, composerTarget);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.outlinePass = new OutlinePass(
      new THREE.Vector2(1, 1),
      this.scene,
      this.camera
    );
    this.outlinePass.pulsePeriod = 0;
    this.syncSelectionOutline();
    this.composer.addPass(this.outlinePass);
    this.composer.addPass(new OutputPass());
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaaPass);
    this.fxaaPass.enabled = false;

    this.viewHelperClickEnabled = options.viewHelperClick !== false;
    if (this.viewHelperClickEnabled) {
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
        if (!this.viewHelperVisible) return;
        if (!down || down.button !== 0 || event.button !== 0) return;
        const dx = event.clientX - down.x;
        const dy = event.clientY - down.y;
        if (dx * dx + dy * dy > PICK_DRAG_PX * PICK_DRAG_PX) return;
        if (this.viewHelper.handleClick(event)) {
          this.invalidate();
        }
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

    const wantPlane =
      (options.planeHelper ?? options.gridHelper) !== false;
    this.planeHelperVisible = wantPlane;
    this.axesHelperVisible = options.axesHelper !== false;

    // Drop HMR leftovers (old grid / plane / axes names).
    for (const child of [...this.scene.children]) {
      if (
        child.name !== "svg3dx-world-axes" &&
        child.name !== "svg3dx-world-plane" &&
        child.name !== "svg3dx-world-grid" &&
        child.name !== "svg3dx-world-grid-xy" &&
        child.name !== "svg3dx-world-grid-z"
      ) {
        continue;
      }
      this.scene.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
          return;
        }
        const line = obj as THREE.Line;
        if (line.isLine) {
          line.geometry.dispose();
          const mat = line.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
        }
      });
    }

    // Always create helpers so the settings menu can toggle them at runtime.
    this.planeHelper = new PlaneHelper(PLANE_UNIT, PLANE_COLOR);
    this.planeHelper.visible = this.planeHelperVisible;
    this.scene.add(this.planeHelper);

    this.axesHelper = new THREE.AxesHelper(AXES_UNIT);
    this.axesHelper.name = "svg3dx-world-axes";
    this.axesHelper.visible = this.axesHelperVisible;
    // Draw above PlaneHelper (1) and other scene solids (0).
    this.axesHelper.renderOrder = 2;
    const axesMats = Array.isArray(this.axesHelper.material)
      ? this.axesHelper.material
      : [this.axesHelper.material];
    for (const m of axesMats) {
      m.transparent = true;
      m.depthWrite = false;
      // Bias toward camera so axes win over coplanar plane/entity faces.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
    }
    this.scene.add(this.axesHelper);

    this.viewer = new Svg3dxViewer(this.scene);

    const onParamPanelEdited = (p: ParamMap) => {
      // External host ParamPanel: full-map setParams (diff vs `:root` seeds).
      void this.setParams(p);
      this.onParamsChange?.(p);
    };
    const onParamsBarEdited = (p: ParamMap) => {
      // Notification only — pins go through onPin so seed-equal values stick.
      this.onParamsChange?.(p);
    };
    const onParamPin = (name: string, value: string | number | boolean) => {
      void this.pinParam(name, value);
    };
    const onParamUnpin = (name: string) => {
      void this.unpinParam(name);
    };
    const onTogglePlay = () => {
      this.setAnimationPlaying(!this.getAnimationPlaying());
    };

    this.paramPanel = options.paramsEl
      ? new ParamPanel(options.paramsEl, { onChange: onParamPanelEdited })
      : null;

    const wantSettingsBar = options.settingsBar !== false;
    const showModelBar = options.modelBar !== false;
    const showParamsBar = options.paramsBar !== false;
    const wantDisplayModeBar = options.displayModeBar !== false;
    // Build bars whenever the settings menu can toggle them later.
    const buildModelBar = showModelBar || wantSettingsBar;
    const buildParamsBar = showParamsBar || wantSettingsBar;
    this.uiPrefs = {
      settingsButton: wantSettingsBar,
      modelBar: showModelBar,
      paramsBar: showParamsBar,
    };
    if (wantSettingsBar || buildModelBar || buildParamsBar || wantDisplayModeBar) {
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

    // Settings first (top-left), then model / params / display mode below.
    this.settingsBar = wantSettingsBar
      ? new SettingsBar(this.leftChrome!, {
          locale: this.locale,
          initial: {
            settingsButton: true,
            modelBar: showModelBar,
            paramsBar: showParamsBar,
            viewHelper: this.viewHelperVisible,
            axesHelper: this.axesHelperVisible,
            planeHelper: this.planeHelperVisible,
            antialias: this.antialias,
            kernel: this.displayModes.kernel,
            svg3dx: this.displayModes.svg3dx,
          },
          onChange: (state) => this.applyUiState(state),
        })
      : null;

    this.displayModeBar = wantDisplayModeBar
      ? new DisplayModeBar(this.leftChrome!, {
          initial: this.displayModes,
          locale: this.locale,
          onChange: (state) => {
            this.displayModes = state;
            this.settingsBar?.setState(state);
            this.applyDisplayLayout();
          },
        })
      : null;

    this.modelBar = buildModelBar
      ? new ModelBar(this.leftChrome!, {
          locale: this.locale,
          onChange: (id) => {
            void this.setModel(id, { fitCamera: true });
            this.onModelChange?.(id);
          },
        })
      : null;
    this.modelBar?.setVisible(showModelBar);

    this.paramsBar = buildParamsBar
      ? new ParamsBar(this.leftChrome!, {
          onPin: onParamPin,
          onUnpin: onParamUnpin,
          onTogglePlay,
          locale: this.locale,
          onChange: onParamsBarEdited,
        })
      : null;
    this.paramsBar?.setVisible(showParamsBar);

    const ro = new ResizeObserver(() => this.scheduleResize());
    ro.observe(this.canvasWrap);
    ro.observe(this.stage);
    (this as unknown as { _ro: ResizeObserver })._ro = ro;

    this.resize();
    // Demand-driven: idle static scenes do not keep a RAF loop alive.
    this.invalidate();
  }

  /**
   * Schedule a redraw on the next animation frame.
   * Safe to call often; coalesces to one pending frame.
   * Hosts that mutate overlay scenes / gizmos should call this.
   */
  invalidate(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => this.tick());
  }

  /**
   * Keep rendering every frame while `enabled` (e.g. skeletal / clip animation).
   * Off by default — static models only redraw on camera / content changes.
   */
  setContinuousRender(enabled: boolean): void {
    this.continuousRender = enabled;
    if (enabled) this.invalidate();
  }

  getContinuousRender(): boolean {
    return this.continuousRender;
  }

  /** Start / pause SMIL-shaped document animations (param + transform). */
  setAnimationPlaying(playing: boolean): void {
    this.animation.setPlaying(playing);
    if (playing && this.animation.hasAnimations) {
      this.setContinuousRender(true);
    } else if (!this.animation.hasAnimations) {
      this.setContinuousRender(false);
    }
    this.syncLiveParamDisplay();
    this.invalidate();
  }

  getAnimationPlaying(): boolean {
    return this.animation.isPlaying;
  }

  /** Reset the document animation clock to t=0. */
  resetAnimationClock(): void {
    this.animation.resetClock();
    this.animParamOverrides = {};
    this.invalidate();
  }

  hasDocumentAnimations(): boolean {
    return this.animation.hasAnimations;
  }

  getAnimationTime(): number {
    return this.animation.getDocTime();
  }

  /** Scrub document animation time (seconds). Applies samples immediately (works while paused). */
  setAnimationTime(timeSecs: number): void {
    if (!this.animation.hasAnimations) return;
    this.animation.setDocTime(timeSecs);
    const frame = this.animation.sampleAtDocTime();
    this.animParamOverrides = frame.paramOverrides;
    this.syncLiveParamDisplay();
    if (frame.paramsChanged) this.queueAnimReload();
    this.invalidate();
  }

  /** Timeline length for the scrubber (seconds). */
  getAnimationDuration(): number {
    return this.animation.getLoopDuration();
  }

  private tick(): void {
    this.raf = 0;
    // Clamp so a long idle gap does not jump ViewHelper home animation.
    const delta = Math.min(this.clock.getDelta(), 0.1);
    // Skip OrbitControls while ViewHelper owns the camera, otherwise lookAt
    // fights the axis-home animation every frame.
    let keepGoing = this.continuousRender;
    if (this.viewHelperVisible && this.viewHelper.animating) {
      this.viewHelper.update(delta);
      keepGoing = true;
    }
    if (!(this.viewHelperVisible && this.viewHelper.animating)) {
      // update() returns true while damping / user motion still changes the camera.
      if (this.controls.update()) keepGoing = true;
    }
    this.applyAnimationFrame(delta);
    // Keep plane/axes at a stable screen fraction while orbiting/zooming.
    this.syncWorldHelpersSize();
    this.paint();
    if (keepGoing || this.animation.isPlaying) this.invalidate();
  }

  private applyAnimationFrame(delta: number): void {
    const frame = this.animation.applyFrame(delta);
    if (!frame) return;
    if (frame.paramsChanged) {
      this.animParamOverrides = frame.paramOverrides;
      this.syncLiveParamDisplay();
      // Pinned keys already win in eval — skip reload when nothing unpinned moved.
      if (this.hasUnpinnedAnimParamUpdate(frame.paramOverrides)) {
        this.queueAnimReload();
      }
    }
  }

  /** True when an animation sample changed for a key that is not externally pinned. */
  private hasUnpinnedAnimParamUpdate(overrides: ParamMap): boolean {
    for (const k of Object.keys(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(this.params, k)) return true;
    }
    return false;
  }

  private queueAnimReload(): void {
    if (this.animReloadQueued || !this.svgText || this.plainSvg) return;
    this.animReloadQueued = true;
    void this.reload({ fitCamera: false, fromAnimation: true }).finally(() => {
      this.animReloadQueued = false;
    });
  }

  /**
   * Objects that receive the official OutlinePass contour
   * (does not alter materials).
   */
  setSelectedObjects(objects: THREE.Object3D[]): void {
    this.outlinePass.selectedObjects = objects;
    this.invalidate();
  }

  getSelectedObjects(): THREE.Object3D[] {
    return this.outlinePass.selectedObjects;
  }

  /**
   * Register a scene rendered after the composer (selection outline).
   * Use for editor gizmos that must not affect OutlinePass.
   */
  addOverlayScene(scene: THREE.Scene): void {
    if (this.overlayScenes.includes(scene)) return;
    this.overlayScenes.push(scene);
    this.invalidate();
  }

  removeOverlayScene(scene: THREE.Scene): void {
    const i = this.overlayScenes.indexOf(scene);
    if (i >= 0) this.overlayScenes.splice(i, 1);
    this.invalidate();
  }

  async loadSvg(
    svgText: string,
    options: {
      fitCamera?: boolean;
      documentBaseUrl?: string;
      documentAssetUrls?: Record<string, string>;
    } = {}
  ): Promise<EvaluationResult> {
    this.svgText = svgText;
    if (options.documentBaseUrl !== undefined) {
      this.documentBaseUrl = options.documentBaseUrl;
    }
    if (options.documentAssetUrls !== undefined) {
      this.documentAssetUrls = { ...options.documentAssetUrls };
    }
    this.seedParams = extractStyleParams(svgText);
    // Fresh document: drop prior external pins (DOM seeds are not external).
    this.params = {};
    this.animParamOverrides = {};
    this.animation.clear();
    return this.reload({ fitCamera: options.fitCamera !== false });
  }

  /**
   * Base URL for relative `s3dx:gltf` href resolution (SVG document base).
   */
  setDocumentBaseUrl(url: string | undefined): void {
    this.documentBaseUrl = url;
  }

  getDocumentBaseUrl(): string | undefined {
    return this.documentBaseUrl;
  }

  /** Local sidecar map for relative glTF hrefs (blob: URLs etc.). */
  setDocumentAssetUrls(urls: Record<string, string> | undefined): void {
    this.documentAssetUrls = urls ? { ...urls } : undefined;
  }

  getDocumentAssetUrls(): Record<string, string> | undefined {
    return this.documentAssetUrls ? { ...this.documentAssetUrls } : undefined;
  }

  /**
   * Update document text + re-evaluate without reframing the camera.
   * Use when only `<style>` / params changed so the viewport does not "flash".
   */
  async applySvg(
    svgText: string,
    options: {
      fitCamera?: boolean;
      documentBaseUrl?: string;
      documentAssetUrls?: Record<string, string>;
    } = {}
  ): Promise<EvaluationResult> {
    this.svgText = svgText;
    if (options.documentBaseUrl !== undefined) {
      this.documentBaseUrl = options.documentBaseUrl;
    }
    if (options.documentAssetUrls !== undefined) {
      this.documentAssetUrls = { ...options.documentAssetUrls };
    }
    this.seedParams = extractStyleParams(svgText);
    // Keep user pins that still exist on `:root`; do not re-elevate DOM seeds.
    this.params = pruneOverridesToSeed(this.params, this.seedParams);
    this.animParamOverrides = {};
    // Soft document replace: re-discover animations and restart the clock.
    this.animation.clear();
    return this.reload({ fitCamera: options.fitCamera === true });
  }

  async setParams(params: ParamMap): Promise<EvaluationResult | null> {
    // Host API full map: values that differ from `:root` seeds become pins.
    this.params =
      Object.keys(this.seedParams).length > 0
        ? externalOverridesFromDisplay(params, this.seedParams)
        : { ...params };
    if (!this.svgText) return null;
    return this.reload({ fitCamera: false });
  }

  /**
   * Pin one external override (ParamsBar edit). Always pins — including when
   * the value equals the `:root` seed — and pauses playback if that key is
   * animation-driven so the scene visibly stops.
   */
  async pinParam(
    name: string,
    value: string | number | boolean
  ): Promise<EvaluationResult | null> {
    this.params = { ...this.params, [name]: value };
    if (this.rootAnimatedParamNames().has(name)) {
      this.setAnimationPlaying(false);
    }
    // Drop stale anim sample for this key so merge cannot race a late frame.
    if (name in this.animParamOverrides) {
      const nextAnim = { ...this.animParamOverrides };
      delete nextAnim[name];
      this.animParamOverrides = nextAnim;
    }
    this.syncLiveParamDisplay();
    if (!this.svgText) return null;
    return this.reload({ fitCamera: false });
  }

  /** Drop an explicit external pin so animation / DOM can drive the key again. */
  async unpinParam(name: string): Promise<EvaluationResult | null> {
    if (!(name in this.params)) return this.lastResult;
    const next = { ...this.params };
    delete next[name];
    this.params = next;
    if (!this.svgText) return null;
    return this.reload({ fitCamera: false });
  }

  getParams(): ParamMap {
    return { ...this.seedParams, ...this.params };
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

  /**
   * On-demand extra named defs group ids (beyond the active model).
   * Reloads geometry when document text is already loaded unless `reload: false`.
   */
  async setExtraDefs(
    ids: string[],
    options: { fitCamera?: boolean; reload?: boolean; force?: boolean } = {}
  ): Promise<EvaluationResult | null> {
    const next = [...new Set(ids.filter(Boolean))];
    const same =
      next.length === this.extraDefs.length &&
      next.every((id, i) => id === this.extraDefs[i]);
    if (
      same &&
      this.lastResult &&
      options.reload !== false &&
      options.force !== true
    ) {
      return this.lastResult;
    }
    this.extraDefs = next;
    if (options.reload === false || !this.svgText) {
      return this.lastResult;
    }
    return this.reload({ fitCamera: options.fitCamera === true });
  }

  getExtraDefs(): string[] {
    return [...this.extraDefs];
  }

  setMode(mode: string | undefined): void {
    this.mode = mode;
  }

  /** Update Three.js scene clear / backdrop color (hex number or CSS color string). */
  setBackground(color: number | string): void {
    const bg = new THREE.Color(color);
    this.scene.background = bg;
    this.viewHelper.adaptToBackground(bg);
    this.invalidate();
  }

  /**
   * Gold selection edge — same NormalBlending + alpha overlay for light and
   * dark (stock AdditiveBlending washes out on pale page gray).
   */
  private syncSelectionOutline(): void {
    applySelectionEdgeColors();
    this.outlinePass.visibleEdgeColor.copy(SELECTION_EDGE);
    this.outlinePass.hiddenEdgeColor.copy(SELECTION_EDGE_HIDDEN);
    this.outlinePass.edgeStrength = SELECTION_OUTLINE_TUNING.edgeStrength;
    this.outlinePass.edgeThickness = SELECTION_OUTLINE_TUNING.edgeThickness;
    this.outlinePass.edgeGlow = SELECTION_OUTLINE_TUNING.edgeGlow;

    if (this.outlineOverlayReady) return;
    const mat = this.outlinePass.overlayMaterial;
    mat.blending = THREE.NormalBlending;
    mat.fragmentShader = OUTLINE_OVERLAY_FS_ALPHA;
    mat.transparent = true;
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.needsUpdate = true;
    this.outlineOverlayReady = true;
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
    this.settingsBar?.setState(this.displayModes);
    this.applyDisplayLayout();
  }

  getUiState(): ViewerUiState {
    return {
      settingsButton: this.uiPrefs.settingsButton,
      modelBar: this.uiPrefs.modelBar,
      paramsBar: this.uiPrefs.paramsBar,
      viewHelper: this.viewHelperVisible,
      axesHelper: this.axesHelperVisible,
      planeHelper: this.planeHelperVisible,
      antialias: this.antialias,
      kernel: this.displayModes.kernel,
      svg3dx: this.displayModes.svg3dx,
    };
  }

  /** Update overlay / helper / antialias preferences (settings menu + host API). */
  setUiState(partial: Partial<ViewerUiState>): void {
    this.applyUiState({ ...this.getUiState(), ...partial });
    this.settingsBar?.setState(partial);
  }

  getAntialias(): AntialiasLevel {
    return this.antialias;
  }

  setAntialias(level: AntialiasLevel): void {
    this.setUiState({ antialias: level });
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
    this.settingsBar?.setLocale(locale);
  }

  private applyUiState(state: ViewerUiState): void {
    this.uiPrefs.settingsButton = state.settingsButton;
    this.uiPrefs.modelBar = state.modelBar;
    this.uiPrefs.paramsBar = state.paramsBar;

    this.viewHelperVisible = state.viewHelper;
    this.axesHelperVisible = state.axesHelper;
    this.planeHelperVisible = state.planeHelper;
    if (this.axesHelper) this.axesHelper.visible = state.axesHelper;
    if (this.planeHelper) this.planeHelper.visible = state.planeHelper;

    this.modelBar?.setVisible(state.modelBar);
    this.paramsBar?.setVisible(state.paramsBar);

    const aa = this.normalizeAntialias(state.antialias);
    if (aa !== this.antialias) {
      this.antialias = aa;
      this.applyAntialiasSamples(aa);
    }

    const modesChanged =
      state.kernel !== this.displayModes.kernel ||
      state.svg3dx !== this.displayModes.svg3dx;
    if (modesChanged) {
      this.displayModes = { kernel: state.kernel, svg3dx: state.svg3dx };
      this.displayModeBar?.setState(this.displayModes);
      this.applyDisplayLayout();
    }
    this.invalidate();
  }

  private normalizeAntialias(level: number): AntialiasLevel {
    if (level === 2 || level === 4 || level === 8) return level;
    return 0;
  }

  private applyAntialiasSamples(samples: AntialiasLevel): void {
    const apply = (rt: THREE.WebGLRenderTarget | null | undefined) => {
      if (!rt) return;
      rt.samples = samples;
    };
    apply(this.composer.renderTarget1);
    apply(this.composer.renderTarget2);
    const w = this.canvasWrap.clientWidth || 1;
    const h = this.canvasWrap.clientHeight || 1;
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.fxaaPass.enabled = false;
    this.paint();
  }

  private async reload(
    options: { fitCamera?: boolean; fromAnimation?: boolean } = {}
  ): Promise<EvaluationResult> {
    const gen = ++this.reloadGeneration;
    this.plainSvg = !isSvg3dxDocument(this.svgText);
    this.applyDisplayLayout();

    let result: EvaluationResult;
    if (this.plainSvg) {
      // Core refuses evaluation without svg3d="true"; still show 2D via svg2d + kernel.
      result = emptyEvaluationResult();
    } else {
      // Spec §2.3: external (host/UI params) > animation samples > DOM.
      const evalParams: ParamMap = {
        ...this.animParamOverrides,
        ...this.params,
      };
      result = await parseSvg(this.svgText, evalParams, this.model, {
        retainInactive: this.retainInactive,
        extraDefs: this.extraDefs,
      });
    }

    if (gen !== this.reloadGeneration) {
      return this.lastResult ?? result;
    }

    this.lastResult = result;
    if (result.warnings.length) this.onWarnings?.(result.warnings);
    // Queue scene binds so an older hydrate cannot clear a newer one mid-flight.
    const bind = this.fromResultQueue.then(async () => {
      if (gen !== this.reloadGeneration) return;
      await this.viewer.fromResult(
        result,
        this.mode,
        // Always pass markup so ordinary SVG tags become XY-plane primitives.
        this.svgText,
        this.documentBaseUrl,
        this.documentAssetUrls
      );
    });
    this.fromResultQueue = bind.catch(() => {});
    await bind;
    if (gen !== this.reloadGeneration) {
      return this.lastResult ?? result;
    }
    this.syncAnimationsAfterBind(result, !options.fromAnimation);
    this.syncWorldHelpersSize();
    this.syncKernelHost();
    // Param anim reloads every sampled frame — rebuilding ParamsBar would steal
    // focus and make the list uneditable while the clock runs.
    if (!options.fromAnimation) {
      this.syncChromeForDocument(result);
    }
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
    this.invalidate();
    return result;
  }

  /**
   * Install animation descriptors from eval result and (re)bind transform targets.
   * @param resetClock when true (document load), restart t=0 and auto-play.
   */
  private syncAnimationsAfterBind(
    result: EvaluationResult,
    resetClock: boolean
  ): void {
    const descs = (result.animations ?? []) as AnimationDesc[];
    if (resetClock) {
      this.animation.reset(descs);
      this.animParamOverrides = {};
      if (this.animation.hasAnimations) {
        this.setContinuousRender(true);
      }
    } else if (!this.animation.hasAnimations && descs.length) {
      // First time we see animations without a prior reset (e.g. hot path).
      this.animation.reset(descs);
      this.setContinuousRender(true);
    }
    this.animation.bindTransforms(this.viewer.root);
  }

  /** Root-scope `s3dx:animate` attribute names (bare, no `--`). */
  private rootAnimatedParamNames(): Set<string> {
    const out = new Set<string>();
    const anims = (this.lastResult?.animations ?? []) as AnimationDesc[];
    for (const a of anims) {
      if (a.kind !== "param" || !a.root_scope) continue;
      out.add(a.attribute_name.replace(/^--+/, ""));
    }
    return out;
  }

  private paramRowState(): Record<string, ParamRowState> {
    const animated = this.rootAnimatedParamNames();
    const state: Record<string, ParamRowState> = {};
    for (const name of new Set([
      ...Object.keys(this.seedParams),
      ...Object.keys(this.params),
      ...animated,
    ])) {
      state[name] = {
        animated: animated.has(name),
        pinned: Object.prototype.hasOwnProperty.call(this.params, name),
        playing: this.animation.isPlaying,
      };
    }
    return state;
  }

  /** seed ∪ explicit pins — safe to emit from ParamsBar without pinning live samples. */
  private committedParamDisplay(): ParamMap {
    return { ...this.seedParams, ...this.params };
  }

  /**
   * Live chrome values: committed pins, plus animation samples for unpinned
   * animated keys (§2.3 / §2.5).
   */
  private effectiveParamDisplay(): ParamMap {
    const animated = this.rootAnimatedParamNames();
    const live: ParamMap = { ...this.committedParamDisplay() };
    for (const [k, v] of Object.entries(this.animParamOverrides)) {
      if (
        animated.has(k) &&
        !Object.prototype.hasOwnProperty.call(this.params, k)
      ) {
        live[k] = v;
      }
    }
    return live;
  }

  private syncLiveParamDisplay(): void {
    this.paramsBar?.updateLiveValues(
      this.effectiveParamDisplay(),
      this.paramRowState()
    );
  }

  private syncParamsUi(result: EvaluationResult | null): void {
    const committed = this.committedParamDisplay();
    const live = this.effectiveParamDisplay();
    const descs = listParams(committed, result);
    this.paramPanel?.setParams(committed, descs);
    this.paramsBar?.setParams(committed, descs, this.paramRowState(), live);
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
    this.settingsBar?.setShowDisplayModes(this.plainSvg);
    this.paramsBar?.setDocumentAllowed(!this.plainSvg);
    if (this.plainSvg) {
      this.syncModelBar(result);
      return;
    }
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
    // Overlay gizmos: after outline so they never enter OutlinePass depth/edges.
    if (this.overlayScenes.length) {
      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      for (const overlay of this.overlayScenes) {
        this.renderer.clearDepth();
        this.renderer.render(overlay, this.camera);
      }
      this.renderer.autoClear = prevAutoClear;
    }
    if (this.viewHelperVisible) {
      this.viewHelper.render(this.renderer);
    }
  }

  /**
   * Scale PlaneHelper + AxesHelper to a fixed fraction of the viewport
   * (shorter screen side), at the current camera↔helper distance.
   */
  private syncWorldHelpersSize(): void {
    if (!this.planeHelperVisible && !this.axesHelperVisible) return;
    if (!this.planeHelper && !this.axesHelper) return;
    this.syncHelperFrame();
    const planeSize = this.screenHelperPlaneSize();
    if (this.planeHelper) {
      this.planeHelper.scale.setScalar(planeSize / PLANE_UNIT);
    }
    if (this.axesHelper) {
      const axesLen = (planeSize / 2) * AXES_OVER_PLANE_HALF;
      this.axesHelper.scale.setScalar(axesLen / AXES_UNIT);
    }
  }

  /** Copy the active frame onto axes + plane. Null frame stays at the world origin. */
  private syncHelperFrame(): void {
    const src = this.helperFrame;
    if (!src) {
      this.helperAnchor.set(0, 0, 0);
      this.axesHelper?.position.set(0, 0, 0);
      this.axesHelper?.quaternion.identity();
      this.planeHelper?.position.set(0, 0, 0);
      this.planeHelper?.quaternion.identity();
      return;
    }
    src.updateWorldMatrix(true, false);
    src.matrixWorld.decompose(this.helperPos, this.helperQuat, this.helperScale);
    this.helperAnchor.copy(this.helperPos);
    if (this.axesHelper) {
      this.axesHelper.position.copy(this.helperPos);
      this.axesHelper.quaternion.copy(this.helperQuat);
    }
    if (this.planeHelper) {
      this.planeHelper.position.copy(this.helperPos);
      this.planeHelper.quaternion.copy(this.helperQuat);
    }
  }

  /** World-unit plane edge length ≈ `PLANE_SCREEN_FRACTION` of the shorter view side. */
  private screenHelperPlaneSize(): number {
    const dist = Math.max(
      this.camera.position.distanceTo(this.helperAnchor),
      1e-4
    );
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * dist * Math.tan(vFov * 0.5);
    const viewW = viewH * Math.max(this.camera.aspect, 1e-4);
    const shorter = Math.min(viewW, viewH);
    return Math.max(shorter * PLANE_SCREEN_FRACTION, 1e-3);
  }

  dispose(): void {
    this.animation.clear();
    this.animParamOverrides = {};
    this.setContinuousRender(false);
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
    if (this.planeHelper) {
      this.scene.remove(this.planeHelper);
      this.planeHelper.dispose();
      this.planeHelper = null;
    }
    const ro = (this as unknown as { _ro?: ResizeObserver })._ro;
    ro?.disconnect();
    this.settingsBar?.dispose();
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
