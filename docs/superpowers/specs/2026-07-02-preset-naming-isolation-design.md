# 预设命名参数隔离设计

## 目标

修复合成后期处理模块中切换预设后命名内容发生联动的问题，使每个预设拥有独立的变量值、目录模板和文件名模板，同时兼容并迁移旧版数据。

## 数据模型

变量名称继续作为全局定义保存，避免每个预设重复维护同一批变量。变量值改为预设私有：

```ts
type CompositeV2Preset = {
  // existing fields
  subfolderTemplate: string
  filenameTemplate: string
  customVariableValues: Record<string, string>

  // legacy migration input only
  namingTemplate?: string
}
```

`CompositeV2State.customVariables` 保留变量的 `id`、`name` 和默认值。默认值仅用于新预设初始化和旧数据迁移，运行时解析优先使用当前预设的 `customVariableValues`。

## 编辑与切换行为

预设详情提供两个独立编辑项：

- 目录模板：决定输出根目录下的子目录结构。
- 文件名模板：决定最终文件名，不含扩展名。

编辑器显示原始变量标记，例如 `{project}`，并在独立的只读区域显示解析预览。切换预设时，所有输入直接绑定新预设的数据，不提交或复用前一个预设的草稿、选区或变量值。

添加全局变量定义时，为当前预设写入用户输入的值；其他预设不自动获得该值。删除变量定义时，从所有预设中移除对应值，避免无效残留。

## 导出行为

导出快照包含每个预设自己的：

- `subfolderTemplate`
- `filenameTemplate`
- `customVariableValues`

路径生成不再使用 `filenameTemplate || namingTemplate || subfolderTemplate` 这类隐式回退链。运行时只读取显式目录模板和文件名模板，因此不同来源、不同版本的预设具有一致行为。

## 旧数据迁移

持久化版本升级时执行一次迁移：

1. 目录模板依次取旧 `subfolderTemplate`、旧 `namingTemplate`、默认目录模板。
2. 文件名模板依次取旧 `filenameTemplate`、旧 `namingTemplate`、默认文件名模板。
3. 旧预设若包含自己的 `customVariables`，其值写入该预设。
4. 否则将旧全局变量值复制到该预设。
5. 同名变量在不同预设中的不同值必须保留，不再按名称合并后丢失。

迁移是幂等的：已经具有显式模板和预设变量值的数据不会被再次覆盖。

## 测试范围

- 两个预设使用同名变量但不同值，切换和导出结果互不影响。
- 修改一个预设的目录模板或文件名模板不改变另一个预设。
- 编辑器切换预设后显示对应的原始模板和解析预览。
- 旧 `namingTemplate` 正确迁移为两个显式模板。
- 旧版每预设变量值在迁移后仍保持差异。
- 导出路径严格使用当前预设的模板和值。

## 非目标

- 不改变水印图层、输出尺寸、渠道规则或分发规则。
- 不重新设计变量语法。
- 不修改旧版 `PostprocessV2Workspace` 的导出规则模型。
