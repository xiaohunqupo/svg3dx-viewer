<p align="center">
  <img src="assets/title.png" alt="svg 3dx viewer" width="360"/>
</p>

# svg3dx-viewer

svg3dx **查看器组件**（Viewer）：可嵌入网页，渲染三维配方，并提供可编辑的外部参数列表。定位为轻量显示；点击选中 / 高亮等编辑向交互由宿主（如 studio 的 `interact`）自行叠加。

## 关联库

| 仓库 | 职责 |
|------|------|
| [svg3dx](https://github.com/xiaohunqupo/svg3dx) | 格式规范与 samples |
| [svg3dx-core](https://github.com/xiaohunqupo/svg3dx-core) | 解析求值引擎（WASM） |
| **svg3dx-viewer**（本仓） | 嵌入式查看器组件 |
| [svg3dx-studio](https://github.com/xiaohunqupo/svg3dx-studio) | svg3dx 编辑器 |

## 安装 / 开发

本机需并列：`svg3dx-core`、`svg3dx`（示例）、本仓。

```powershell
cd ..\svg3dx-core
.\scripts\build-release.ps1   # 或至少 wasm-pack 产出 pkg/

cd ..\svg3dx-viewer
npm install
npm run dev                   # examples/embed
```

## 嵌入用法

```ts
import { createViewer } from "svg3dx-viewer";

const viewer = await createViewer(document.getElementById("view")!, {
  paramsEl: document.getElementById("params")!,
});
await viewer.loadSvg(svgText);
viewer.setParams({ H: 120 }); // only direct :root literals are accepted
```

API：`createViewer` / `loadSvg` / `setParams` / `getParams` / `setModel` / `ParamPanel`。

视口控件均可开关（默认开启）：

- `modelBar` — 左上角 Model 下拉
- `paramsBar` — Model 下方可折叠 Params（改参立刻重评）
- `viewHelper` — 右上角方位控件

## 许可证

MIT OR MulanPSL-2.0。
