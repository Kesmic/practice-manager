/**
 * Turning push notifications on and off for this device.
 *
 * The browser owns the subscription; the portal only records it. So turning it on is
 * three steps the browser insists on - permission, a service worker, a subscription -
 * and the portal is told at the end. Turning it off is the reverse. Everything here
 * is per device: a phone and a laptop are enrolled separately, and either can be
 * turned off without the other noticing.
 */

import { api } from "./api";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The browser's current answer: enrolled here, or not. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

function applicationServerKey(publicKey: string): ArrayBuffer {
  const normal = publicKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normal + "=".repeat((4 - (normal.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(0, bytes.byteLength) as ArrayBuffer;
}

/** Asks the person, enrols the device, and tells the portal. */
export async function enablePush(): Promise<void> {
  const { configured, public_key } = await api.pushKey();
  if (!configured || !public_key) {
    throw new Error("Push notifications are not set up on this portal yet.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      "Notifications are blocked for the portal in this browser. Allow them in the browser's site settings, then try again.",
    );
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(public_key),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("The browser did not hand over a usable subscription.");
  }
  await api.savePushSubscription({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  });
}

/** Un-enrols this device, on both sides. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.removePushSubscription(endpoint);
}
