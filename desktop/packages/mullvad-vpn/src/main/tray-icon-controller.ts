import { exec as execAsync } from 'child_process';
import { NativeImage, Tray } from 'electron';
import { promisify } from 'util';

import log from '../shared/logging';
import KeyframeAnimation from './keyframe-animation';
import { TrayIcon } from './tray-icon';

const exec = promisify(execAsync);

export type TrayIconType = 'unsecured' | 'securing' | 'secured';

type IconParameters = { monochromatic: boolean; notification: boolean };

export default class TrayIconController {
  private animation?: KeyframeAnimation;
  private iconSet: NativeImage[] = [];
  private iconParameters: IconParameters;

  private updateThrottlePromise?: Promise<void>;

  private previousNotificationIconReason?: string;

  private countryCode?: string;
  private flagImages = new Map<string, NativeImage | null>();

  constructor(
    private tray: Tray,
    private iconTypeValue: TrayIconType,
    monochromaticIcon: boolean,
    notificationIcon: boolean,
  ) {
    this.iconParameters = { monochromatic: monochromaticIcon, notification: notificationIcon };
    void this.updateTheme();
  }

  public dispose() {
    if (this.animation) {
      this.animation.stop();
      this.animation = undefined;
    }
  }

  get iconType(): TrayIconType {
    return this.iconTypeValue;
  }

  public updateTheme(): Promise<void> {
    // For some reason the icon doesn't update if the iconSet is changed to quickly. Adding a
    // throttle fixes this issue.
    this.updateThrottlePromise ??= new Promise((resolve) => {
      setTimeout(() => {
        this.updateThrottlePromise = undefined;
        void this.updateThemeImpl().then(resolve);
      }, 200);
    });

    return this.updateThrottlePromise;
  }

  public setMonochromaticIcon(monochromaticIcon: boolean) {
    void this.updateIconParameters({ monochromatic: monochromaticIcon });
  }

  public showNotificationIcon(notificationIcon: boolean, reason?: string) {
    if (reason !== this.previousNotificationIconReason) {
      this.previousNotificationIconReason = reason;
      if (notificationIcon) {
        log.info('Showing notification icon:', reason);
      } else {
        log.info('Hiding notification icon');
      }
    }

    void this.updateIconParameters({ notification: notificationIcon });
  }

  public animateToIcon(type: TrayIconType) {
    if (this.iconTypeValue === type || !this.animation) {
      return;
    }

    this.iconTypeValue = type;

    const animation = this.animation;
    const frame = this.targetFrame();

    animation.play({ end: frame });
  }

  /// Sets the country code of the exit relay. When set while connected, the flag of that country is
  /// shown in the tray instead of the lock icon.
  public setCountryCode(countryCode?: string) {
    const normalizedCountryCode = countryCode?.toLowerCase();
    if (normalizedCountryCode === this.countryCode) {
      return;
    }

    this.countryCode = normalizedCountryCode;

    // The flag is only rendered on the current frame, so make sure an idle tray icon is updated
    // right away instead of waiting for the next animation.
    if (this.animation && !this.animation.isRunning) {
      this.onFrame(this.animation.currentFrame);
    }
  }

  private async updateThemeImpl() {
    const systemUsesLightTheme = await this.getSystemUsesLightTheme();
    this.iconSet = this.loadImages(systemUsesLightTheme);

    if (this.animation === undefined) {
      this.initAnimation();
    } else if (!this.animation.isRunning) {
      this.animation.play({ end: this.targetFrame() });
    }
  }

  // This function uses a promise as a lock to prevent multiple simultaneous updates
  private updateIconParameters(parameters: Partial<IconParameters>) {
    if (
      (parameters.monochromatic !== undefined &&
        parameters.monochromatic !== this.iconParameters.monochromatic) ||
      (parameters.notification !== undefined &&
        parameters.notification !== this.iconParameters.notification)
    ) {
      this.iconParameters = { ...this.iconParameters, ...parameters };
      void this.updateTheme();
    }
  }

  private initAnimation() {
    const initialFrame = this.targetFrame();
    const animation = new KeyframeAnimation();
    animation.speed = 100;
    animation.onFrame = this.onFrame;
    animation.play({ start: initialFrame, end: initialFrame });

    this.animation = animation;
  }

  private onFrame = (frameNumber: number) => {
    const frame = this.flagImage() ?? this.iconSet[frameNumber];
    if (frame === undefined) {
      log.error('Failed to show tray icon due to the icon being undefined');
    } else {
      this.tray.setImage(frame);
    }
  };

  /// Returns the flag of the connected exit relay, if it should and can be shown.
  private flagImage(): NativeImage | undefined {
    if (process.platform !== 'win32' || this.countryCode === undefined) {
      return undefined;
    }
    if (this.iconTypeValue !== 'secured') {
      return undefined;
    }

    const cachedImage = this.flagImages.get(this.countryCode);
    if (cachedImage !== undefined) {
      return cachedImage ?? undefined;
    }

    const image = new TrayIcon(this.countryCode, 'flags', 'png').toNativeImage();
    if (image.isEmpty()) {
      // Cache missing flags so that the file system is not queried on every frame.
      this.flagImages.set(this.countryCode, null);
      return undefined;
    }

    this.flagImages.set(this.countryCode, image);
    return image;
  }

  private loadImages(systemUsesLightTheme?: boolean): NativeImage[] {
    const notificationIcon = this.iconParameters.notification ? '_notification' : '';
    if (this.iconParameters.monochromatic) {
      switch (process.platform) {
        case 'darwin':
          return this.loadImageSet(`${notificationIcon}Template`);
        case 'win32':
          return systemUsesLightTheme
            ? this.loadImageSet(`_black${notificationIcon}`)
            : this.loadImageSet(`_white${notificationIcon}`);
        case 'linux':
        default:
          return this.loadImageSet(`_white${notificationIcon}`);
      }
    } else {
      return this.loadImageSet(notificationIcon);
    }
  }

  private loadImageSet(suffix: string): NativeImage[] {
    const frames = Array.from({ length: 10 }, (_, i) => i + 1);
    return frames.map((frame) => this.getImage(frame, suffix));
  }

  private getImage(frame: number, suffix?: string) {
    const fileName = `lock-${frame}${suffix}`;

    return new TrayIcon(fileName).toNativeImage();
  }

  private async getSystemUsesLightTheme(): Promise<boolean | undefined> {
    if (process.platform !== 'win32') {
      return undefined;
    }

    try {
      // This registry entry contains information about the tray background color. This is
      // needed to decide between white and black icons.
      const { stdout, stderr } = await exec(
        'reg query HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\\ /v SystemUsesLightTheme',
      );

      if (!stderr && stdout) {
        // Split the output into rows
        const rows = stdout.split('\n');
        // Select the row that contains the registry entry result
        const resultRow = rows.find((row) => row.includes('SystemUsesLightTheme'))?.trim();
        // Split the row into words
        const resultRowWords = resultRow?.split(' ').filter((word) => word !== '');
        // Grab value which is last word on the result row
        const value = resultRowWords && resultRowWords[resultRowWords.length - 1];

        if (value) {
          const parsedValue = parseInt(value);
          return parsedValue === 1 ? true : false;
        }
      }

      return undefined;
    } catch (e) {
      const error = e as Error;
      log.error('Failed to read SystemUsesLightTheme,', error.message);
      return undefined;
    }
  }

  private targetFrame(): number {
    switch (this.iconTypeValue) {
      case 'unsecured':
        return 0;
      case 'securing':
        return 9;
      case 'secured':
        return 8;
    }
  }
}
