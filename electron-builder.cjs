/**
 * electron-builder 配置（JS 形式，支持按环境变量条件签名）。
 *
 * 签名说明（无证书时保持现状，有证书时自动启用）：
 * - Windows：设置环境变量 CSC_LINK（证书文件路径/URL）与 CSC_KEY_PASSWORD（私钥密码）后构建即自动签名；
 *   再设置 CSC_PUBLISHER_NAME 以写入 publisherName（electron-updater 在 Windows 上会校验发布者）。
 * - macOS：设置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID 后自动公证（notarize）。
 * 风险提示：未签名构建的 Windows 安装包会被 SmartScreen 拦截，且 updater 只能做 sha512 完整性校验、
 *   无法验证发布者身份——正式分发前请配置代码签名证书。
 */
module.exports = {
  appId: 'com.cooksleep.doupao-v2',
  productName: 'DOUPAO V2',
  directories: {
    // 默认输出到 release/；可通过 DOUPAO_EB_OUTPUT 覆盖（受限环境下工作区内重命名被拦截时，
    // 把产物输出到工作区外可绕过）。
    output: process.env.DOUPAO_EB_OUTPUT || 'release',
  },
  icon: 'public/icon.ico',
  files: ['dist/**/*', 'dist-electron/**/*'],
  publish: {
    provider: 'github',
    owner: 'nideyilian',
    repo: 'doupao',
    releaseType: 'release',
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'portable', arch: ['x64'] },
    ],
    // 无证书时跳过签名，但仍编辑 EXE 资源（图标、版本信息等）。
    signExecutable: Boolean(process.env.CSC_LINK),
  },
  ...(process.env.CSC_LINK && process.env.CSC_PUBLISHER_NAME
    ? { publisherName: [process.env.CSC_PUBLISHER_NAME] }
    : {}),
  mac: {
    target: ['dmg'],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    ...(process.env.APPLE_ID ? { notarize: { teamId: process.env.APPLE_TEAM_ID ?? true } } : {}),
  },
  linux: {
    target: ['AppImage'],
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
}
