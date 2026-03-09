/**
 * BroadcastChannel-based internal event bus for ride notifications.
 * Ensures that if ANY part of the app (OneSignal listener, service worker,
 * GlobalRideOfferGuard) hears a new ride, the WHOLE app reacts instantly.
 */

const CHANNEL_NAME = 'drivveme_ride_updates';

type RideMessage = { type: 'NEW_RIDE'; rideId: string };

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) {
    try {
      _channel = new BroadcastChannel(CHANNEL_NAME);
    } catch { return null; }
  }
  return _channel;
}

/** Broadcast a new ride to all open tabs / components */
export function broadcastNewRide(rideId: string) {
  const ch = getChannel();
  if (ch) {
    try { ch.postMessage({ type: 'NEW_RIDE', rideId } satisfies RideMessage); } catch {}
  }
}

/** Listen for new ride broadcasts. Returns cleanup function. */
export function onRideBroadcast(handler: (rideId: string) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};

  const listener = (event: MessageEvent<RideMessage>) => {
    if (event.data?.type === 'NEW_RIDE' && event.data.rideId) {
      handler(event.data.rideId);
    }
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}
