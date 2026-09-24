/*
 * The portal's service worker.
 *
 * It does two things and deliberately no more. It lets the portal be installed as an
 * app - a phone's home screen, a laptop's dock - and it receives push notifications
 * and shows them. It does not cache the app: a portal whose pages depend on who is
 * signed in, and which is rebuilt every time something ships, is a portal that must
 * always come from the network. The one offline touch is a plain sentence when a page
 * cannot be fetched at all, instead of the browser's own error.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Offline</title><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head>" +
            "<body style=\"margin:0;font-family:system-ui,sans-serif;background:#0F2440;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:2rem\">" +
            "<div><p style=\"font-size:1.25rem;font-weight:600;margin:0 0 .5rem\">You are offline.</p><p style=\"margin:0;opacity:.7\">The portal needs a connection. Try again when you are back on one.</p></div></body></html>",
          { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
        ),
    ),
  );
});

/*
 * A push message is a small JSON object from the Worker: title, body, and where to go
 * when it is tapped. Anything the Worker did not send is shown as a plain notice, so a
 * message that cannot be parsed is still a message.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Kesmic Practice Manager";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined,
      data: { url: data.url || "/notifications" },
    }),
  );
});

/* Tapping a notification opens what it is about, in a window that is already open if there is one. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
