import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

/**
 * IPC 发送方校验：只接受主窗口主 frame（即我们自己的渲染进程）发来的调用。
 * 防止渲染进程被注入/导航到远程内容后，借仍挂载的 preload 滥用文件系统与网络能力。
 */
export function assertTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) {
    throw new Error('IPC 调用来源不受信任')
  }
  const frameUrl = frame.url
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  const allowedOrigin = devServerUrl ? frameUrl.startsWith(devServerUrl) : frameUrl.startsWith('file://')
  if (!allowedOrigin) {
    throw new Error('IPC 调用来源不受信任')
  }
}

export function handleChecked(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与 Electron ipcMain 自身签名一致，参数由各 handler 自行解构校验
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event)
    return listener(event, ...args)
  })
}

export function onChecked(
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 与 Electron ipcMain 自身签名一致
  listener: (event: IpcMainEvent, ...args: any[]) => void,
) {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedSender(event)
    listener(event, ...args)
  })
}
