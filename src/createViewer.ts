import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Svg3dxViewer } from "./scene.js";
import { ParamPanel } from "./ParamPanel.js";
import { extractStyleParams, listParams } from "./params.js";
import { initWasm, parseSvg, type ParamMap } from "./wasm.js";
import type { EvaluationResult } from "./types.js";

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
  readonly viewer: Svg3dxViewer;
  readonly paramPanel: ParamPanel | null;

  private canvasWrap: HTMLElement;
  private svgText = "";
  private params: ParamMap;
  private model?: string;
  private mode?: string;
  private lastResult: EvaluationResult | null = null;
  private raf = 0;
  private onParamsChange?: (params: ParamMap) => void;
  private onWarnings?: (warnings: string[]) => void;
  private onResult?: (result: EvaluationResult) => void;

  constructor(container: HTMLElement, options: CreateViewerOptions = {}) {
    this.container = container;
    this.params = { ...(options.params ?? {}) };
    this.model = options.model;
    this.mode = options.mode;
    this.onParamsChange = options.onParamsChange;
    this.onWarnings = options.onWarnings;
    this.onResult = options.onResult;

    container.style.position = container.style.position || "relative";
    this.canvasWrap = document.createElement("div");
    this.canvasWrap.style.cssText = "width:100%;height:100%;min-height:240px;";
    container.appendChild(this.canvasWrap);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0xe8eef2);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvasWrap.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 3, 4);
    this.scene.add(key);

    this.viewer = new Svg3dxViewer(this.scene);

    this.paramPanel = options.paramsEl
      ? new ParamPanel(options.paramsEl, {
          onChange: (p) => {
            void this.setParams(p);
            this.onParamsChange?.(p);
          },
        })
      : null;

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.canvasWrap);
    (this as unknown as { _ro: ResizeObserver })._ro = ro;

    this.resize();
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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

  setModel(model: string | undefined): void {
    this.model = model;
  }

  setMode(mode: string | undefined): void {
    this.mode = mode;
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
    this.viewer.fromResult(result, this.mode);
    if (options.fitCamera !== false) {
      this.viewer.fitCamera(this.camera, this.controls);
    }
    this.paramPanel?.setParams(this.params, listParams(this.params, result));
    this.onResult?.(result);
    return result;
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
    const ro = (this as unknown as { _ro?: ResizeObserver })._ro;
    ro?.disconnect();
    this.paramPanel?.dispose();
    this.renderer.dispose();
    this.canvasWrap.remove();
  }
}
