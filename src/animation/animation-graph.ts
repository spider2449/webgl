import * as THREE from 'three';
import {
  bezierControlPoints,
  effectiveSegmentInterpolation,
  sampleScalarTrack,
  trackKeys,
} from './animation';
import type {
  AnimationTrackMap,
  KeyInterpolation,
  ScalarAnimationChannel,
  ScalarKey,
} from '../editor';

export type AnimationGraphData = {
  channel: ScalarAnimationChannel;
  mode: KeyInterpolation | 'mixed';
  frameMin: number;
  frameMax: number;
  valueMin: number;
  valueMax: number;
  actualMin: number;
  actualMax: number;
  samples: { frame: number; value: number }[];
  keys: { frame: number; value: number }[];
  sourceKeys: ScalarKey[];
  segmentModes: KeyInterpolation[];
};

export function animationChannelLabel(channel: ScalarAnimationChannel) {
  const [property, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
  const propertyLabel = property === 'position' ? 'Location' : property[0].toUpperCase() + property.slice(1);
  return `${propertyLabel} ${axis.toUpperCase()}`;
}

function displayNative(channel: ScalarAnimationChannel, nativeValue: number) {
  return channel.startsWith('rotation.') ? THREE.MathUtils.radToDeg(nativeValue) : nativeValue;
}

export function animationChannelValue(key: ScalarKey, channel: ScalarAnimationChannel) {
  return displayNative(channel, key.value);
}

export function buildAnimationGraphData(
  keys: ScalarKey[],
  channel: ScalarAnimationChannel,
): AnimationGraphData | null {
  if (!keys.length) return null;
  const sorted = keys.map(key => ({
    ...key,
    ...(key.left ? { left: [...key.left] as [number, number] } : {}),
    ...(key.right ? { right: [...key.right] as [number, number] } : {}),
  })).sort((a, b) => a.frame - b.frame);

  const keyPoints = sorted.map(key => ({ frame: key.frame, value: animationChannelValue(key, channel) }));
  const frameMin = sorted[0].frame;
  const frameMax = sorted[sorted.length - 1].frame;
  const samples: { frame: number; value: number }[] = [];
  const segmentModes: KeyInterpolation[] = [];

  if (sorted.length === 1) {
    samples.push({ ...keyPoints[0] });
  } else {
    for (let index = 0; index < sorted.length - 1; index++) {
      const a = sorted[index];
      const b = sorted[index + 1];
      const span = b.frame - a.frame;
      const mode = effectiveSegmentInterpolation(a);
      segmentModes.push(mode);
      const steps = mode === 'bezier' ? 32 : 2;
      for (let step = 0; step < steps; step++) {
        const frame = a.frame + span * step / steps;
        samples.push({ frame, value: displayNative(channel, sampleScalarTrack(sorted, frame)) });
      }
      if (mode === 'constant' && span > 0) {
        const nearEnd = b.frame - Math.min(1e-3, span * 1e-5);
        samples.push({ frame: nearEnd, value: displayNative(channel, sampleScalarTrack(sorted, nearEnd)) });
      }
    }
    samples.push({ ...keyPoints[keyPoints.length - 1] });
  }

  const uniqueModes = new Set(segmentModes);
  const mode: AnimationGraphData['mode'] = uniqueModes.size > 1
    ? 'mixed'
    : segmentModes[0] ?? effectiveSegmentInterpolation(sorted[0]);

  const handleValues: number[] = [];
  sorted.forEach((key, index) => {
    if (index > 0 && effectiveSegmentInterpolation(sorted[index - 1]) === 'bezier') {
      const controls = bezierControlPoints(sorted, index - 1);
      handleValues.push(displayNative(channel, controls.y2));
    }
    if (index < sorted.length - 1 && effectiveSegmentInterpolation(key) === 'bezier') {
      const controls = bezierControlPoints(sorted, index);
      handleValues.push(displayNative(channel, controls.y1));
    }
  });

  const values = [...samples.map(point => point.value), ...keyPoints.map(point => point.value), ...handleValues];
  const actualMin = Math.min(...values);
  const actualMax = Math.max(...values);
  let valueMin = actualMin;
  let valueMax = actualMax;
  if (!Number.isFinite(valueMin) || !Number.isFinite(valueMax)) return null;
  if (Math.abs(valueMax - valueMin) < 1e-9) {
    const pad = Math.max(1, Math.abs(valueMin) * 0.1);
    valueMin -= pad;
    valueMax += pad;
  } else {
    const pad = (valueMax - valueMin) * 0.12;
    valueMin -= pad;
    valueMax += pad;
  }

  return {
    channel,
    mode,
    frameMin,
    frameMax,
    valueMin,
    valueMax,
    actualMin,
    actualMax,
    samples,
    keys: keyPoints,
    sourceKeys: sorted,
    segmentModes,
  };
}

const NS = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K,
  attributes: Record<string, string | number>,
) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export type AnimationGraphEditCallbacks = {
  select: (frame: number, channel: ScalarAnimationChannel) => void;
  begin: (frames: number[], anchorFrame: number, channel: ScalarAnimationChannel, copy: boolean) => boolean;
  preview: (frame: number, channel: ScalarAnimationChannel, value: number) => boolean;
  end: (cancel: boolean) => void;
  beginHandle: (frame: number, channel: ScalarAnimationChannel, side: 'left' | 'right') => boolean;
  previewHandle: (frame: number, value: number) => { frame: number; value: number } | false;
  endHandle: (cancel: boolean) => void;
  selectionChanged: () => void;
};

