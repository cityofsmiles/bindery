// Bindery service worker — caches the app shell so conversion works offline
// after the first visit. All conversion work happens on-device; this worker
// never sends any file content anywhere.

const CACHE_NAME = "bindery-v4";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-apple-touch.png",
  "./icons/favicon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            // Don't fail install if one CDN asset is briefly unreachable;
            // it will be cached opportunistically on first successful fetch.
            console.warn("Bindery SW: could not pre-cache", url, err);
          })
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Handles PDFs sent in via Android's share sheet, once installed.
// The share sheet POSTs the file here; we stash it in Cache Storage and
// redirect to a GET so the app can pick it up on load.
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf");
    if (file) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        "shared-pdf-file",
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/pdf",
            "X-Shared-Name": encodeURIComponent(file.name || "shared.pdf")
          }
        })
      );
    }
  } catch (err) {
    console.warn("Bindery SW: share handling failed", err);
  }
  return Response.redirect("./index.html?shared=1", 303);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method === "POST") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      // Cache-first for speed and offline use; refresh cache in the background.
      return cached || networkFetch;
    })
  );
});
