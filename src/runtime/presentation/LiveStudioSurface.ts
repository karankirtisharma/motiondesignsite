import { createFrameReadiness } from './frameReadiness.ts';
import { createNativeScreenInput } from './nativeScreenInput.ts';
type Options = {
  canvas: HTMLCanvasElement;
  sampleSurface: (x: number, y: number) => {
    u: number;
    v: number;
  } | null;
  onExpand: () => void;
  onFocus: () => void;
  onAperture: (live: boolean) => void;
};
/** One visible browser document for the physical TV and the expanded Studio.
 * The transparent depth-writing LED aperture reveals this sibling underneath the
 * renderer. Both browser hit testing and the visual use the same plane matrix. */
export function createLiveStudioSurface(options: Options) {
  const doc = options.canvas.ownerDocument, win = doc.defaultView!;
  // Map the authored 1728 × 608 stage to the measured four corners of the TV.
  const width = 1728, height = 608;
  const host = doc.createElement('div');
  const backdrop = doc.createElement('div');
  backdrop.dataset.cabinetBackdrop = '';
  backdrop.setAttribute('aria-hidden', 'true');
  Object.assign(backdrop.style, { position: 'fixed', inset: '0', zIndex: '999', background: '#140f0d',
    visibility: 'hidden', opacity: '0', pointerEvents: 'none' });
  host.dataset.liveStudio = '';
  Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: width + 'px', height: height + 'px',
    transformOrigin: '0 0', overflow: 'hidden', background: '#241b13', zIndex: '0', visibility: 'hidden', pointerEvents: 'none' });
  const viewport = options.canvas.parentElement;
  const previousZ = viewport?.style.zIndex;
  if (viewport && viewport !== doc.body)
    viewport.style.zIndex = '1';
  const status = doc.createElement('div');
  status.setAttribute('role', 'status');
  Object.assign(status.style, { position: 'absolute', inset: '0', display: 'grid', placeContent: 'center', background: '#241b13', color: '#f6efdf', font: '20px sans-serif' });
  host.append(status);
  doc.body.append(backdrop, host);
  let frame: HTMLIFrameElement | undefined, matrix: number[] | undefined;
  let transform = '', clip = '', visible = false, ready = false, interactive = false, expanded = false, disposed = false;
  let engaged = false;
  let aperture = false, suspended: boolean | undefined, animation: Animation | undefined, generation = 0;

  const input = createNativeScreenInput({ canvas: options.canvas, frame: () => frame, hit: options.sampleSurface, onFocus: options.onFocus });
  const post = (type: string, detail = {}) => frame?.contentWindow?.postMessage({ type, ...detail }, win.location.origin);
  function sync() {
    const inRoom = engaged && !!matrix && visible && ready && !doc.hidden;
    const show = expanded || !!animation || inRoom;
    const live = inRoom && !expanded && !animation;
    if (live !== aperture) {
      aperture = live;
      options.onAperture(live);
    }
    const visibility = show ? 'visible' : 'hidden';
    if (host.style.visibility !== visibility) host.style.visibility = visibility;
    const inputEnabled = live && interactive;
    input.setEnabled(inputEnabled);
    const pointerEvents = expanded || inputEnabled ? 'auto' : 'none';
    if (host.style.pointerEvents !== pointerEvents) host.style.pointerEvents = pointerEvents;
    const tabIndex = expanded || inputEnabled ? 0 : -1;
    if (frame && frame.tabIndex !== tabIndex) frame.tabIndex = tabIndex;
    const pause = doc.hidden || !(expanded || animation || inRoom);
    if (ready && pause !== suspended) {
      suspended = pause;
      post(pause ? 'md-studio:suspend' : 'md-studio:resume');
    }
  }
  function worldLayout() {
    host.style.width = width + 'px';
    host.style.height = height + 'px';
    host.style.zIndex = '0';
    host.style.transform = transform || 'none';
    host.style.clipPath = clip || 'none';
  }
  function expandedTransform() {
    const scale = Math.min(win.innerWidth / width, win.innerHeight / height);
    const left = (win.innerWidth - width * scale) / 2;
    const top = (win.innerHeight - height * scale) / 2;
    return 'matrix3d(' + [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1, 0, left, top, 0, 1].join(',') + ')';
  }
  function resize() { if (expanded && !animation) host.style.transform = expandedTransform(); }
  const readiness = createFrameReadiness({
    // Keep the GPU poster visible through font loading and the first cabinet paint.
    loadedGraceMs: 8000,
    load: attempt => {
      if (!frame || disposed) return;
      ready = false;
      suspended = undefined;
      host.dataset.studioState = 'loading';
      host.dataset.studioAttempt = String(attempt);
      status.textContent = 'Opening the studio...';
      status.style.display = 'grid';
      frame.src = '/projection-cabinet/site/index.html' + (attempt > 1 ? '?attempt=' + attempt : '');
      sync();
    },
    exhausted: () => {
      host.dataset.studioState = 'failed';
      status.textContent = 'The Studio could not load. ';
      const retry = doc.createElement('button');
      retry.textContent = 'Retry';
      retry.onclick = () => readiness.retry();
      status.append(retry);
    },
  });
  function ensureFrame() {
    if (frame)
      return;
    frame = doc.createElement('iframe');
    frame.dataset.liveStudioFrame = '';
    frame.title = 'MotionDesign.ad Projection Cabinet';
    frame.allowFullscreen = true;
    Object.assign(frame.style, { width: '100%', height: '100%', display: 'block', border: '0', background: '#241b13' });
    frame.addEventListener('load', () => {
      readiness.loaded();
      input.refreshFrame();
      // Install the room lifecycle only in our embedded copy. Both standalone
      // editions keep their own document, script order and hash navigation.
      const cabinet = frame?.contentDocument;
      if (!cabinet?.querySelector('#app .stage .ui')) return;
      const bridge = cabinet.createElement('script');
      bridge.src = '/projection-cabinet/lounge-bridge.js';
      cabinet.head.append(bridge);
    });
    // Set src before insertion so about:blank cannot start a false boot deadline.
    readiness.start();
    host.prepend(frame);
  }
  function receive(event: MessageEvent) {
    if (event.origin !== win.location.origin || event.source !== frame?.contentWindow || !frame)
      return;
    if (event.data?.type === 'md-studio:ready') {
      // A retry keeps the same WindowProxy. A queued paint from the old
      // document must never reveal the replacement while it is still loading.
      if (event.data.attempt !== Number(host.dataset.studioAttempt)) return;
      readiness.ready();
      ready = true;
      suspended = undefined;
      host.dataset.studioState = 'live';
      status.style.display = 'none';
      input.refreshFrame();
      post('md-studio:display', { expanded });
      sync();
    }
    else if (event.data?.type === 'md-studio:expand' && !expanded && visible && interactive)
      options.onExpand();
    else if (event.data?.type === 'md-studio:exit' && !expanded)
      input.focusRoom();
  }
  function layout(event: Event) {
    const detail = (event as CustomEvent<{
      open: boolean;
      reducedMotion: boolean;
    }>).detail;
    if (!detail || disposed || expanded === detail.open)
      return;
    const version = ++generation;
    const full = expandedTransform();
    const start = animation ? win.getComputedStyle(host).transform : (expanded ? full : transform || full);
    animation?.cancel();
    expanded = detail.open;
    backdrop.style.transition = detail.reducedMotion ? 'none' : 'opacity 360ms ease-out';
    backdrop.style.visibility = 'visible';
    backdrop.style.opacity = expanded ? '1' : '0';
    backdrop.style.pointerEvents = expanded ? 'auto' : 'none';
    ensureFrame();
    options.onFocus();
    input.setEnabled(false);
    host.style.zIndex = '1000';
    host.style.width = width + 'px';
    host.style.height = height + 'px';
    host.style.clipPath = 'none';
    host.setAttribute('role', expanded ? 'dialog' : 'region');
    host.setAttribute('aria-label', expanded ? 'Motion Design Studio' : 'Interactive presentation screen');
    if (expanded)
      host.setAttribute('aria-modal', 'true');
    else
      host.removeAttribute('aria-modal');
    if (!expanded)
      post('md-studio:display', { expanded: false });
    const destination = expanded ? full : transform || full;
    host.style.transform = destination;
    animation = host.animate([{ transform: start }, { transform: destination }], { duration: detail.reducedMotion ? 0 : 560, easing: 'cubic-bezier(.22,.68,0,1)' });
    sync();
    animation.finished.then(() => {
      if (disposed || version !== generation)
        return;
      animation = undefined;
      if (expanded) {
        // Keep the TV document at its native resolution throughout expansion.
        // Reflowing or stretching it to the window also re-targets its glass.
        host.style.transform = expandedTransform();
        host.style.clipPath = 'none';
        post('md-studio:display', { expanded: true });
        frame?.focus({ preventScroll: true });
      }
      else {
        backdrop.style.visibility = 'hidden';
        worldLayout();
        input.focusRoom();
      }
      sync();
      win.dispatchEvent(new CustomEvent('md-studio:layout-complete', { detail: { open: expanded } }));
    }).catch(() => { });
  }
  function openOnLoadingClick(event: MouseEvent) {
    if (!expanded && interactive && visible && matrix && options.sampleSurface(event.clientX, event.clientY)) {
      event.preventDefault();
      options.onExpand();
    }
  }
  function visibility() { sync(); }
  options.canvas.addEventListener('click', openOnLoadingClick);
  win.addEventListener('message', receive);
  win.addEventListener('resize', resize);
  win.addEventListener('md-studio:layout', layout);
  doc.addEventListener('visibilitychange', visibility);
  // The GPU snapshot owns the idle display. Hydrate only on chair approach
  // or explicit screen use, outside the world's expensive Details phase.
  return {
    width, height,
    prepare() { ensureFrame(); },
    setEngaged(value: boolean) {
      if (engaged === value) return;
      engaged = value;
      if (value) ensureFrame();
      sync();
    },
    update(inView: boolean, next?: number[] | null, polygon?: string | null) {
      const wasVisible = visible;
      visible = inView;
      matrix = next ?? undefined;
      const css = matrix ? 'matrix3d(' + matrix.join(',') + ')' : '', newClip = polygon || 'none';
      if (css !== transform || newClip !== clip) {
        transform = css;
        clip = newClip;
        if (!expanded && !animation) {
          host.style.transform = transform || 'none';
          host.style.clipPath = clip;
        }
      }
      if (visible && matrix && engaged) ensureFrame();
      if (wasVisible && !visible && !expanded && doc.activeElement === frame)
        input.focusRoom();
      sync();
      input.updateCamera(matrix);
    },
    setInteractive(value: boolean) {
      if (interactive === value)
        return;
      interactive = value;
      if (!value && !expanded && doc.activeElement === frame)
        input.focusRoom();
      sync();
    },
    dispose() {
      if (disposed)
        return;
      disposed = true;
      generation++;
      animation?.cancel();
      readiness.dispose();
      input.dispose();
      if (aperture) {
        aperture = false;
        options.onAperture(false);
      }
      options.canvas.removeEventListener('click', openOnLoadingClick);
      win.removeEventListener('message', receive);
      win.removeEventListener('resize', resize);
      win.removeEventListener('md-studio:layout', layout);
      doc.removeEventListener('visibilitychange', visibility);
      host.remove();
      backdrop.remove();
      if (viewport && viewport !== doc.body && viewport.style.zIndex === '1')
        viewport.style.zIndex = previousZ ?? '';
    }
  };
}
