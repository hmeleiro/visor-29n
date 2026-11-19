import { EventEmitter } from "node:events";
import type { EnvioEvent } from "../shared/types.js";

export interface LatestStateReader {
  getLatestCompleteState(): Promise<{
    envio: number | null;
    timestamp: string | null;
    complete: boolean;
  }>;
}

export class EnvioPoller extends EventEmitter {
  private readonly reader: LatestStateReader;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private lastAnnounced: number | null = null;
  private polling = false;

  constructor(reader: LatestStateReader, intervalMs: number) {
    super();
    this.reader = reader;
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    await this.poll(true);
    this.timer = setInterval(() => void this.poll(false), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(initial: boolean): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const latest = await this.reader.getLatestCompleteState();
      if (!latest.complete || latest.envio === null) return;

      if (initial || this.lastAnnounced === null) {
        this.lastAnnounced = latest.envio;
        return;
      }

      if (latest.envio > this.lastAnnounced) {
        this.lastAnnounced = latest.envio;
        const event: EnvioEvent = {
          envio: latest.envio,
          timestamp: latest.timestamp ?? "",
        };
        this.emit("envio", event);
      }
    } catch (error) {
      this.emit("poll-error", error);
    } finally {
      this.polling = false;
    }
  }
}

