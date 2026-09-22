import * as THREE from 'three';
import { sampleAnimation, type AnimationChannelInterpolation, type AnimationInterpolation } from './animation';
import type { Keyframe, ScalarAnimationChannel } from './editor';

export type AnimationGraphData = {
  channel: ScalarAnimationChannel;
  mode: AnimationInterpolation;
  frameMin: number;
  frameMax: number;
  valueMin: number;
  valueMax: number;
  actualMin: number;
  actualMax: number;
  samples: { frame: number; value: number }[];
  keys: { frame: number; value: number }[];
};

const axes = ['x', 'y', 'z'] as const;

export function animationChannelLabel(channel: ScalarAnimationChannel) {
  const [property, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
  const propertyLabel = property === 'position' ? 'Location' : property[0].toUpperCase() + property.slice(1);
  return `${propertyLabel} ${axis.toUpperCase()}`;
}

export function animationChannelValue(key: Keyframe, channel: ScalarAnimationChannel) {
  const [property, axis] = channel.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
  const component = axes.indexOf(axis);
  if (property === 'position') return key.position[component];
  if (property === 'scale') return key.scale[component];
  if (key.rotation) return THREE.MathUtils.radToDeg(key.rotation[component]);

  const order = key.rotationOrder ?? 'XYZ';
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(key.quaternion), order);
  return THREE.MathUtils.radToDeg([euler.x, euler.y, euler.z][component]);
}

function sampledChannelValue(key: Keyframe, channel: ScalarAnimationChannel) {
  return animationChannelValue(key, channel);
}

export function buildAnimationGraphData(
  keys: Keyframe[],
  channel: ScalarAnimationChannel,
  defaultMode: AnimationInterpolation,
  overrides: AnimationChannelInterpolation = {},
): AnimationGraphData | null {
  if (!keys.length) return null;
  const sorted = [...keys].sort((a, b) => a.frame - b.frame);
  const mode = overrides[channel] ?? defaultMode;
  const keyPoints = sorted.map(key => ({ frame: key.frame, value: animationChannelValue(key, channel) }));
  const frameMin = sorted[0].frame;
  const frameMax = sorted[sorted.length - 1].frame;
  const samples: { frame: number; value: number }[] = [];

  if (sorted.length === 1) {
    samples.push({ ...keyPoints[0] });
  } else {
    for (let index = 0; index < sorted.length - 1; index++) {
      const a = sorted[index];
      const b = sorted[index + 1];
      const span = b.frame - a.frame;
      const steps = mode === 'constant' ? 2 : 32;
      for (let step = 0; step < steps; step++) {
        const t = step / steps;
        const frame = a.frame + span * t;
        const sample = sampleAnimation(sorted, frame, defaultMode, overrides);
        samples.push({ frame, value: sampledChannelValue(sample, channel) });
      }
      if (mode === 'constant' && span > 0) {
        const nearEnd = b.frame - Math.min(1e-3, span * 1e-5);
        const sample = sampleAnimation(sorted, nearEnd, defaultMode, overrides);
        samples.push({ frame: nearEnd, value: sampledChannelValue(sample, channel) });
      }
    }
    samples.push({ ...keyPoints[keyPoints.length - 1] });
  }

  const values = [...samples.map(point => point.value), ...keyPoints.map(point => point.value)];
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

  return { channel, mode, frameMin, frameMax, valueMin, valueMax, actualMin, actualMax, samples, keys: keyPoints };
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
  begin: (frame: number, channel: ScalarAnimationChannel) => boolean;
  preview: (frame: number, channel: ScalarAnimationChannel, value: number) => boolean;
  end: (cancel: boolean) => void;
};

type GraphDragState = {
  pointerId: number;
  sourceFrame: number;
  startValue: number;
  startClientX: number;
  startClientY: number;
  valueMin: number;
  valueMax: number;
  marker: SVGRectElement;
};

