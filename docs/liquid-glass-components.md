# Liquid Glass 组件

本项目使用 [dpawlikowski/liquid-glass](https://github.com/dpawlikowski/liquid-glass) 的 MIT 开源 CSS 核心，固定在提交 `0e98505ee4964e63faf2c269ba49c3a18c635355`。原始样式与许可证位于 `src/vendor/liquid-glass/`，项目外观与布局位于 `src/liquid-glass.css`。

## 在其他页面复用

先加载开源核心，再加载项目皮肤。`glass-panel` 是底板，`glass-control` 用于输入容器、选择器和按钮，`glass-tinted` 是淡绿色的主要操作。无需 JS、React、构建或联网资源。

```html
<link rel="stylesheet" href="src/vendor/liquid-glass/liquid-glass.css">
<link rel="stylesheet" href="src/liquid-glass.css">
<div class="liquid-glass liquid-glass--simple glass-panel">
  <div class="liquid-glass__content">
    <button class="liquid-glass liquid-glass--simple glass-control glass-tinted">同步并更新</button>
    <label class="liquid-glass liquid-glass--simple glass-control glass-search">
      <input class="search-input" type="search" aria-label="搜索" placeholder="搜索">
    </label>
    <select class="liquid-glass liquid-glass--simple glass-control glass-select" aria-label="排序">
      <option>最近添加</option>
      <option>标题</option>
    </select>
  </div>
</div>
```

组件可覆盖 `--lg-tint`（RGB 三元组）、`--lg-opacity`、`--lg-blur`、`--lg-radius` 和 `--lg-shadow`；字体与文字颜色继承页面。默认控件高 36px，控件圆角 12px，底板圆角 24px。

## 性能选择

顶栏全部使用上游 `liquid-glass--simple` 模式：背景模糊、透明染色、静态色散和柔和高光。它没有真实 SVG 背景折射；这是明确的性能取舍，而非苹果原生材质的等价实现。底板模糊为 10px，内层控件仅 2px。控件染色层不透明度为 6%，底板为 12%，高光仅保留在边缘。搜索框在常见桌面窗口下宽 260–320px，窄窗口宽 240px，工具栏用静态光泽竖线分组并保持单行；窄窗口先压缩操作为图标，再提供横向滚动。不注入 SVG，不复制背景，不运行 `requestAnimationFrame`、指针跟踪、持续脉冲或 WebGL 渲染，也不预先申请 `will-change` 图层。

原生选择器保留键盘操作和浏览器的顶层菜单；焦点、减少动态效果、减少透明效果与强制颜色模式均有独立样式。减少动态效果时取消按钮按压缩放，减少透明效果时使用实色背景。

设计参考 [Apple：Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass)：将玻璃用于控件和导航，克制使用颜色，避免拥挤和层层叠加。后续如需要真实背景折射，应单独测量目标设备成本，再决定是否启用；不能用库作者的“轻量”描述代替实际帧率验证。

通知玻璃与同步按钮共用 `--tinted-glass-background`、`--tinted-glass-blur`、`--tinted-glass-saturate` 和 `--tinted-glass-shadow`。通知仅随状态切换染色，原有波场、粒子及层级不变。
