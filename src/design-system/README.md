# Component API

全局设计决策见 `../../design-system/doupao/MASTER.md`。

公开出口是 `src/design-system/index.ts`。业务代码只从该出口导入，不直接读取
`components.tsx`。运行时 Token 和组件样式位于 `styles.css`，已在 `src/main.tsx`
全局加载；`tokens.tokens.json` 是供设计工具和 AI 使用的 DTCG 交换副本。

开发期运行 `npm run dev` 后访问 `/?design-system=1` 查看活预览。

完整组件规范见 `../../design-system/doupao/COMPONENTS.md`。当前公开出口覆盖基础、布局、
表单、导航、数据展示、反馈和浮层七类。具体数量以 `catalog.ts` 和 `catalog.test.ts`
自动覆盖结果为准。

复杂弹窗统一使用 `DialogWorkspace` + `DialogPane`，避免在同一个 Dialog 的不同 Tab 内
各自套页面背景、卡片和滚动容器。`SelectField` 只处理选值；命令型下拉使用 `Menu`。

`catalog.ts` 同时登记项目全部正式 UI 模块。`catalog.test.ts` 会将登记表与
`src/components/**/*.tsx`、`src/features/**/*.tsx` 的真实文件进行双向比对；任何遗漏或
过期记录都会使测试失败。

新增组件前确认至少存在两个真实复用场景；否则保留在业务目录。
