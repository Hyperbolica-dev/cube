import { IDS, COLORS, CUBIE_COLORS, TABLES, applyMove, solvedState, isSolved, assertLegal, notation, type CubeState, type Face, type Move } from './cube.ts';
import { RINGS, SLOTS, BASE_ANGLES, directedArc } from './layout.ts';
import { cubeMarkup, cubeText } from './ui.ts';
import type { CubeLanguage } from './module.ts';

const instances = new WeakMap<HTMLElement, () => void>();

/** Mount once per root. Call destroy before remounting with a different language. */
export function mountCube(root: HTMLElement, { language }: { language: CubeLanguage }): () => void {
  const existing = instances.get(root);
  if (existing) return existing;
  const t = cubeText[language];
  const document = root.ownerDocument;
  const ownerWindow = document.defaultView;
  if (!ownerWindow) throw new Error('Cube requires a browser document');
  const view = ownerWindow;
  const events = new AbortController();
  const signal = events.signal;
  let destroyed = false;
  let animationFrame: number | undefined;
  let finishAnimation: ((completed: boolean) => void) | undefined;
  root.classList.add('cube-app');
  root.dataset.cubeApp = '';
  root.lang = language;
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', t.region);
  root.innerHTML = cubeMarkup(language);

  const NS = 'http://www.w3.org/2000/svg';
  function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
    const element = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    return element;
  }
  function element<T extends Element = HTMLElement>(name: string): T {
    const found = root.querySelector<T>(`[data-cube="${name}"]`);
    if (!found) throw new Error(`Missing cube element: ${name}`);
    return found;
  }
  const stage = element<SVGSVGElement>('diagram');
  const animation = element<HTMLInputElement>('animation');
  const reducedMotion = view.matchMedia('(prefers-reduced-motion: reduce)');
  animation.checked = !reducedMotion.matches;
  let state = solvedState();
  let history: Move[] = [];
  let busy = false;
  const status = () => isSolved(state) ? t.solved : t.unsolved;
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const undo = element<HTMLButtonElement>('undo');

  const labelPositions = { F: [194, 66], U: [410, 66], R: [300, 488] };
  const ringLabels: SVGTextElement[] = [];
  for (const face of ['F', 'U', 'R'] as const) {
    const ring = RINGS[face];
    stage.append(svg('circle', { cx: ring.center.x, cy: ring.center.y, r: ring.radius, stroke: ring.color, class: 'ring', 'data-ring': face }));
    const [x, y] = labelPositions[face];
    const label = svg('text', { x, y, fill: ring.color, class: 'ring-label', tabindex: 0, role: 'button', 'aria-label': t.moveLabel(face, false), 'data-ring': face });
    label.textContent = ring.label;
    label.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (!event.repeat) void command({ face, inverse: event.shiftKey });
      }
    }, { signal });
    stage.append(label);
    ringLabels.push(label);
  }
  for (const button of buttons) {
    if (!button.dataset.move) continue;
    const face = button.dataset.move[0] as Face;
    const inverse = button.dataset.move.endsWith("'");
    button.addEventListener('click', () => void command({ face, inverse }), { signal });
  }
  SLOTS.slice(0, 7).forEach(p => stage.append(svg('circle', { cx: p.x, cy: p.y, r: 26, class: 'slot-marker' })));
  const note = svg('text', { x: SLOTS[7].x, y: SLOTS[7].y + 43, class: 'reference-note' });
  note.textContent = t.fixed;
  stage.append(note);
  const nodes = IDS.map((id, cubie) => {
    const group = svg('g', { 'data-cubie': id });
    const title = svg('title');
    group.append(title);
    const pattern = svg('g', { class: 'pattern' });
    CUBIE_COLORS[cubie].forEach((color, k) => {
      const a = (k * 120 - 60) * Math.PI / 180;
      const b = (k * 120 + 60) * Math.PI / 180;
      const radius = 25;
      const path = `M 0 0 L ${radius * Math.cos(a)} ${radius * Math.sin(a)} A ${radius} ${radius} 0 0 1 ${radius * Math.cos(b)} ${radius * Math.sin(b)} Z`;
      pattern.append(svg('path', { d: path, fill: COLORS[color], class: 'petal' }));
    });
    group.append(pattern, svg('circle', { r: 25, class: 'cubie-outline' }));
    const identity = svg('g', { class: 'identity' });
    identity.append(svg('circle', { r: 9, class: 'id-background' }));
    const text = svg('text', { class: 'cubie-id' });
    text.textContent = id;
    identity.append(text);
    group.append(identity);
    stage.append(group);
    return { group, pattern, title };
  });

  function render(s: CubeState): void {
    s.cubieAt.forEach((cubie, slot) => {
      const node = nodes[cubie], p = SLOTS[slot];
      node.group.setAttribute('transform', `translate(${p.x} ${p.y})`);
      node.group.dataset.slot = IDS[slot];
      node.group.dataset.orientation = String(s.orientationAt[slot]);
      node.pattern.setAttribute('transform', `rotate(${BASE_ANGLES[slot] + 120 * s.orientationAt[slot]})`);
      node.title.textContent = t.cubie(IDS[cubie], CUBIE_COLORS[cubie].map(c => t.colors[c]), IDS[slot], s.orientationAt[slot]);
    });
    stage.dataset.cubies = s.cubieAt.map(i => IDS[i]).join('');
    stage.dataset.orientations = s.orientationAt.join('');
    const badge = element('badge');
    badge.textContent = status();
    badge.dataset.solved = String(isSolved(s));
    element('count').textContent = String(history.length);
    element('history').textContent = history.length ? history.map(notation).join(' ') : '—';
    refreshControls();
  }
  function refreshControls(): void {
    buttons.forEach(button => { button.disabled = busy || (button === undo && history.length === 0); });
    ringLabels.forEach(label => label.setAttribute('aria-disabled', String(busy)));
  }

  function movePainter(before: CubeState, after: CubeState, move: Move): (progress: number) => void {
    const ring = RINGS[move.face];
    const transitions = before.cubieAt.flatMap((cubie, source) => {
      if (TABLES[move.face].destination[source] === source) return [];
      const target = after.cubieAt.indexOf(cubie);
      const arc = directedArc(SLOTS[source], SLOTS[target], ring, move.inverse);
      const startAngle = BASE_ANGLES[source] + before.orientationAt[source] * 120;
      const endAngle = BASE_ANGLES[target] + after.orientationAt[target] * 120;
      const spin = ((endAngle - startAngle + 180) % 360 + 360) % 360 - 180;
      // Paint moving cubies last when passing a stationary intersection.
      stage.append(nodes[cubie].group);
      return [{ cubie, arc, startAngle, spin }];
    });
    return progress => {
      for (const { cubie, arc, startAngle, spin } of transitions) {
        const angle = arc.start + arc.sweep * progress;
        const x = ring.center.x + ring.radius * Math.cos(angle);
        const y = ring.center.y + ring.radius * Math.sin(angle);
        nodes[cubie].group.setAttribute('transform', `translate(${x} ${y})`);
        nodes[cubie].pattern.setAttribute('transform', `rotate(${startAngle + spin * progress})`);
      }
    };
  }
  async function animateMove(paint: (progress: number) => void, duration: number): Promise<boolean> {
    if (destroyed) return false;
    if (!animation.checked || reducedMotion.matches) return true;
    const { promise, resolve } = Promise.withResolvers<boolean>();
    finishAnimation = resolve;
    const start = performance.now();
    function frame(now: number): void {
      const progress = Math.min(1, (now - start) / duration);
      paint(progress * progress * (3 - 2 * progress));
      if (progress < 1) animationFrame = view!.requestAnimationFrame(frame);
      else {
        animationFrame = undefined;
        finishAnimation = undefined;
        resolve(true);
      }
    }
    animationFrame = view.requestAnimationFrame(frame);
    return promise;
  }
  async function perform(move: Move, record: boolean, duration = 520): Promise<void> {
    if (destroyed) return;
    const next = applyMove(state, move);
    assertLegal(next);
    if (!await animateMove(movePainter(state, next, move), duration) || destroyed) return;
    state = next;
    if (record) history.push(move);
    render(state);
    element('status').textContent = t.performed(notation(move), status());
  }
  async function exclusive(action: () => Promise<void>): Promise<void> {
    if (busy || destroyed) return;
    busy = true;
    stage.setAttribute('aria-busy', 'true');
    refreshControls();
    try { await action(); }
    catch (error) {
      if (!destroyed) {
        render(state);
        element('status').textContent = t.failed;
        console.error(error);
      }
    } finally {
      if (!destroyed) {
        busy = false;
        stage.setAttribute('aria-busy', 'false');
        refreshControls();
      }
    }
  }
  async function command(move: Move): Promise<void> {
    await exclusive(() => perform(move, true));
  }

  interface RingGesture {
    pointerId: number;
    face: Face;
    clickInverse: boolean;
    startX: number;
    startY: number;
    lastAngle: number;
    angle: number;
    boundaries: number[];
    dragged: boolean;
    steps: number;
    wholeSteps: number;
    preview: CubeState;
    segment: string;
    paint?: (progress: number) => void;
    release: (complete: boolean) => void;
  }
  let gesture: RingGesture | undefined;
  function pointerPoint(event: MouseEvent): DOMPoint | undefined {
    const matrix = stage.getScreenCTM();
    return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : undefined;
  }
  function ringAt(event: MouseEvent): Face | undefined {
    if (event.target instanceof Element) {
      const label = event.target.closest('.ring-label');
      if (label) return label.getAttribute('data-ring') as Face;
    }
    const point = pointerPoint(event);
    if (!point) return;
    let nearest: Face | undefined;
    let distance = 16;
    for (const face of ['F', 'U', 'R'] as const) {
      const ring = RINGS[face];
      const error = Math.abs(Math.hypot(point.x - ring.center.x, point.y - ring.center.y) - ring.radius);
      if (error < distance) { distance = error; nearest = face; }
    }
    return nearest;
  }
  stage.addEventListener('pointerdown', event => {
    if (busy || !event.isPrimary || (event.button !== 0 && event.button !== 2)) return;
    const face = ringAt(event), point = pointerPoint(event);
    if (!face || !point) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    void exclusive(async () => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const center = RINGS[face].center;
      const startAngle = Math.atan2(point.y - center.y, point.x - center.x);
      const tau = 2 * Math.PI;
      const slotAngles = TABLES[face].destination.flatMap((target, source) =>
        target === source ? [] : [Math.atan2(SLOTS[source].y - center.y, SLOTS[source].x - center.x)]);
      const anchor = slotAngles.reduce((nearest, angle) =>
        Math.abs(Math.atan2(Math.sin(angle - startAngle), Math.cos(angle - startAngle))) <
        Math.abs(Math.atan2(Math.sin(nearest - startAngle), Math.cos(nearest - startAngle))) ? angle : nearest);
      const boundaries = slotAngles.map(angle => ((angle - anchor) % tau + tau) % tau).sort((a, b) => a - b);
      boundaries.push(tau);
      const active: RingGesture = {
        pointerId: event.pointerId, face, clickInverse: event.button === 2,
        startX: event.clientX, startY: event.clientY, lastAngle: startAngle,
        angle: 0, boundaries, dragged: false, steps: 0, wholeSteps: 0,
        preview: state, segment: '', release: resolve,
      };
      gesture = active;
      try {
        stage.setPointerCapture(event.pointerId);
        stage.dataset.activeRing = face;
        element('status').textContent = t.dragging(RINGS[face].label);
        const complete = await promise;
        if (destroyed) return;
        if (complete) {
          const steps = active.dragged
            ? Math.sign(active.steps) * Math.floor(Math.abs(active.steps) + .5)
            : active.clickInverse ? -1 : 1;
          advancePreview(active, steps);
          state = active.preview;
          assertLegal(state);
          const move: Move = { face, inverse: steps < 0 };
          for (let i = 0; i < Math.abs(steps); i++) history.push(move);
          element('status').textContent = steps === 0 ? t.snappedBack : t.snapped(notation(move), Math.abs(steps), status());
        } else {
          element('status').textContent = t.cancelled;
        }
        render(state);
      } finally {
        if (gesture === active) gesture = undefined;
        if (!destroyed) {
          delete stage.dataset.activeRing;
          if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
        }
      }
    });
  }, { signal });
  function advancePreview(active: RingGesture, target: number): void {
    while (active.wholeSteps !== target) {
      const direction = target > active.wholeSteps ? 1 : -1;
      active.preview = applyMove(active.preview, { face: active.face, inverse: direction < 0 });
      active.wholeSteps += direction;
    }
  }
  function updateGesture(event: PointerEvent): void {
    const active = gesture;
    if (!active || event.pointerId !== active.pointerId) return;
    const point = pointerPoint(event);
    if (!point) return;
    const center = RINGS[active.face].center;
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    active.angle += Math.atan2(Math.sin(angle - active.lastAngle), Math.cos(angle - active.lastAngle));
    active.lastAngle = angle;
    active.dragged ||= Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 4;
    if (!active.dragged) return;
    const tau = 2 * Math.PI;
    const turns = Math.floor(active.angle / tau);
    const remainder = active.angle - turns * tau;
    let interval = 0;
    while (interval < 3 && remainder >= active.boundaries[interval + 1]) interval++;
    active.steps = turns * 4 + interval +
      (remainder - active.boundaries[interval]) / (active.boundaries[interval + 1] - active.boundaries[interval]);
    const whole = Math.trunc(active.steps);
    const fraction = active.steps - whole;
    advancePreview(active, whole);
    const inverse = fraction < 0;
    const segment = `${whole}:${inverse}`;
    if (active.segment !== segment || !active.paint) {
      const move: Move = { face: active.face, inverse };
      active.paint = movePainter(active.preview, applyMove(active.preview, move), move);
      active.segment = segment;
    }
    active.paint(Math.abs(fraction));
    element('status').textContent = t.dragging(RINGS[active.face].label, active.steps.toFixed(2));
  }
  stage.addEventListener('pointermove', event => {
    updateGesture(event);
    if (gesture?.pointerId === event.pointerId) event.preventDefault();
  }, { signal });
  function releaseGesture(event: PointerEvent, complete: boolean): void {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (complete) updateGesture(event);
    const active = gesture;
    // Keep capture ownership until the completion continuation or destroy releases it.
    active.release(complete);
  }
  stage.addEventListener('pointerup', event => releaseGesture(event, true), { signal });
  stage.addEventListener('pointercancel', event => releaseGesture(event, false), { signal });
  stage.addEventListener('lostpointercapture', event => releaseGesture(event, false), { signal });
  view.addEventListener('blur', () => gesture?.release(false), { signal });
  stage.addEventListener('contextmenu', event => {
    if (ringAt(event) || stage.dataset.activeRing) event.preventDefault();
  }, { signal });
  undo.addEventListener('click', () => void exclusive(async () => {
    const move = history.at(-1);
    if (!move) return;
    await perform({ face: move.face, inverse: !move.inverse }, false);
    if (destroyed) return;
    history.pop();
    render(state);
    element('status').textContent = t.undone(notation(move), status());
  }), { signal });
  element('reset').addEventListener('click', () => {
    if (busy) return;
    state = solvedState();
    history = [];
    render(state);
    element('status').textContent = t.resetDone;
  }, { signal });
  element('scramble').addEventListener('click', () => void exclusive(async () => {
    let previous: Face | undefined;
    for (let i = 0; i < 20; i++) {
      const candidates = (['F', 'U', 'R'] as Face[]).filter(face => face !== previous);
      const face = candidates[Math.floor(Math.random() * candidates.length)];
      await perform({ face, inverse: Math.random() < .5 }, true, 140);
      if (destroyed) return;
      previous = face;
    }
    element('status').textContent = t.scrambled(status());
  }), { signal });
  element('identities').addEventListener('change', event => {
    stage.classList.toggle('hide-identities', !(event.target as HTMLInputElement).checked);
  }, { signal });
  root.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        (event.target instanceof Element && (event.target.closest('.cube-app') !== root ||
          event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')))) return;
    const face = event.key.toUpperCase();
    if (face === 'F' || face === 'U' || face === 'R') {
      event.preventDefault();
      void command({ face, inverse: event.shiftKey });
    }
  }, { signal });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    events.abort();
    if (animationFrame !== undefined) view!.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    finishAnimation?.(false);
    finishAnimation = undefined;
    const active = gesture;
    gesture = undefined;
    if (active) {
      active.release(false);
      if (stage.hasPointerCapture(active.pointerId)) stage.releasePointerCapture(active.pointerId);
    }
    delete stage.dataset.activeRing;
    stage.setAttribute('aria-busy', 'false');
    instances.delete(root);
  }
  render(state);
  instances.set(root, destroy);
  return destroy;
}
