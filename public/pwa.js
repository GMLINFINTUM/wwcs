// WWCS PWA bootstrap — registers the service worker when supported.
(function () {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
      console.warn('WWCS: service worker registration failed:', err);
    });
  });
})();
