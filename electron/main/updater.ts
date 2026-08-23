import { app } from "electron";
import { createRequire } from "node:module";
import type { AppUpdateStatus } from "../types.js";
import { isTrustedUpdateUrl } from "./updater-policy.js";

const { autoUpdater } = createRequire(import.meta.url)(
  "electron-updater",
) as typeof import("electron-updater");

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;

export class AppUpdateService {
  private enabled = false;
  private checkInProgress = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private status: AppUpdateStatus = {
    state: "disabled",
    message: "Automatic updates are off",
    currentVersion: app.getVersion(),
  };

  constructor(private readonly emit: (status: AppUpdateStatus) => void) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.logger = null;
    autoUpdater.netSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*"] },
      (details, callback) =>
        callback({ cancel: !this.allowsNetworkUrl(details.url) }),
    );

    autoUpdater.on("checking-for-update", () =>
      this.update({
        state: "checking",
        message: "Checking GitHub for updates",
      }),
    );
    autoUpdater.on("update-available", (info) =>
      this.update({
        state: "available",
        message: `osCode ${info.version} is available`,
        version: info.version,
      }),
    );
    autoUpdater.on("download-progress", (progress) =>
      this.update({
        state: "downloading",
        message: `Downloading osCode ${this.status.version || "update"}`,
        version: this.status.version,
        percent: Math.max(0, Math.min(100, progress.percent)),
      }),
    );
    autoUpdater.on("update-not-available", (info) => {
      this.checkInProgress = false;
      this.update({
        state: "current",
        message: "osCode is up to date",
        version: info.version,
      });
    });
    autoUpdater.on("update-downloaded", (info) => {
      this.checkInProgress = false;
      this.update({
        state: "ready",
        message: `osCode ${info.version} is ready and will install when you close osCode`,
        version: info.version,
        percent: 100,
      });
    });
    autoUpdater.on("error", (error) => {
      this.checkInProgress = false;
      this.update({
        state: "error",
        message: `Update check failed: ${this.cleanError(error)}`,
      });
    });
  }

  initialize(enabled: boolean) {
    this.enabled = enabled;
    this.schedule();
    if (!enabled) {
      this.update({ state: "disabled", message: "Automatic updates are off" });
      return;
    }
    if (!app.isPackaged) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in installed builds",
      });
      return;
    }
    const timeout = setTimeout(() => void this.check(), 2_500);
    timeout.unref();
  }

  async setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      if (enabled && this.status.state === "disabled") await this.check();
      return this.getStatus();
    }
    this.enabled = enabled;
    this.schedule();
    if (!enabled) {
      this.update({ state: "disabled", message: "Automatic updates are off" });
      return this.getStatus();
    }
    if (!app.isPackaged) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in installed builds",
      });
      return this.getStatus();
    }
    await this.check();
    return this.getStatus();
  }

  async check() {
    if (!this.enabled) {
      this.update({ state: "disabled", message: "Automatic updates are off" });
      return this.getStatus();
    }
    if (!app.isPackaged) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in installed builds",
      });
      return this.getStatus();
    }
    if (this.checkInProgress) return this.getStatus();
    this.checkInProgress = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.checkInProgress = false;
      if (this.status.state !== "error")
        this.update({
          state: "error",
          message: `Update check failed: ${this.cleanError(error)}`,
        });
    }
    return this.getStatus();
  }

  getStatus() {
    return { ...this.status };
  }

  isEnabled() {
    return this.enabled;
  }

  allowsNetworkUrl(rawUrl: string) {
    return isTrustedUpdateUrl(this.enabled, rawUrl);
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled || !app.isPackaged) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private update(next: Omit<AppUpdateStatus, "currentVersion">) {
    this.status = { ...next, currentVersion: app.getVersion() };
    this.emit(this.getStatus());
  }

  private cleanError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, "GitHub Releases").slice(0, 220);
  }
}