export class AnimationGraphView {
  private signature = '';
  private data: AnimationGraphData | null = null;
  private readonly curveLayer = svgElement('g', { class: 'graph-static' });
  private readonly playhead = svgElement('line', { class: 'graph-playhead', x1: 0, x2: 0, y1: 18, y2: 162 });
  private drag: GraphDragState | null = null;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly title: HTMLElement,
    private readonly detail: HTMLElement,
    private readonly edits: AnimationGraphEditCallbacks,
  ) {
    svg.replaceChildren(this.curveLayer, this.playhead);
    svg.addEventListener('pointerdown', this.pointerDown);
    svg.addEventListener('pointermove', this.pointerMove);
    svg.addEventListener('pointerup', this.pointerUp);
    svg.addEventListener('pointercancel', this.pointerCancel);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.drag) {
        event.preventDefault();
        this.finishDrag(true);
      }
    });
  }

  update(
    object: THREE.Object3D | null,
    channel: ScalarAnimationChannel,
    frame: number,
  ) {
    const keys: Keyframe[] = object?.userData.keyframes ?? [];
    const defaultMode: AnimationInterpolation = object?.userData.animationInterpolation ?? 'linear';
    const overrides: AnimationChannelInterpolation = object?.userData.animationChannelInterpolation ?? {};
    const signature = JSON.stringify({
      uuid: object?.uuid ?? null,
      channel,
      defaultMode,
      override: overrides[channel] ?? null,
      keys: keys.map(key => ({
        frame: key.frame,
        position: key.position,
        rotation: key.rotation,
        rotationOrder: key.rotationOrder,
        quaternion: key.rotation ? undefined : key.quaternion,
        scale: key.scale,
      })),
    });

    if (!this.drag && signature !== this.signature) {
      this.signature = signature;
      this.data = buildAnimationGraphData(keys, channel, defaultMode, overrides);
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

    if (!data) {
      this.title.textContent = 'Graph Editor';
      this.detail.textContent = 'Add transform keys to display a curve.';
      this.playhead.setAttribute('visibility', 'hidden');
      return;
    }

    this.title.textContent = animationChannelLabel(data.channel);
    this.detail.textContent = `${data.mode[0].toUpperCase() + data.mode.slice(1)} · Keys F${this.formatFrame(data.frameMin)}–${this.formatFrame(data.frameMax)} · ${this.format(data.actualMin)} to ${this.format(data.actualMax)}`;
    const x = (frame: number) => this.frameX(data, frame);
    const y = (value: number) => 18 + (data.valueMax - value) / (data.valueMax - data.valueMin) * 144;

    for (let index = 0; index < 5; index++) {
      const gy = 18 + index * 36;
      this.curveLayer.append(svgElement('line', { class: 'graph-grid', x1: 48, x2: 972, y1: gy, y2: gy }));
    }
    for (const key of data.keys) {
      const gx = x(key.frame);
      this.curveLayer.append(svgElement('line', { class: 'graph-key-grid', x1: gx, x2: gx, y1: 18, y2: 162 }));
    }

    const pathData = data.samples
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.frame).toFixed(2)} ${y(point.value).toFixed(2)}`)
      .join(' ');
    const path = svgElement('path', { class: 'graph-curve', d: pathData });
    path.dataset.sampleCount = String(data.samples.length);
    this.curveLayer.append(path);

    for (const key of data.keys) {
      const marker = svgElement('rect', {
        class: 'graph-key-point',
        x: x(key.frame) - 4,
        y: y(key.value) - 4,
        width: 8,
        height: 8,
        rx: 1,
      });
      marker.dataset.frame = String(key.frame);
      marker.dataset.value = String(key.value);
      marker.dataset.channel = data.channel;
      const tooltip = svgElement('title', {});
      tooltip.textContent = `Frame ${key.frame}: ${this.format(key.value)}`;
      marker.append(tooltip);
      this.curveLayer.append(marker);
    }

    const top = svgElement('text', { class: 'graph-value-label', x: 8, y: 24 });
    top.textContent = this.format(data.valueMax);
    const bottom = svgElement('text', { class: 'graph-value-label', x: 8, y: 160 });
    bottom.textContent = this.format(data.valueMin);
    const frameStart = svgElement('text', { class: 'graph-frame-label', x: 48, y: 176, 'text-anchor': 'start' });
    frameStart.textContent = 'F1';
    const frameEnd = svgElement('text', { class: 'graph-frame-label', x: 972, y: 176, 'text-anchor': 'end' });
    frameEnd.textContent = 'F250';
    this.curveLayer.append(top, bottom, frameStart, frameEnd);
    this.playhead.setAttribute('visibility', 'visible');
  }

  private renderPlayhead(frame: number) {
    const data = this.data;
    if (!data) return;
    const clamped = THREE.MathUtils.clamp(frame, 1, 250);
    const x = this.frameX(data, clamped);
    this.playhead.setAttribute('x1', x.toFixed(2));
    this.playhead.setAttribute('x2', x.toFixed(2));
    this.playhead.dataset.frame = String(frame);
    this.playhead.classList.toggle('outside', frame < 1 || frame > 250);
  }

  private frameX(_data: AnimationGraphData, frame: number) {
    return 48 + (frame - 1) / 249 * 924;
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.drag || !this.data) return;
    const target = event.target instanceof Element ? event.target.closest<SVGRectElement>('.graph-key-point') : null;
    if (!target) return;
    const frame = Number(target.dataset.frame);
    const value = Number(target.dataset.value);
    const channel = target.dataset.channel as ScalarAnimationChannel | undefined;
    if (!Number.isFinite(frame) || !Number.isFinite(value) || !channel || !this.edits.begin(frame, channel)) return;

    this.drag = {
      pointerId: event.pointerId,
      sourceFrame: frame,
      startValue: value,
      startClientX: event.clientX,
      startClientY: event.clientY,
      valueMin: this.data.valueMin,
      valueMax: this.data.valueMax,
      marker: target,
    };
    target.classList.add('dragging');
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private pointerMove = (event: PointerEvent) => {
    const drag = this.drag;
    const data = this.data;
    if (!drag || !data || event.pointerId !== drag.pointerId) return;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const deltaViewX = (event.clientX - drag.startClientX) / rect.width * 1000;
    const deltaViewY = (event.clientY - drag.startClientY) / rect.height * 180;
    const targetFrame = THREE.MathUtils.clamp(Math.round(drag.sourceFrame + deltaViewX / 924 * 249), 1, 250);
    const span = drag.valueMax - drag.valueMin;
    const rawValue = drag.startValue - deltaViewY / 144 * span;
    const precision = data.channel.startsWith('rotation.') ? 0.1 : 0.001;
    const targetValue = Math.round(rawValue / precision) * precision;
    if (!this.edits.preview(targetFrame, data.channel, targetValue)) return;

    drag.marker.dataset.frame = String(targetFrame);
    drag.marker.dataset.value = String(targetValue);
    drag.marker.setAttribute('x', String(this.frameX(data, targetFrame) - 4));
    const y = 18 + (drag.valueMax - targetValue) / span * 144;
    drag.marker.setAttribute('y', String(THREE.MathUtils.clamp(y - 4, 4, 168)));
    this.detail.textContent = `Editing · F${targetFrame} · ${this.format(targetValue)}`;
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
    drag.marker.classList.remove('dragging');
    if (this.svg.hasPointerCapture(drag.pointerId)) this.svg.releasePointerCapture(drag.pointerId);
    this.drag = null;
    this.signature = '';
    this.edits.end(cancel);
  }

  private formatFrame(frame: number) {
    return Number.isInteger(frame) ? String(frame) : frame.toFixed(2);
  }

  private format(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(2);
    return value.toFixed(abs >= 100 ? 1 : 2);
  }
}
