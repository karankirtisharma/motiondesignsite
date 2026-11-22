// Only the presentation-room host loads this script. Standalone editions keep
// their original behavior and their identical shared scripts.
(() => {
  'use strict';
  if (parent === window) return;
  const attempt = Number(new URLSearchParams(location.search).get('attempt') || 1);
  const post = type => parent.postMessage({ type, attempt }, location.origin);
  let paused;
  addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== parent) return;
    const type = event.data?.type;
    if (type !== 'md-studio:suspend' && type !== 'md-studio:resume') return;
    const next = type === 'md-studio:suspend';
    if (next === paused) return;
    paused = next;
    const stage = window.FX?.stage;
    if (paused) {
      // A hidden iframe still has a frame clock. Stop its dust compositor and
      // film preview while the lounge is spending the GPU budget on the world.
      if (stage) window.gsap.ticker.remove(stage.tick);
      document.querySelectorAll('audio,video').forEach(media => media.pause());
      if (document.querySelector('[data-cmd="play"][aria-label="Pause preview"]')) {
        window.stopClock();
        window.drawPlayer();
      }
      window.gsap?.ticker.sleep();
    } else {
      if (stage) {
        window.gsap.ticker.add(stage.tick);
        stage.wake(300);
      }
      window.gsap?.ticker.wake();
    }
  });
  addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]') &&
        (!location.hash || location.hash === '#ui/home')) post('md-studio:exit');
  }, true);
  // The iframe load event precedes the asynchronous font/FX boot. Wait for
  // that boot and the visible hero before uncovering the world-space poster.
  const root = document.documentElement;
  const reveal = async () => {
    if (root.classList.contains('fx-boot')) return;
    observer.disconnect();
    const hero = document.querySelector('.launchimage img');
    if (hero) await hero.decode().catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => post('md-studio:ready')));
  };
  const observer = new MutationObserver(reveal);
  observer.observe(root, { attributes: true, attributeFilter: ['class'] });
  reveal();
})();
