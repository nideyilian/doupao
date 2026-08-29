# shadcn 第三方组件

此目录用于隔离存放经过筛选的 shadcn 兼容组件，不替代
`src/design-system`。

## 接入规则

- 写入前预览 registry 内容：
  `npx shadcn@latest view <item-or-url>`
- 写入前检查计划变更：
  `npx shadcn@latest add <item-or-url> --dry-run`
- 不使用 `--overwrite`。
- 只引入现有设计系统缺少的组件。
- 进入产品界面前，将视觉样式适配到现有 `--ds-*` Token。
- 保留来源说明，并单独核对所选项目的许可证。
- 至少存在两个真实复用场景后，才考虑迁入 `src/design-system`。

根目录的 `components.json` 会将生成的 UI 文件定向到此目录，并把
registry 的工具函数导入映射到 `src/lib/shadcn.ts`。
