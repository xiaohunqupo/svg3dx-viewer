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
}

const ZH: ChromeStrings = {
  model: "模型",
  params: "参数",
  display: "显示",
  kernel: "内核",
  svg3dx: "svg3dx",
  noEditableParams: "无可编辑参数",
  paramsCount: (n) => `${n} 个参数`,
};

const EN: ChromeStrings = {
  model: "Model",
  params: "Params",
  display: "Display",
  kernel: "Kernel",
  svg3dx: "svg3dx",
  noEditableParams: "No editable params",
  paramsCount: (n) => `${n} param${n === 1 ? "" : "s"}`,
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
