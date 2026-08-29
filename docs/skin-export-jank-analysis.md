# 皮肤与导出卡顿：复盘及当前约束

## 结论

此前的主要放大器不是 Canvas 导出结果受皮肤影响，而是玻璃皮肤在导出页面的大量 DOM 更新上叠加了高成本合成效果：

- 全屏 `body::before` 动画模糊层持续参与合成；
- 卡片、输入框和常用 Tailwind 背景类批量启用 `backdrop-filter`；
- 导出进度更新、滚动和列表重绘反复触发这些模糊层重合成；
- 手绘皮肤的远程字体加载又引入网络等待与不稳定的首次渲染。

导出图像仍由独立 Canvas 2D 管线生成，皮肤不进入导出内容或缓存键。因此正确修复点是限制 UI 合成成本，而不是让导出渲染器感知皮肤。

## 已实施的修复

### 1. 玻璃效果改为有限预算

`src/theme/styles/skins/glass.css`：

- 删除全屏动画极光层，只保留 `body` 上的静态径向光晕；
- 常规卡片、面板、表格、代码块和输入控件只使用半透明背景，不再单独模糊；
- `backdrop-filter` 仅允许用于明确列出的关键浮层和固定导航：
  `.ds-dialog`、`.ds-popover`、`.ds-menu`、`.app-header`、`.ds-sidebar`、`.doupao-side-panel`；
- 模糊强度从 18px 降为 12px，并降低饱和处理；
- 导出降级按同一组明确选择器关闭模糊，不再使用 `[data-exporting] *` 通配规则。

`src/theme/styles/skins.css`：

- 历史 Tailwind 工具类兼容桥仍可把旧组件映射为半透明表面；
- 兼容桥不再为 `.bg-white` 等常用类批量添加 `backdrop-filter`。

这使模糊层数量由“随页面卡片数量增长”变为固定上限，日常仍保留玻璃辨识度，导出页面也不会因列表规模线性增加合成层。

### 2. 字体改为离线可靠

- `src/theme/styles/skins/handdrawn.css` 与 `retro.css` 使用本地系统字体栈；
- `src/theme/appearance.ts` 不再在运行时注入远程字体链接；
- 皮肤规范禁止远程 `@import url(...)`。确需自定义字体时，应将裁剪后的 WOFF2 随应用打包并使用 `font-display: swap`。

### 3. 将性能边界写入契约测试

`src/theme/skinContract.test.ts` 会阻止以下问题回归：

- 皮肤注册表、CSS 文件与入口导入不一致；
- 皮肤覆盖布局 Token；
- 普通文字、按钮文字与焦点环的关键对比度不达标；
- 皮肤重新引入远程字体；
- 玻璃皮肤恢复全屏动画模糊、全局工具类模糊或导出通配降级。

## 尚需按数据决定的优化

导出管线本身仍包含 JPEG 质量搜索与频繁进度更新。它们是独立于皮肤的 CPU/React 成本，只有在上述 UI 合成问题修复后仍能稳定复现卡顿时，才应继续做：

1. 用 Performance 录制确认长任务来自编码还是 React 重渲染；
2. 若进度更新过密，再按约 50ms 合并状态更新；
3. 若长列表重渲染占主导，再考虑结果列表虚拟化；
4. 不在没有数据前引入 `contain`、虚拟列表或导出架构重写。

## 验证

```bash
npm test -- src/theme/skinContract.test.ts
npm run build
```

手工检查：

1. 在浅色和深色模式切换 `glass`；
2. 打开设置对话框、下拉菜单和侧栏，确认关键浮层仍有轻磨砂；
3. 在包含较多结果卡片的导出页滚动并运行导出；
4. DevTools Performance 中确认没有全屏动画模糊层，卡片数量增加不会同步增加 `backdrop-filter` 合成层。
