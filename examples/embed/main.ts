import { createViewer } from "svg3dx-viewer";

const viewport = document.getElementById("viewport")!;
const paramsEl = document.getElementById("params")!;
const statusEl = document.getElementById("status")!;
const reloadBtn = document.getElementById("reload") as HTMLButtonElement;

const embed = await createViewer(viewport, {
  paramsEl,
  onWarnings: (w) => console.warn(w),
  onResult: (r) => {
    statusEl.textContent = `${r.instructions.length} groups · model=${r.active_model ?? "?"}`;
  },
  onParamsChange: (p) => {
    statusEl.textContent = `params updated (${Object.keys(p).length})`;
  },
});

async function loadSample() {
  statusEl.textContent = "loading sample…";
  const res = await fetch("/api/sample");
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  await embed.loadSvg(text);
}

reloadBtn.addEventListener("click", () => {
  void loadSample().catch((e) => {
    statusEl.textContent = String(e);
    console.error(e);
  });
});

void loadSample().catch((e) => {
  statusEl.textContent = String(e);
  console.error(e);
});
