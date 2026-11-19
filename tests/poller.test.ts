import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvioPoller, type LatestStateReader } from "../server/poller.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("EnvioPoller", () => {
  it("no emite el envío inicial y avisa una vez cuando aparece otro", async () => {
    vi.useFakeTimers();
    let envio = 96;
    const reader: LatestStateReader = {
      getLatestCompleteState: vi.fn(async () => ({
        envio,
        timestamp: envio === 96 ? "2611181950" : "2611181953",
        complete: true,
      })),
    };
    const poller = new EnvioPoller(reader, 2_000);
    const listener = vi.fn();
    poller.on("envio", listener);

    await poller.start();
    expect(listener).not.toHaveBeenCalled();

    envio = 100;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      envio: 100,
      timestamp: "2611181953",
    });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(listener).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});

