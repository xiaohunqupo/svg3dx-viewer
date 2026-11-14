<p align="center">
  <img src="assets/title.png" alt="svg 3dx viewer" width="360"/>
</p>

# svg3dx-viewer

svg3dx **查看器组件**（Viewer）：可嵌入网页，渲染三维配方，并提供可编辑的外部参数列表。

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
viewer.setParams({ R: 40, D: 180 });
```

API：`createViewer` / `loadSvg` / `setParams` / `getParams` / `ParamPanel`。

## 许可证

MIT OR MulanPSL-2.0。
