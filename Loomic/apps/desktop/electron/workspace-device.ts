import { realpath, stat } from "node:fs/promises";

export class WorkspaceDisconnected extends Error {
  constructor(cause?: unknown) { super("工作区磁盘已断开、位置改变或无法写入；进度保留在本机，重新连接原磁盘后可继续。", { cause }); }
}
export class WorkspaceDevice {
  private constructor(private readonly root: string, private readonly dev: string, private readonly ino: string) {}
  get identity() { return { dev: this.dev, ino: this.ino }; }
  static async capture(root: string) {
    if (await realpath(root) !== root) throw new WorkspaceDisconnected();
    const info = await stat(root, { bigint: true });
    return new WorkspaceDevice(root, String(info.dev), String(info.ino));
  }
  async check() {
    try {
      const info = await stat(this.root, { bigint: true });
      if (!info.isDirectory() || String(info.dev) !== this.dev || String(info.ino) !== this.ino || await realpath(this.root) !== this.root) throw new WorkspaceDisconnected();
    } catch (error) { throw new WorkspaceDisconnected(error); }
  }
}
