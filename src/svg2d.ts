import * as THREE from "three";
import { Font, FontLoader } from "three/addons/loaders/FontLoader.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import helvetikerRegular from "three/examples/fonts/helvetiker_regular.typeface.json";

const S3DX_NS_0_1 = "urn:s3dx:draft:0.1";
const S3DX_NS_0_2 = "urn:s3dx:draft:0.2";

let defaultFont: Font | null = null;

/** Sync parse of the bundled Helvetiker face (vector glyph outlines). */
export function getDefaultSvg2dFont(): Font {
  if (!defaultFont) {
    defaultFont = new FontLoader().parse(helvetikerRegular);
  }
  return defaultFont;
}

/**
 * Turn ordinary SVG markup into Z-up world primitives on the XY plane
 * (svg3dx: XY = SVG plane, +Z up). s3dx:* elements are ignored.
 *
 * Text uses font outline → ShapeGeometry (vector mesh, stays sharp when zoomed).
 * Supported (draft): text, rect, circle, line, polyline, polygon, path, g.
 * Presentation attributes are honored; class/CSS rules are not fully resolved.
 */
export function buildSvg2dObjects(
  svgText: string,
  font: Font = getDefaultSvg2dFont()
): THREE.Group | null {
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
  if (parsed.querySelector("parsererror")) return null;
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== "svg") return null;

  const group = new THREE.Group();
  group.name = "svg2d";
  const ctx: StyleCtx = {
    fill: "#2563eb",
    stroke: "none",
    strokeWidth: 1,
    fontSize: 16,
    fontFamily: "sans-serif",
    opacity: 1,
    textAnchor: "start",
  };

  for (const child of Array.from(root.children)) {
    appendElement(child, group, ctx, font);
  }

  return group.children.length > 0 ? group : null;
}

interface StyleCtx {
  fill: string;
  stroke: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  opacity: number;
  textAnchor: "start" | "middle" | "end";
}

function isS3dx(el: Element): boolean {
  const ns = el.namespaceURI ?? "";
  if (ns === S3DX_NS_0_1 || ns === S3DX_NS_0_2) return true;
  return el.tagName.toLowerCase().startsWith("s3dx:");
}

function appendElement(
  el: Element,
  parent: THREE.Object3D,
  parentCtx: StyleCtx,
  font: Font
): void {
  if (isS3dx(el)) return;
  const name = el.localName.toLowerCase();
  if (
    name === "defs" ||
    name === "style" ||
    name === "script" ||
    name === "title" ||
    name === "desc"
  ) {
    return;
  }

  const ctx = mergeStyle(parentCtx, el);

  if (name === "g") {
    const g = new THREE.Group();
    g.name = el.getAttribute("id") ?? "g";
    for (const child of Array.from(el.children)) {
      appendElement(child, g, ctx, font);
    }
    if (g.children.length) parent.add(g);
    return;
  }

  let obj: THREE.Object3D | null = null;
  switch (name) {
    case "text":
      obj = makeText(el, ctx, font);
      break;
    case "rect":
      obj = makeRect(el, ctx);
      break;
    case "circle":
      obj = makeCircle(el, ctx);
      break;
    case "line":
      obj = makeLine(el, ctx);
      break;
    case "polyline":
      obj = makePoly(el, ctx, false);
      break;
    case "polygon":
      obj = makePoly(el, ctx, true);
      break;
    case "path":
      obj = makePath(el, ctx);
      break;
    default:
      break;
  }
  if (obj) parent.add(obj);
}

function mergeStyle(base: StyleCtx, el: Element): StyleCtx {
  const next = { ...base };
  const styleMap = parseInlineStyle(el.getAttribute("style") ?? "");
  const pick = (k: string, attrName: string) =>
    el.getAttribute(attrName) ?? styleMap[k] ?? null;

  const f = pick("fill", "fill");
  if (f === "none") next.fill = "none";
  else if (f) next.fill = f.trim();

  const s = pick("stroke", "stroke");
  if (s === "none") next.stroke = "none";
  else if (s) next.stroke = s.trim();

  const sw = pick("stroke-width", "stroke-width") ?? el.getAttribute("strokeWidth");
  if (sw) {
    const n = Number(sw);
    if (Number.isFinite(n)) next.strokeWidth = n;
  }
  const fs = pick("font-size", "font-size") ?? el.getAttribute("fontSize");
  if (fs) {
    const n = Number(String(fs).replace(/px$/i, ""));
    if (Number.isFinite(n)) next.fontSize = n;
  }
  const ff = pick("font-family", "font-family") ?? el.getAttribute("fontFamily");
  if (ff) next.fontFamily = ff.replace(/["']/g, "");
  const op = pick("opacity", "opacity");
  if (op) {
    const n = Number(op);
    if (Number.isFinite(n)) next.opacity = n;
  }
  const ta = pick("text-anchor", "text-anchor") ?? el.getAttribute("textAnchor");
  if (ta === "start" || ta === "middle" || ta === "end") next.textAnchor = ta;
  return next;
}

function parseInlineStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim().toLowerCase();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function numAttr(el: Element, name: string, fallback = 0): number {
  const v = Number(el.getAttribute(name));
  return Number.isFinite(v) ? v : fallback;
}

function makeText(el: Element, ctx: StyleCtx, font: Font): THREE.Object3D | null {
  const content = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!content) return null;
  const x = numAttr(el, "x", 0);
  const y = numAttr(el, "y", 0);
  const fontSize = ctx.fontSize;

  // Glyph outlines → ShapeGeometry (true vector mesh; sharp at any zoom).
  const shapes = font.generateShapes(content, fontSize);
  if (!shapes.length) return null;
  const geometry = new THREE.ShapeGeometry(shapes);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (bb) {
    const width = bb.max.x - bb.min.x;
    let dx = -bb.min.x;
    if (ctx.textAnchor === "middle") dx = -bb.min.x - width / 2;
    else if (ctx.textAnchor === "end") dx = -bb.min.x - width;
    // Keep baseline at y=0 (font space); SVG y is the baseline.
    geometry.translate(dx, 0, 0);
  }

  const mat = fillMaterial({ ...ctx, fill: ctx.fill === "none" ? "#2563eb" : ctx.fill });
  if (!mat) return null;
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, 0.05);
  mesh.name = "svg2d:text";
  mesh.userData.svg3dxSvg2d = true;
  return mesh;
}

