import { app } from "electron";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AppUpdateStatus } from "../types.js";
import {
  isNewerVersion,
  isTrustedUpdateUrl,
  updateAssetName,
} from "./updater-policy.js";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
const RELEASE_API =
  "https://api.github.com/repos/OmerDesignX/osCode-IDE/releases/latest";
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024;

type ReleaseAsset = {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  browser_download_url?: unknown;
};

export class AppUpdateService {
  private enabled = false;
  private checkInProgress = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private downloadedPackage = "";
  private status: AppUpdateStatus = {
    state: "disabled",
    message: "Automatic updates are off",
    currentVersion: app.getVersion(),
  };

  constructor(private readonly emit: (status: AppUpdateStatus) => void) {}

  initialize(enabled: boolean) {
    this.enabled = enabled;
    this.schedule();
    if (!enabled) {
      this.update({ state: "disabled", message: "Automatic updates are off" });
      return;
    }
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in Windows and macOS builds",
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
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in Windows and macOS builds",
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
    if (!this.supported()) {
      this.update({
        state: "unsupported",
        message: "Automatic updates run in Windows and macOS builds",
      });
      return this.getStatus();
    }
    if (this.checkInProgress) return this.getStatus();
    this.checkInProgress = true;
    this.update({ state: "checking", message: "Checking GitHub for updates" });
    try {
      const releaseResponse = await fetch(RELEASE_API, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "osCode-updater",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!releaseResponse.ok)
        throw new Error(`GitHub returned ${releaseResponse.status}`);
      const release = (await releaseResponse.json()) as {
        tag_name?: unknown;
        draft?: unknown;
        prerelease?: unknown;
        assets?: ReleaseAsset[];
      };
      if (release.draft || release.prerelease)
        throw new Error("The latest GitHub release is not public and stable");
      const version = String(release.tag_name || "").replace(/^v/i, "");
      if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version))
        throw new Error("GitHub returned an invalid release version");
      if (!isNewerVersion(version, app.getVersion())) {
        this.update({
          state: "current",
          message: "osCode is up to date",
          version: app.getVersion(),
        });
        return this.getStatus();
      }
      const wantedName = updateAssetName(version);
      const asset = release.assets?.find((item) => item.name === wantedName);
      if (!asset) throw new Error(`${wantedName} is missing from the release`);
      this.update({
        state: "available",
        message: `osCode ${version} is available`,
        version,
      });
      await this.download(version, wantedName, asset);
    } catch (error) {
      this.update({
        state: "error",
        message: `Update check failed: ${this.cleanError(error)}`,
      });
    } finally {
      this.checkInProgress = false;
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

  installReadyUpdate() {
    if (!this.enabled || this.status.state !== "ready") return false;
    const file = this.downloadedPackage;
    const expectedExtension = process.platform === "win32" ? ".exe" : ".dmg";
    if (!file || path.extname(file) !== expectedExtension) return false;
    const child =
      process.platform === "win32"
        ? spawn(file, ["/S"], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn("/usr/bin/open", [file], {
            detached: true,
            stdio: "ignore",
          });
    child.unref();
    this.downloadedPackage = "";
    return true;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private supported() {
    return app.isPackaged && ["win32", "darwin"].includes(process.platform);
  }

  private schedule() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled || !this.supported()) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private async download(version: string, name: string, asset: ReleaseAsset) {
    const url = String(asset.browser_download_url || "");
    const digest = String(asset.digest || "");
    const expectedBytes = Number(asset.size || 0);
    if (!this.allowsNetworkUrl(url))
      throw new Error("The update download address is not trusted");
    if (!/^sha256:[a-f0-9]{64}$/i.test(digest))
      throw new Error("The update has no trusted checksum");
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 10_000_000 ||
      expectedBytes > MAX_PACKAGE_BYTES
    )
      throw new Error("The update package size is invalid");
    const updatesRoot = path.join(app.getPath("userData"), "updates");
    const target = path.join(updatesRoot, name);
    const partial = `${target}.partial`;
    await fs.mkdir(updatesRoot, { recursive: true });
    await fs.rm(partial, { force: true });
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body || !this.allowsNetworkUrl(response.url))
      throw new Error(`Update download failed (${response.status})`);
    let received = 0;
    let lastPercent = -1;
    const hash = createHash("sha256");
    const body = Readable.fromWeb(response.body as never);
    body.on("data", (chunk: Buffer) => {
      received += chunk.length;
      hash.update(chunk);
      const percent = Math.min(
        99,
        Math.floor((received / expectedBytes) * 100),
      );
      if (percent === lastPercent) return;
      lastPercent = percent;
      this.update({
        state: "downloading",
        message: `Downloading osCode ${version}`,
        version,
        percent,
      });
    });
    try {
      await pipeline(body, createWriteStream(partial, { flags: "w" }));
      if (received !== expectedBytes)
        throw new Error("The update download is incomplete");
      if (`sha256:${hash.digest("hex")}`.toLowerCase() !== digest.toLowerCase())
        throw new Error("The update failed checksum verification");
      await fs.rm(target, { force: true });
      await fs.rename(partial, target);
      this.downloadedPackage = target;
      this.update({
        state: "ready",
        message:
          process.platform === "win32"
            ? `osCode ${version} will install when you close osCode`
            : `osCode ${version} will open when you close osCode`,
        version,
        percent: 100,
      });
    } catch (error) {
      await fs.rm(partial, { force: true }).catch(() => {});
      throw error;
    }
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
