/** 只处理用户主动粘贴的图片；普通文本粘贴保持浏览器默认行为。 */
export function pastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
