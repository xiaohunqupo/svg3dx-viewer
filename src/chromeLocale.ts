/** Viewer overlay chrome locale (independent of host app i18n). */

export type ViewerLocale = "zh" | "en";

export interface ChromeStrings {
  model: string;
  params: string;
  display: string;
  kernel: string;
  svg3dx: string;
  noEditableParams: string;
  paramsCount: (n: number) => string;
  /** Param row driven by s3dx:animate (playing) — click to pause. */
  paramAnimatedPlay: string;
  /** Param row driven by s3dx:animate (paused) — click to play. */
  paramAnimatedPause: string;
  /** Param row pinned over an animation track — click to clear. */
  paramPinnedOverAnim: string;
  settings: string;
  settingsButton: string;
  modelBar: string;
  paramsBar: string;
  viewHelper: string;
  axesHelper: string;
  planeHelper: string;
  antialias: string;
  antialiasNone: string;
  antialiasNx: (n: number) => string;
}

const ZH: ChromeStrings = {
  model: "模型",
  params: "参数",
  display: "显示",
  kernel: "内核",
  svg3dx: "svg3dx",
  noEditableParams: "无可编辑参数",
  paramsCount: (n) => `${n} 个参数`,
  paramAnimatedPlay: "动画播放中 — 点击暂停",
  paramAnimatedPause: "动画已暂停 — 点击播放",
  paramPinnedOverAnim: "已覆盖动画 — 点击取消覆盖",
  settings: "设置",
  settingsButton: "显示设置按键",
  modelBar: "显示模型列表",
  paramsBar: "显示参数列表",
  viewHelper: "显示 ViewHelper",
  axesHelper: "显示坐标轴",
  planeHelper: "显示网格",
  antialias: "抗锯齿",
  antialiasNone: "无",
  antialiasNx: (n) => `${n}x`,
};

const EN: ChromeStrings = {
  model: "Model",
  params: "Params",
  display: "Display",
  kernel: "Kernel",
  svg3dx: "svg3dx",
  noEditableParams: "No editable params",
  paramsCount: (n) => `${n} param${n === 1 ? "" : "s"}`,
  paramAnimatedPlay: "Animating — click to pause",
  paramAnimatedPause: "Paused — click to play",
  paramPinnedOverAnim: "Overriding animation — click to clear",
  settings: "Settings",
  settingsButton: "Show settings button",
  modelBar: "Show model list",
  paramsBar: "Show params list",
  viewHelper: "Show ViewHelper",
  axesHelper: "Show Axis",
  planeHelper: "Show grid",
  antialias: "Antialias",
  antialiasNone: "None",
  antialiasNx: (n) => `${n}x`,
};

export function chromeStrings(locale: ViewerLocale): ChromeStrings {
  return locale === "zh" ? ZH : EN;
}

/** Browser UI language → zh / en. */
export function detectViewerLocale(): ViewerLocale {
  if (typeof navigator === "undefined") return "en";
  const tags = [...(navigator.languages ?? []), navigator.language].filter(
    Boolean
  );
  for (const tag of tags) {
    if (/^zh\b/i.test(tag.trim())) return "zh";
  }
  return "en";
}
