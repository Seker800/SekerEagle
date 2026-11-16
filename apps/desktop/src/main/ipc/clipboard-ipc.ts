import { clipboard, ipcMain, nativeImage } from 'electron';
import { parseClipboardImageInput } from '../clipboard-image';
import type { DesktopContext } from '../desktop-context';

export function registerClipboardIpc(ctx: DesktopContext): void {
  ipcMain.handle('desktop:write-clipboard-image', (event, input: unknown) => {
    ctx.assertTrustedIpcSender(event);
    const image = nativeImage.createFromBuffer(Buffer.from(parseClipboardImageInput(input)));
    if (image.isEmpty()) throw new Error('剪贴板图片无法解码。');
    clipboard.writeImage(image);
  });
}
