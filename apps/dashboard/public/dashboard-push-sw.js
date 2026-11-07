self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  let eventId;
  try {
    const data = event.data?.json();
    if (/^[0-9a-f-]{36}$/i.test(data?.eventId)) eventId = data.eventId;
  } catch {
    // A notification still has to be visible if the payload is unavailable.
  }
  event.waitUntil(
    self.registration.showNotification("Neue Bestellung", {
      body: "Öffne das PROVIDE Dashboard und prüfe den Bestelleingang.",
      icon: "/dashboard-icon-192.png",
      silent: false,
      ...(eventId ? { tag: eventId } : {}),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
      const dashboard = windows.find((window) => new URL(window.url).pathname === "/");
      if (dashboard) await dashboard.focus();
      else await clients.openWindow("/");
    })(),
  );
});
