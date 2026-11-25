export type {
  EvaluationResult,
  GeometryInstruction,
  MaterialDesc,
  ModelDesc,
  Value,
} from "./types.js";
export {
  BUILTIN_MATERIALS,
  DEFAULT_FILL,
  composeColor,
  materialLibraryFromResult,
  resolveAppearance,
  resolveMaterialDesc,
  toThreeMaterial,
} from "./materials.js";
export type { MaterialLibrary, ResolvedAppearance } from "./materials.js";
export type { ParamMap, ParseSvgOptions } from "./wasm.js";
export type { ParamDesc } from "./params.js";
export type { CreateViewerOptions } from "./createViewer.js";
export type { Svg3dxPickData } from "./pick.js";
export type { DisplayModeState } from "./DisplayModeBar.js";
export type {
  AntialiasLevel,
  ViewerUiState,
} from "./SettingsBar.js";
export type { FitCameraOptions, SceneBuildHooks } from "./scene.js";
export type { ViewerLocale, ChromeStrings } from "./chromeLocale.js";

export { initWasm, parseSvg } from "./wasm.js";
export {
  extractStyleParams,
  externalOverridesFromDisplay,
  listParams,
  paramValuesEqual,
  pruneOverridesToSeed,
} from "./params.js";
export { ParamPanel } from "./ParamPanel.js";
export { ModelBar } from "./ModelBar.js";
export { ParamsBar } from "./ParamsBar.js";
export { DisplayModeBar } from "./DisplayModeBar.js";
export { SettingsBar } from "./SettingsBar.js";
export {
  chromeStrings,
  detectViewerLocale,
} from "./chromeLocale.js";
export { Svg3dxViewer } from "./scene.js";
export { buildThreeObject } from "./primitive.js";
export {
  GLTF_Y_UP_TO_Z_UP,
  SVG3DX_GLTF_PENDING,
  SVG3DX_GLTF_INSTANCE,
  resolveGltfUrl,
  hydrateGltfPlaceholders,
  clearGltfCache,
} from "./gltf.js";
export type { GltfAssetUrlMap, GltfHydrateHooks } from "./gltf.js";
export { resolveActiveModel } from "./model.js";
export { createViewer, EmbedViewer } from "./createViewer.js";
export type {
  AnimationDesc,
  AnimationTiming,
  AnimateTransformType,
} from "./animation/types.js";
export { AnimationRuntime, findObjectByGroupId } from "./animation/runtime.js";
export {
  animationProgress,
  calcModeWeight,
  parseDurationSecs,
  parseRepeat,
  sampleAnimateTransformMatrix,
  sampleScalar,
} from "./animation/sample.js";
export { PlaneHelper } from "./PlaneHelper.js";
export {
  sectionFrame,
  parseSectionShapes2D,
  REVOLVE_DEFAULT_SECTION_XF,
} from "./section.js";
export { buildSvg2dObjects, getDefaultSvg2dFont } from "./svg2d.js";
export {
  isSvg3dxDocument,
  emptyEvaluationResult,
} from "./documentKind.js";
export {
  WORLD_UP,
  DEFAULT_VIEW_DIR,
  DEFAULT_EYE_OFFSET,
  TOP_EYE_OFFSET,
  applyWorldUp,
} from "./coords.js";
export {
  getPickData,
  matchesHighlight,
  pickPathFromObject,
  setPickData,
} from "./pick.js";
export { SelectionHighlight } from "./highlight.js";
