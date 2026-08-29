# DOUPAO v0.8.7 发布脚本（推送到 GitHub Releases）
# 前置：GitHub CLI 已登录（gh auth login），或设置 GH_TOKEN 环境变量。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/publish-v0.8.7.ps1

$ErrorActionPreference = 'Stop'

if (-not $env:GH_TOKEN) {
  $ghToken = ''
  try {
    $ghToken = (gh auth token 2>$null | Out-String).Trim()
  } catch {
    $ghToken = ''
  }
  if (-not $ghToken) {
    # 回退：从 Windows 凭据管理器读取 Git Credential Manager 保存的 github.com 凭据
    try {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PublishWinCred {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, int type, int reserved, out IntPtr credential);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
  [StructLayout(LayoutKind.Sequential)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public IntPtr TargetName;
    public IntPtr Comment; public long LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public IntPtr TargetAlias; public IntPtr UserName;
  }
}
'@ -ErrorAction Stop
      $ptr = [IntPtr]::Zero
      if ([PublishWinCred]::CredRead('git:https://github.com', 1, 0, [ref]$ptr)) {
        $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][PublishWinCred+CREDENTIAL])
        $blob = New-Object byte[] $c.CredentialBlobSize
        [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $blob, 0, $c.CredentialBlobSize)
        $ghToken = [System.Text.Encoding]::Unicode.GetString($blob)
        [PublishWinCred]::CredFree($ptr) | Out-Null
      }
    } catch {
      $ghToken = ''
    }
  }
  if (-not $ghToken) {
    Write-Host '未找到 GitHub 凭据。请先执行 gh auth login 完成浏览器登录，或配置 GH_TOKEN 环境变量，再运行本脚本。' -ForegroundColor Red
    exit 1
  }
  $env:GH_TOKEN = $ghToken
}

$repo = 'nideyilian/doupao'
$tag = 'v0.8.7'
$assets = @(
  'release/DOUPAO V2 Setup 0.8.7.exe',
  'release/DOUPAO V2 Setup 0.8.7.exe.blockmap',
  'release/DOUPAO V2 0.8.7.exe',
  'release/latest.yml'
)

$notes = @'
## v0.8.7（2026-08-27）

### 🎨 优化
- SOP 正文编辑器新增「AI 指令」工具栏（将具体词泛化 / 精简压缩 / 拆分步骤 / 补全缺失 / 统一术语）：点击后就地生成修订预览（变更摘要 + 全文对比），可先测试生图再确认替换，支持撤销，全程无需离开正文。
- AI 对话面板默认常驻 SOP 库「参数与正文」模块右侧，打开 SOP 即可使用，无需再点按钮弹出；「AI 对话」按钮只负责开关，全屏编辑与对话相互独立（Escape 仅退出全屏）。
- 移除与 AI 对话重复的「AI 结构化 / AI 精简」入口及预览条替换逻辑，保留「AI 检查」（只出审查报告、不改写正文）；对话面板移除常用指令 chips，由正文工具栏统一承接。

### 🔧 修复与内部
- 修复 SOP 库分组侧栏被隐藏、SOP 列表被压缩的问题：过时的 :has(.sop-ai-chat) 布局规则在 AI 对话常驻后误触发，现已移除，SOP 库恢复完整三栏（分组侧栏 / SOP 列表 / 编辑面板），并适度收窄常驻对话列宽。
- SOP 批量生图的运行状态按「工作区标签页 + 素材库文件夹」双重隔离：同一标签页内在不同文件夹选择 SOP 生成，各自持有独立的草稿与运行状态，互不打断（已提交的生图任务仍全局后台执行，不受影响）；非文件夹视图退化为按标签页隔离，旧数据兼容。
'@

Write-Host "检查 tag $tag 是否已存在..."
$exists = gh release view $tag --repo $repo 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "Release $tag 已存在，改用编辑模式更新资产..."
  gh release upload $tag --repo $repo --clobber @($assets | Where-Object { Test-Path $_ })
  gh release edit $tag --repo $repo --title $tag --notes $notes
} else {
  Write-Host "创建 Release $tag 并上传资产..."
  gh release create $tag --repo $repo --title $tag --notes $notes @($assets | Where-Object { Test-Path $_ })
}

Write-Host '发布完成。验证：https://github.com/nideyilian/doupao/releases' -ForegroundColor Green