function fillMaterial(ctx: StyleCtx): THREE.Material | null {
  if (ctx.fill === "none") return null;
  let color: THREE.Color;
  try {
    color = new THREE.Color(ctx.fill);
  } catch {
    color = new THREE.Color("#888888");
  }
  return new THREE.MeshBasicMaterial({
    color,
    transparent: ctx.opacity < 1,
    opacity: ctx.opacity,
    side: THREE.DoubleSide,
    depthWrite: ctx.opacity >= 1,
  });
}

function makeRect(el: Element, ctx: StyleCtx): THREE.Object3D | null {
  const x = numAttr(el, "x", 0);
  const y = numAttr(el, "y", 0);
  const w = numAttr(el, "width", 0);
  const h = numAttr(el, "height", 0);
  if (w <= 0 || h <= 0) return null;
  const mat = fillMaterial(ctx);
  if (!mat) return null;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x + w / 2, y + h / 2, 0.02);
  mesh.name = "svg2d:rect";
  mesh.userData.svg3dxSvg2d = true;
  return mesh;
}

function makeCircle(el: Element, ctx: StyleCtx): THREE.Object3D | null {
  const cx = numAttr(el, "cx", 0);
  const cy = numAttr(el, "cy", 0);
  const r = numAttr(el, "r", 0);
  if (r <= 0) return null;
  const mat = fillMaterial(ctx);
  if (!mat) return null;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 48), mat);
  mesh.position.set(cx, cy, 0.02);
  mesh.name = "svg2d:circle";
  mesh.userData.svg3dxSvg2d = true;
  return mesh;
}

function makeLine(el: Element, ctx: StyleCtx): THREE.Object3D | null {
  if (ctx.stroke === "none") return null;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(numAttr(el, "x1"), numAttr(el, "y1"), 0.03),
    new THREE.Vector3(numAttr(el, "x2"), numAttr(el, "y2"), 0.03),
  ]);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({
      color: new THREE.Color(ctx.stroke),
      transparent: ctx.opacity < 1,
      opacity: ctx.opacity,
    })
  );
  line.name = "svg2d:line";
  line.userData.svg3dxSvg2d = true;
  return line;
}

function parsePoints(raw: string | null): THREE.Vector2[] {
  if (!raw) return [];
  const nums = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push(new THREE.Vector2(nums[i], nums[i + 1]));
  }
  return pts;
}

function makePoly(
  el: Element,
  ctx: StyleCtx,
  closed: boolean
): THREE.Object3D | null {
  const pts = parsePoints(el.getAttribute("points"));
  if (pts.length < 2) return null;
  if (closed && pts.length >= 3) {
    const mat = fillMaterial(ctx);
    if (mat) {
      const shape = new THREE.Shape(pts);
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
      mesh.position.z = 0.02;
      mesh.name = "svg2d:polygon";
      mesh.userData.svg3dxSvg2d = true;
      return mesh;
    }
  }
  if (ctx.stroke === "none" && !closed) return null;
  const seq = pts.map((p) => new THREE.Vector3(p.x, p.y, 0.03));
  if (closed && seq.length) seq.push(seq[0]!.clone());
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(seq),
    new THREE.LineBasicMaterial({
      color: new THREE.Color(ctx.stroke === "none" ? "#111827" : ctx.stroke),
      transparent: ctx.opacity < 1,
      opacity: ctx.opacity,
    })
  );
  line.name = closed ? "svg2d:polygon" : "svg2d:polyline";
  line.userData.svg3dxSvg2d = true;
  return line;
}

function makePath(el: Element, ctx: StyleCtx): THREE.Object3D | null {
  const d = el.getAttribute("d");
  if (!d) return null;
  const parsed = new SVGLoader().parse(
    `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")}"/></svg>`
  );
  const g = new THREE.Group();
  g.name = "svg2d:path";
  g.userData.svg3dxSvg2d = true;
  for (const p of parsed.paths) {
    const shapes = SVGLoader.createShapes(p);
    const mat = fillMaterial(ctx);
    if (!mat) continue;
    for (const shape of shapes) {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat.clone());
      mesh.position.z = 0.02;
      g.add(mesh);
    }
  }
  return g.children.length ? g : null;
}
