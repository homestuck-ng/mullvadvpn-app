import { nativeImage } from 'electron';
import path from 'path';

export class TrayIcon {
  constructor(
    public fileName?: string,
    private subdirectory?: string,
    private extensionOverride?: string,
  ) {}

  public get basePath() {
    const basePath = path.resolve(import.meta.dirname, 'assets/images/menubar-icons');

    return basePath;
  }

  public get extension() {
    const extension = this.extensionOverride ?? (process.platform === 'win32' ? 'ico' : 'png');

    return extension;
  }

  public get filePath() {
    if (this.fileName) {
      const directory = this.subdirectory
        ? path.join(this.basePath, process.platform, this.subdirectory)
        : path.join(this.basePath, process.platform);

      return path.join(directory, `${this.fileName}.${this.extension}`);
    }

    return null;
  }

  public toNativeImage() {
    if (this.filePath) {
      return nativeImage.createFromPath(this.filePath);
    }

    return nativeImage.createEmpty();
  }
}