type KeyDragState = {
  kind: 'key';
  pointerId: number;
  sourceFrames: number[];
  anchorFrame: number;
  anchorValue: number;
  startClientX: number;
  startClientY: number;
  markers: { sourceFrame: number; sourceValue: number; marker: SVGRectElement }[];
  ghostMarkers: SVGRectElement[];
  copy: boolean;
  lastFrameDelta: number | null;
  lastValueDelta: number;
};

type HandleDragState = {
  kind: 'handle';
  pointerId: number;
  keyFrame: number;
  side: 'left' | 'right';
  marker: SVGCircleElement;
  line: SVGLineElement;
};

type BoxDragState = {
  kind: 'box';
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  baseSelection: Set<number>;
  additive: boolean;
  moved: boolean;
};

type PanDragState = {
  kind: 'pan';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startView: GraphViewState;
  startManual: boolean;
};

type GraphViewState = {
  frameMin: number;
  frameMax: number;
  valueMin: number;
  valueMax: number;
};

type GraphDragState = KeyDragState | HandleDragState | BoxDragState | PanDragState;

export class AnimationGraphView {
  private signature = '';
  private data: AnimationGraphData | null = null;
  private readonly curveLayer = svgElement('g', { class: 'graph-static' });
  private readonly selectionBox = svgElement('rect', { class: 'graph-selection-box', visibility: 'hidden', x: 0, y: 0, width: 0, height: 0 });
  private readonly playhead = svgElement('line', { class: 'graph-playhead', x1: 0, x2: 0, y1: 18, y2: 162 });
  private drag: GraphDragState | null = null;
  private selectedFrames = new Set<number>();
  private objectId: string | null = null;
  private channel: ScalarAnimationChannel | null = null;
  private currentFrame = 1;
  private view: GraphViewState | null = null;
  private viewIsManual = false;
  private readonly savedViews = new Map<string, GraphViewState>();

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly title: HTMLElement,
    private readonly detail: HTMLElement,
    private readonly edits: AnimationGraphEditCallbacks,
  ) {
    const defs = svgElement('defs', {});
    const plotClip = svgElement('clipPath', { id: 'animation-graph-plot-clip' });
    plotClip.append(svgElement('rect', { x: 44, y: 14, width: 932, height: 152 }));
    defs.append(plotClip);
    svg.replaceChildren(defs, this.curveLayer, this.selectionBox, this.playhead);
    svg.addEventListener('pointerdown', this.pointerDown);
    svg.addEventListener('pointermove', this.pointerMove);
    svg.addEventListener('pointerup', this.pointerUp);
    svg.addEventListener('pointercancel', this.pointerCancel);
    svg.addEventListener('wheel', this.wheel, { passive: false });
    svg.addEventListener('keydown', this.keyDown);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.drag) {
        event.preventDefault();
        event.stopPropagation();
        this.finishDrag(true);
      }
    }, { capture: true });
  }

  get selectedKeyFrame() {
    return this.selectedFrames.size === 1 ? [...this.selectedFrames][0] : null;
  }

  get selectedKeyFrames() {
    return [...this.selectedFrames].sort((a, b) => a - b);
  }

  selectKeyFrame(frame: number | null) {
    this.selectedFrames = frame === null ? new Set() : new Set([frame]);
    this.signature = '';
  }

  selectKeyFrames(frames: number[]) {
    this.selectedFrames = new Set(frames);
    this.signature = '';
  }

  frameAll() {
    if (!this.data) return false;
    const frameSpan = Math.max(1, this.data.frameMax - this.data.frameMin);
    const framePad = Math.max(2, frameSpan * 0.08);
    const frameMin = Math.max(1, this.data.frameMin - framePad);
    const frameMax = Math.min(250, this.data.frameMax + framePad);
    return this.applyView({
      frameMin: frameMax - frameMin < 4 ? Math.max(1, (frameMin + frameMax) / 2 - 2) : frameMin,
      frameMax: frameMax - frameMin < 4 ? Math.min(250, (frameMin + frameMax) / 2 + 2) : frameMax,
      valueMin: this.data.valueMin,
      valueMax: this.data.valueMax,
    });
  }

  frameSelected() {
    if (!this.data || !this.selectedFrames.size) return false;
    const selected = this.data.keys.filter(key => this.selectedFrames.has(key.frame));
    if (!selected.length) return false;

    let frameMin = Math.min(...selected.map(key => key.frame));
    let frameMax = Math.max(...selected.map(key => key.frame));
    let valueMin = Math.min(...selected.map(key => key.value));
    let valueMax = Math.max(...selected.map(key => key.value));

    if (selected.length === 1) {
      frameMin = Math.max(1, frameMin - 10);
      frameMax = Math.min(250, frameMax + 10);
      const referenceSpan = Math.max(1e-6, this.data.valueMax - this.data.valueMin);
      const pad = Math.max(referenceSpan * 0.2, Math.abs(valueMin) * 0.05, 0.5);
      valueMin -= pad;
      valueMax += pad;
    } else {
      const framePad = Math.max(2, (frameMax - frameMin) * 0.12);
      frameMin = Math.max(1, frameMin - framePad);
      frameMax = Math.min(250, frameMax + framePad);
      const valueSpan = valueMax - valueMin;
      const valuePad = Math.max(valueSpan * 0.18, Math.abs(valueMin + valueMax) * 0.025, 0.25);
      valueMin -= valuePad;
      valueMax += valuePad;
    }

    return this.applyView({ frameMin, frameMax, valueMin, valueMax });
  }

  frameSceneRange() {
    if (!this.data) return false;
    const view = this.currentView();
    return this.applyView({ ...view, frameMin: 1, frameMax: 250 });
  }

  centerCurrentFrame() {
    if (!this.data) return false;
    const view = this.currentView();
    const span = view.frameMax - view.frameMin;
    return this.applyView({
      ...view,
      frameMin: this.currentFrame - span / 2,
      frameMax: this.currentFrame + span / 2,
    });
  }

  update(
    object: THREE.Object3D | null,
    channel: ScalarAnimationChannel,
    frame: number,
  ) {
    this.currentFrame = frame;
    const nextObjectId = object?.uuid ?? null;
    if (nextObjectId !== this.objectId || channel !== this.channel) {
      this.objectId = nextObjectId;
      this.channel = channel;
      this.selectedFrames.clear();
      const saved = this.savedViews.get(this.viewKey(nextObjectId, channel));
      this.view = saved ? { ...saved } : null;
      this.viewIsManual = Boolean(saved);
      this.signature = '';
    }

    const tracks = object?.userData.animationTracks as AnimationTrackMap | undefined;
    const keys = trackKeys(tracks, channel);
    if (!this.drag) {
      const keyFrames = new Set(keys.map(key => key.frame));
      this.selectedFrames = new Set([...this.selectedFrames].filter(frame => keyFrames.has(frame)));
    }

    const signature = JSON.stringify({
      uuid: object?.uuid ?? null,
      channel,
      selectedFrames: this.selectedKeyFrames,
      keys,
    });

    if (this.drag) {
      const fresh = buildAnimationGraphData(keys, channel);
      if (fresh && this.data) {
        fresh.valueMin = this.data.valueMin;
        fresh.valueMax = this.data.valueMax;
        this.data = fresh;
        this.renderCurvePath();
      }
    } else if (signature !== this.signature) {
      this.signature = signature;
      this.data = buildAnimationGraphData(keys, channel);
      if (this.data && (!this.view || !this.viewIsManual)) {
        this.view = this.defaultView(this.data);
      }
      this.renderStatic();
    }
    this.renderPlayhead(frame);
  }

  private renderStatic() {
    const data = this.data;
    this.curveLayer.replaceChildren();
    this.svg.dataset.channel = data?.channel ?? '';
    this.svg.dataset.mode = data?.mode ?? '';
    this.svg.dataset.keyCount = String(data?.keys.length ?? 0);
    this.svg.dataset.selectedFrame = this.selectedKeyFrame === null ? '' : String(this.selectedKeyFrame);
    this.svg.dataset.selectedFrames = this.selectedKeyFrames.join(',');
    const view = data ? this.currentView() : null;
    this.svg.dataset.viewFrameMin = view ? String(view.frameMin) : '';
    this.svg.dataset.viewFrameMax = view ? String(view.frameMax) : '';
    this.svg.dataset.viewValueMin = view ? String(view.valueMin) : '';
    this.svg.dataset.viewValueMax = view ? String(view.valueMax) : '';
    this.svg.dataset.viewManual = String(this.viewIsManual);

    if (!data) {
      this.title.textContent = 'Graph Editor';
      this.detail.textContent = 'Insert a channel key to display a curve.';
      this.playhead.setAttribute('visibility', 'hidden');
      return;
    }

    const modeLabel = data.mode === 'mixed' ? 'Mixed' : data.mode[0].toUpperCase() + data.mode.slice(1);
    this.title.textContent = animationChannelLabel(data.channel);
    const selectionLabel = this.selectedFrames.size > 1 ? ` · ${this.selectedFrames.size} selected` : '';
    this.detail.textContent = `${modeLabel} · Keys F${this.formatFrame(data.frameMin)}–F${this.formatFrame(data.frameMax)} · ${this.format(data.actualMin)} to ${this.format(data.actualMax)}${selectionLabel}`;
    const x = (frame: number) => this.frameX(frame);
    const y = (value: number) => this.valueY(data, value);

    for (let index = 0; index < 5; index++) {
      const gy = 18 + index * 36;
      this.curveLayer.append(svgElement('line', { class: 'graph-grid', x1: 48, x2: 972, y1: gy, y2: gy }));
    }
    for (const key of data.keys) {
      const gx = x(key.frame);
      this.curveLayer.append(svgElement('line', { class: 'graph-key-grid', x1: gx, x2: gx, y1: 18, y2: 162, 'clip-path': 'url(#animation-graph-plot-clip)' }));
    }

    const path = svgElement('path', { class: 'graph-curve', d: this.curvePath(data), 'clip-path': 'url(#animation-graph-plot-clip)' });
    path.dataset.sampleCount = String(data.samples.length);
    this.curveLayer.append(path);

    for (const key of data.keys) {
      const marker = svgElement('rect', {
        class: `graph-key-point${this.selectedFrames.has(key.frame) ? ' selected' : ''}`,
        x: x(key.frame) - 4,
        y: y(key.value) - 4,
        width: 8,
        height: 8,
        rx: 1,
        'clip-path': 'url(#animation-graph-plot-clip)',
      });
      marker.dataset.frame = String(key.frame);
      marker.dataset.value = String(key.value);
      marker.dataset.channel = data.channel;
      const tooltip = svgElement('title', {});
      tooltip.textContent = `Frame ${key.frame}: ${this.format(key.value)}`;
      marker.append(tooltip);
      this.curveLayer.append(marker);
    }

    this.renderHandles(data, x, y);

    const activeView = this.currentView();
    const top = svgElement('text', { class: 'graph-value-label', x: 8, y: 24 });
    top.textContent = this.format(activeView.valueMax);
    const bottom = svgElement('text', { class: 'graph-value-label', x: 8, y: 160 });
    bottom.textContent = this.format(activeView.valueMin);
    const frameStart = svgElement('text', { class: 'graph-frame-label', x: 48, y: 176, 'text-anchor': 'start' });
    frameStart.textContent = `F${this.formatFrame(activeView.frameMin)}`;
    const frameEnd = svgElement('text', { class: 'graph-frame-label', x: 972, y: 176, 'text-anchor': 'end' });
    frameEnd.textContent = `F${this.formatFrame(activeView.frameMax)}`;
    this.curveLayer.append(top, bottom, frameStart, frameEnd);
    this.playhead.setAttribute('visibility', 'visible');
  }

  private curvePath(data: AnimationGraphData) {
    return data.samples
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${this.frameX(point.frame).toFixed(2)} ${this.valueY(data, point.value).toFixed(2)}`)
      .join(' ');
  }

  private renderCurvePath() {
    if (!this.data) return;
    const path = this.curveLayer.querySelector<SVGPathElement>('.graph-curve');
    if (!path) return;
    path.setAttribute('d', this.curvePath(this.data));
    path.dataset.sampleCount = String(this.data.samples.length);
  }

  private renderHandles(data: AnimationGraphData, x: (frame: number) => number, y: (value: number) => number) {
    const selectedFrame = this.selectedKeyFrame;
    if (selectedFrame === null) return;
    const index = data.sourceKeys.findIndex(key => key.frame === selectedFrame);
    if (index < 0) return;
    const key = data.sourceKeys[index];
    const keyValue = animationChannelValue(key, data.channel);
    const tangent = key.tangent ?? 'free';

    const addHandle = (side: 'left' | 'right', handleFrame: number, handleValue: number) => {
      const line = svgElement('line', {
        class: `graph-handle-line ${tangent}`,
        x1: x(key.frame),
        y1: y(keyValue),
        x2: x(handleFrame),
        y2: y(handleValue),
        'clip-path': 'url(#animation-graph-plot-clip)',
      });
      line.dataset.handleLine = side;
      line.dataset.keyFrame = String(key.frame);
      const marker = svgElement('circle', {
        class: `graph-handle ${tangent}`,
        cx: x(handleFrame),
        cy: y(handleValue),
        r: 4,
        'clip-path': 'url(#animation-graph-plot-clip)',
      });
      marker.dataset.handle = side;
      marker.dataset.keyFrame = String(key.frame);
      marker.dataset.handleFrame = String(handleFrame);
      marker.dataset.handleValue = String(handleValue);
      marker.dataset.channel = data.channel;
      marker.dataset.tangent = tangent;
      const tooltip = svgElement('title', {});
      tooltip.textContent = tangent === 'auto'
        ? `Auto ${side} tangent · drag to convert to Aligned`
        : tangent === 'aligned'
          ? `Aligned ${side} tangent · opposite handle stays collinear`
          : `Free ${side} tangent · independent handle`;
      marker.append(tooltip);
      this.curveLayer.append(line, marker);
    };

    if (index > 0 && effectiveSegmentInterpolation(data.sourceKeys[index - 1]) === 'bezier') {
      const controls = bezierControlPoints(data.sourceKeys, index - 1);
      addHandle('left', controls.x2, displayNative(data.channel, controls.y2));
    }

    if (index < data.sourceKeys.length - 1 && effectiveSegmentInterpolation(key) === 'bezier') {
      const controls = bezierControlPoints(data.sourceKeys, index);
      addHandle('right', controls.x1, displayNative(data.channel, controls.y1));
    }
  }

  private syncSelectedHandleVisuals() {
    const data = this.data;
    const selectedFrame = this.selectedKeyFrame;
    if (!data || selectedFrame === null) return;
    const index = data.sourceKeys.findIndex(key => key.frame === selectedFrame);
    if (index < 0) return;
    const key = data.sourceKeys[index];
    const keyValue = animationChannelValue(key, data.channel);
    const tangent = key.tangent ?? 'free';

    const sync = (side: 'left' | 'right', handleFrame: number, handleValue: number) => {
      const marker = this.curveLayer.querySelector<SVGCircleElement>(`.graph-handle[data-handle="${side}"][data-key-frame="${selectedFrame}"]`);
      const line = this.curveLayer.querySelector<SVGLineElement>(`.graph-handle-line[data-handle-line="${side}"][data-key-frame="${selectedFrame}"]`);
      if (!marker || !line) return;
      const x = this.frameX(handleFrame);
      const y = this.valueY(data, handleValue);
      marker.setAttribute('cx', String(x));
      marker.setAttribute('cy', String(y));
      marker.dataset.handleFrame = String(handleFrame);
      marker.dataset.handleValue = String(handleValue);
      marker.dataset.tangent = tangent;
      marker.classList.remove('free', 'aligned', 'auto');
      marker.classList.add(tangent);
      line.setAttribute('x1', String(this.frameX(key.frame)));
      line.setAttribute('y1', String(this.valueY(data, keyValue)));
      line.setAttribute('x2', String(x));
      line.setAttribute('y2', String(y));
      line.classList.remove('free', 'aligned', 'auto');
      line.classList.add(tangent);
      const tooltip = marker.querySelector('title');
      if (tooltip) {
        tooltip.textContent = tangent === 'auto'
          ? `Auto ${side} tangent · drag to convert to Aligned`
          : tangent === 'aligned'
            ? `Aligned ${side} tangent · opposite handle stays collinear`
            : `Free ${side} tangent · independent handle`;
      }
    };

    if (index > 0 && effectiveSegmentInterpolation(data.sourceKeys[index - 1]) === 'bezier') {
      const controls = bezierControlPoints(data.sourceKeys, index - 1);
      sync('left', controls.x2, displayNative(data.channel, controls.y2));
    }
    if (index < data.sourceKeys.length - 1 && effectiveSegmentInterpolation(key) === 'bezier') {
      const controls = bezierControlPoints(data.sourceKeys, index);
      sync('right', controls.x1, displayNative(data.channel, controls.y1));
    }
  }

  private renderPlayhead(frame: number) {
    const data = this.data;
    if (!data) return;
    const view = this.currentView();
    const rawX = this.frameX(frame);
    const x = THREE.MathUtils.clamp(rawX, 48, 972);
    this.playhead.setAttribute('x1', x.toFixed(2));
    this.playhead.setAttribute('x2', x.toFixed(2));
    this.playhead.dataset.frame = String(frame);
    this.playhead.classList.toggle('outside', frame < view.frameMin || frame > view.frameMax);
  }

  private viewKey(objectId: string | null, channel: ScalarAnimationChannel) {
    return `${objectId ?? 'none'}:${channel}`;
  }

  private defaultView(data: AnimationGraphData): GraphViewState {
    return { frameMin: 1, frameMax: 250, valueMin: data.valueMin, valueMax: data.valueMax };
  }

  private currentView() {
    if (this.view) return this.view;
    if (this.data) {
      this.view = this.defaultView(this.data);
      return this.view;
    }
    return { frameMin: 1, frameMax: 250, valueMin: -1, valueMax: 1 };
  }

  private normalizeView(view: GraphViewState): GraphViewState {
    let frameMin = Math.min(view.frameMin, view.frameMax);
    let frameMax = Math.max(view.frameMin, view.frameMax);
    const frameCenter = (frameMin + frameMax) / 2;
    const frameSpan = THREE.MathUtils.clamp(frameMax - frameMin, 2, 1000);
    frameMin = frameCenter - frameSpan / 2;
    frameMax = frameCenter + frameSpan / 2;

    let valueMin = Math.min(view.valueMin, view.valueMax);
    let valueMax = Math.max(view.valueMin, view.valueMax);
    const valueCenter = (valueMin + valueMax) / 2;
    const minimumValueSpan = Math.max(1e-6, Math.abs(valueCenter) * 1e-6);
    const valueSpan = THREE.MathUtils.clamp(valueMax - valueMin, minimumValueSpan, 1e12);
    valueMin = valueCenter - valueSpan / 2;
    valueMax = valueCenter + valueSpan / 2;

    return { frameMin, frameMax, valueMin, valueMax };
  }

  private applyView(view: GraphViewState) {
    if (!this.data) return false;
    this.view = this.normalizeView(view);
    this.viewIsManual = true;
    this.savedViews.set(this.viewKey(this.objectId, this.data.channel), { ...this.view });
    this.renderStatic();
    this.renderPlayhead(this.currentFrame);
    return true;
  }

  private frameX(frame: number) {
    const view = this.currentView();
    return 48 + (frame - view.frameMin) / (view.frameMax - view.frameMin) * 924;
  }

  private frameAtX(x: number) {
    const view = this.currentView();
    return view.frameMin + (x - 48) / 924 * (view.frameMax - view.frameMin);
  }

  private valueY(_data: AnimationGraphData, value: number) {
    const view = this.currentView();
    return 18 + (view.valueMax - value) / (view.valueMax - view.valueMin) * 144;
  }

  private valueAtY(y: number) {
    const view = this.currentView();
    return view.valueMax - (y - 18) / 144 * (view.valueMax - view.valueMin);
  }

  private viewPoint(event: PointerEvent) {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width * 1000, 48, 972),
      y: THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height * 180, 18, 162),
    };
  }

  private setSelection(frames: Iterable<number>) {
    const next = new Set(frames);
    const before = this.selectedKeyFrames.join(',');
    this.selectedFrames = next;
    const after = this.selectedKeyFrames.join(',');
    if (before === after) return false;
    this.signature = '';
    this.renderStatic();
    this.edits.selectionChanged();
    return true;
  }

  private updateSelectionBox(drag: BoxDragState) {
    const x = Math.min(drag.startX, drag.currentX);
    const y = Math.min(drag.startY, drag.currentY);
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    this.selectionBox.setAttribute('x', String(x));
    this.selectionBox.setAttribute('y', String(y));
    this.selectionBox.setAttribute('width', String(width));
    this.selectionBox.setAttribute('height', String(height));
  }

  private pointerDown = (event: PointerEvent) => {
    if (this.drag || !this.data) return;
    this.svg.focus({ preventScroll: true });

    if (event.button === 1) {
      this.drag = {
        kind: 'pan',
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startView: { ...this.currentView() },
        startManual: this.viewIsManual,
      };
      this.svg.classList.add('panning');
      this.svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0) return;
    const element = event.target instanceof Element ? event.target : null;
    const handle = element?.closest<SVGCircleElement>('.graph-handle');
    if (handle) {
      const keyFrame = Number(handle.dataset.keyFrame);
      const side = handle.dataset.handle as 'left' | 'right' | undefined;
      const channel = handle.dataset.channel as ScalarAnimationChannel | undefined;
      if (!Number.isFinite(keyFrame) || !side || !channel || !this.edits.beginHandle(keyFrame, channel, side)) return;
      const line = this.curveLayer.querySelector<SVGLineElement>(`.graph-handle-line[data-handle-line="${side}"][data-key-frame="${keyFrame}"]`);
      if (!line) return;
      this.drag = {
        kind: 'handle',
        pointerId: event.pointerId,
        keyFrame,
        side,
        marker: handle,
        line,
      };
      handle.classList.add('dragging');
      this.svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const target = element?.closest<SVGRectElement>('.graph-key-point');
    if (!target) {
      const point = this.viewPoint(event);
      if (!point) return;
      this.drag = {
        kind: 'box',
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        baseSelection: new Set(this.selectedFrames),
        additive: event.shiftKey,
        moved: false,
      };
      this.selectionBox.setAttribute('visibility', 'visible');
      this.updateSelectionBox(this.drag);
      this.svg.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const frame = Number(target.dataset.frame);
    const value = Number(target.dataset.value);
    const channel = target.dataset.channel as ScalarAnimationChannel | undefined;
    if (!Number.isFinite(frame) || !Number.isFinite(value) || !channel) return;

    if (event.shiftKey) {
      if (this.selectedFrames.has(frame)) this.selectedFrames.delete(frame);
      else this.selectedFrames.add(frame);
      this.signature = '';
      this.edits.select(frame, channel);
      event.preventDefault();
      return;
    }

    if (!this.selectedFrames.has(frame)) this.selectedFrames = new Set([frame]);
    this.signature = '';
    const sourceFrames = this.selectedKeyFrames;
    const copy = event.altKey;
    if (!this.edits.begin(sourceFrames, frame, channel, copy)) {
      this.edits.select(frame, channel);
      return;
    }

    const selectedMarkers = [...this.curveLayer.querySelectorAll<SVGRectElement>('.graph-key-point')]
      .filter(marker => this.selectedFrames.has(Number(marker.dataset.frame)))
      .map(marker => ({
        sourceFrame: Number(marker.dataset.frame),
        sourceValue: Number(marker.dataset.value),
        marker,
      }));

    const ghostMarkers: SVGRectElement[] = [];
    if (copy) {
      for (const item of selectedMarkers) {
        const ghost = item.marker.cloneNode(true) as SVGRectElement;
        ghost.classList.add('ghost', 'dragging');
        ghost.classList.remove('selected');
        this.curveLayer.append(ghost);
        ghostMarkers.push(ghost);
      }
    } else {
      selectedMarkers.forEach(item => item.marker.classList.add('dragging', 'selected'));
    }

    this.drag = {
      kind: 'key',
      pointerId: event.pointerId,
      sourceFrames,
      anchorFrame: frame,
      anchorValue: value,
      startClientX: event.clientX,
      startClientY: event.clientY,
      markers: selectedMarkers,
      ghostMarkers,
      copy,
      lastFrameDelta: null,
      lastValueDelta: 0,
    };
    this.svg.setPointerCapture(event.pointerId);
    this.edits.select(frame, channel);
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    const data = this.data;
    if (!drag || !data || event.pointerId !== drag.pointerId) return;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    if (drag.kind === 'pan') {
      const start = drag.startView;
      const frameSpan = start.frameMax - start.frameMin;
      const valueSpan = start.valueMax - start.valueMin;
      const frameDelta = -(event.clientX - drag.startClientX) / rect.width * 1000 / 924 * frameSpan;
      const valueDelta = (event.clientY - drag.startClientY) / rect.height * 180 / 144 * valueSpan;
      this.applyView({
        frameMin: start.frameMin + frameDelta,
        frameMax: start.frameMax + frameDelta,
        valueMin: start.valueMin + valueDelta,
        valueMax: start.valueMax + valueDelta,
      });
      event.preventDefault();
      return;
    }

    if (drag.kind === 'box') {
      const point = this.viewPoint(event);
      if (!point) return;
      drag.currentX = point.x;
      drag.currentY = point.y;
      drag.moved ||= Math.hypot(drag.currentX - drag.startX, drag.currentY - drag.startY) >= 3;
      this.updateSelectionBox(drag);

      if (drag.moved) {
        const minX = Math.min(drag.startX, drag.currentX);
        const maxX = Math.max(drag.startX, drag.currentX);
        const minY = Math.min(drag.startY, drag.currentY);
        const maxY = Math.max(drag.startY, drag.currentY);
        const inside = data.keys
          .filter(key => {
            const x = this.frameX(key.frame);
            const y = this.valueY(data, key.value);
            return x >= minX && x <= maxX && y >= minY && y <= maxY;
          })
          .map(key => key.frame);
        this.setSelection(drag.additive ? [...drag.baseSelection, ...inside] : inside);
      }
      event.preventDefault();
      return;
    }

    if (drag.kind === 'handle') {
      const viewX = (event.clientX - rect.left) / rect.width * 1000;
      const viewY = (event.clientY - rect.top) / rect.height * 180;
      const targetFrame = this.frameAtX(viewX);
      const rawValue = this.valueAtY(viewY);
      const precision = data.channel.startsWith('rotation.') ? 0.1 : 0.001;
      const targetValue = Math.round(rawValue / precision) * precision;
      const applied = this.edits.previewHandle(targetFrame, targetValue);
      if (!applied) return;
      this.syncSelectedHandleVisuals();
      this.detail.textContent = `Tangent · F${this.formatFrame(applied.frame)} · ${this.format(applied.value)}`;
      event.preventDefault();
      return;
    }

    const deltaViewX = (event.clientX - drag.startClientX) / rect.width * 1000;
    const deltaViewY = (event.clientY - drag.startClientY) / rect.height * 180;
    const view = this.currentView();
    const targetFrame = THREE.MathUtils.clamp(
      Math.round(drag.anchorFrame + deltaViewX / 924 * (view.frameMax - view.frameMin)),
      1,
      250,
    );
    const rawValue = drag.anchorValue - deltaViewY / 144 * (view.valueMax - view.valueMin);
    const precision = data.channel.startsWith('rotation.') ? 0.1 : 0.001;
    const targetValue = Math.round(rawValue / precision) * precision;
    if (!this.edits.preview(targetFrame, data.channel, targetValue)) {
      drag.lastFrameDelta = null;
      drag.lastValueDelta = 0;
      const visualMarkers = drag.copy ? drag.ghostMarkers : drag.markers.map(item => item.marker);
      drag.markers.forEach((item, index) => {
        const marker = visualMarkers[index];
        marker.dataset.frame = String(item.sourceFrame);
        marker.dataset.value = String(item.sourceValue);
        marker.setAttribute('x', String(this.frameX(item.sourceFrame) - 4));
        const y = this.valueY(data, item.sourceValue);
        marker.setAttribute('y', String(THREE.MathUtils.clamp(y - 4, 4, 168)));
      });
      this.detail.textContent = `Blocked · selected keys would collide or leave the timeline`;
      event.preventDefault();
      return;
    }

    const frameDelta = targetFrame - drag.anchorFrame;
    const valueDelta = targetValue - drag.anchorValue;
    drag.lastFrameDelta = frameDelta;
    drag.lastValueDelta = valueDelta;
    const visualMarkers = drag.copy ? drag.ghostMarkers : drag.markers.map(item => item.marker);

    drag.markers.forEach((item, index) => {
      const marker = visualMarkers[index];
      const nextFrame = item.sourceFrame + frameDelta;
      const nextValue = item.sourceValue + valueDelta;
      marker.dataset.frame = String(nextFrame);
      marker.dataset.value = String(nextValue);
      marker.setAttribute('x', String(this.frameX(nextFrame) - 4));
      const y = this.valueY(data, nextValue);
      marker.setAttribute('y', String(THREE.MathUtils.clamp(y - 4, 4, 168)));
    });

    this.detail.textContent = `${drag.copy ? 'Copying' : 'Editing'} · ${drag.sourceFrames.length} key${drag.sourceFrames.length === 1 ? '' : 's'} · ΔF ${frameDelta >= 0 ? '+' : ''}${frameDelta}`;
    event.preventDefault();
  };

  private pointerUp = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.finishDrag(false);
    event.preventDefault();
  };

  private pointerCancel = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.finishDrag(true);
  };

  private finishDrag(cancel: boolean) {
    const drag = this.drag;
    if (!drag) return;

    if (drag.kind === 'pan') {
      if (cancel) {
        this.view = this.normalizeView(drag.startView);
        this.viewIsManual = drag.startManual;
        const key = this.data ? this.viewKey(this.objectId, this.data.channel) : null;
        if (key) {
          if (drag.startManual) this.savedViews.set(key, { ...this.view });
          else this.savedViews.delete(key);
        }
        this.renderStatic();
        this.renderPlayhead(this.currentFrame);
      }
      this.svg.classList.remove('panning');
      if (this.svg.hasPointerCapture(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId);
      this.drag = null;
      return;
    }

    if (drag.kind === 'box') {
      this.selectionBox.setAttribute('visibility', 'hidden');
      if (cancel) {
        this.setSelection(drag.baseSelection);
      } else if (!drag.moved) {
        this.setSelection(drag.additive ? drag.baseSelection : []);
      }
      if (this.svg.hasPointerCapture(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId);
      this.drag = null;
      this.signature = '';
      this.edits.selectionChanged();
      return;
    }

    if (drag.kind === 'handle') drag.marker.classList.remove('dragging');
    else {
      drag.markers.forEach(item => item.marker.classList.remove('dragging'));
      drag.ghostMarkers.forEach(marker => marker.remove());
      if (!cancel && drag.lastFrameDelta !== null) {
        this.selectedFrames = new Set(drag.sourceFrames.map(frame => frame + drag.lastFrameDelta!));
      } else {
        this.selectedFrames = new Set(drag.sourceFrames);
      }
    }
    if (this.svg.hasPointerCapture(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId);
    this.drag = null;
    this.signature = '';
    if (drag.kind === 'handle') this.edits.endHandle(cancel);
    else this.edits.end(cancel);
  }

  private wheel = (event: WheelEvent) => {
    if (!this.data || this.drag) return;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width * 1000, 48, 972);
    const y = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height * 180, 18, 162);
    const view = this.currentView();
    const frameAnchor = this.frameAtX(x);
    const valueAnchor = this.valueAtY(y);
    const frameRatio = (x - 48) / 924;
    const valueRatio = (y - 18) / 144;
    const factor = Math.exp(THREE.MathUtils.clamp(event.deltaY, -240, 240) * 0.0025);
    const frameSpan = THREE.MathUtils.clamp((view.frameMax - view.frameMin) * factor, 2, 1000);
    const valueSpan = THREE.MathUtils.clamp(
      (view.valueMax - view.valueMin) * factor,
      Math.max(1e-6, Math.abs(valueAnchor) * 1e-6),
      1e12,
    );
    this.applyView({
      frameMin: frameAnchor - frameRatio * frameSpan,
      frameMax: frameAnchor + (1 - frameRatio) * frameSpan,
      valueMin: valueAnchor - (1 - valueRatio) * valueSpan,
      valueMax: valueAnchor + valueRatio * valueSpan,
    });
    event.preventDefault();
  };

  private keyDown = (event: KeyboardEvent) => {
    if (this.drag || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Home') {
      if (this.frameAll()) event.preventDefault();
      return;
    }
    if (event.code === 'NumpadDecimal') {
      if (this.frameSelected()) event.preventDefault();
      return;
    }
    if (event.code === 'Numpad0') {
      if (this.centerCurrentFrame()) event.preventDefault();
    }
  };

  private formatFrame(frame: number) {
    return Number.isInteger(frame) ? String(frame) : frame.toFixed(2);
  }

  private format(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(2);
    return value.toFixed(abs >= 100 ? 1 : 2);
  }
}
