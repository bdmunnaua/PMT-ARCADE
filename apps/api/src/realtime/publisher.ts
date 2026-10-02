/**
 * Realtime fan-out. Writes are committed to D1 first; afterwards an event is pushed to the
 * RealtimeHub Durable Object for the channel, which forwards it to connected WebSockets.
 * Realtime delivery is best-effort: clients always re-fetch authoritative data from the API.
 *
 * Channels:
 *   user:<userId>              personal notifications, wallet changes
 *   finance:<BUY|SELL>:<id>    finance chat for one request
 *   match:<matchId>            lobby/match status updates
 */
export interface RealtimeEvent {
  type: string;
  data?: unknown;
}

export interface RealtimePublisher {
  publish(channel: string, event: RealtimeEvent): void;
}

export class NoopPublisher implements RealtimePublisher {
  readonly published: { channel: string; event: RealtimeEvent }[] = [];
  publish(channel: string, event: RealtimeEvent): void {
    this.published.push({ channel, event });
  }
}

export class DurableObjectPublisher implements RealtimePublisher {
  constructor(
    private readonly ns: DurableObjectNamespace,
    private readonly waitUntil: (p: Promise<unknown>) => void,
  ) {}

  publish(channel: string, event: RealtimeEvent): void {
    const stub = this.ns.get(this.ns.idFromName(channel));
    this.waitUntil(
      stub
        .fetch('https://realtime.internal/publish', { method: 'POST', body: JSON.stringify(event), headers: { 'content-type': 'application/json' } })
        .catch((e: unknown) => console.warn('realtime publish failed', channel, e instanceof Error ? e.message : e)),
    );
  }
}
