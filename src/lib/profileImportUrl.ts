const API_KEY_IMPORT_URL_WARNING = [
  '导入 URL 会包含当前 API Key。',
  '任何拿到这个链接的人都可以看到并使用这个 Key。',
  '确定要继续复制吗？',
].join('\n')

export function shouldCopyProfileImportUrl(includeApiKey: boolean, confirmCopy: (message: string) => boolean): boolean {
  if (!includeApiKey) return true
  return confirmCopy(API_KEY_IMPORT_URL_WARNING)
}
