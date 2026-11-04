/* Service worker de Control de gastos: guarda la app para abrirla sin conexión. */
var VERSION = "gastos-v11";
var SHELL = ["./", "index.html", "manifest.webmanifest", "css/styles.css", "js/app.js", "js/logic.js", "js/store.js", "js/firebase-config.js",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
var EXTERNOS = "gastos-externos";

self.addEventListener("install", function (ev) {
  ev.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== EXTERNOS; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (ev) {
  var req = ev.request, url = new URL(req.url);
  if (req.method !== "GET") return;

  // Archivos propios: primero la red (para recibir cambios), si no hay conexión, la copia guardada.
  if (url.origin === self.location.origin) {
    ev.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined); });
    }));
    return;
  }

  // Tipografías de Google y librerías de Firebase: de la caché, y se refrescan en segundo plano.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com" || (url.hostname === "www.gstatic.com" && url.pathname.indexOf("/firebasejs/") === 0)) {
    ev.respondWith(caches.open(EXTERNOS).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
