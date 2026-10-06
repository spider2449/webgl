import { allAnimationFrames, animationChannels, animationTracks, effectiveBezierHandle, effectiveSegmentInterpolation, sampleAnimationChannel, trackKeys } from './animation/animation';
import { AnimationGraphView, animationChannelLabel } from './animation/animation-graph';
import { animationActionNames, createAnimationAction, deleteAnimationAction, duplicateAnimationAction, setActiveAnimationAction } from './animation/blender-actions';
import './style.css';
import * as THREE from 'three';
import { createIcons, Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, Download, Upload, FolderPlus, FolderOpen, Image, Camera, BoxSelect, Sparkles, Wrench, Pencil, Clapperboard, Trash2, RefreshCw, FileJson, GitBranch, Moon, Sun, Minus, Copy, Check, Type, ArrowUpRight, Activity, Hand, ChevronLeft, ChevronRight as ChevronRightAlt, AlignHorizontalJustifyCenter, Sliders, MousePointer, Orbit, Target, User, Flame, Maximize, Minimize2, Wand2, Lock, Unlock, Circle, FileText, ListTree, View, Frame, Eraser, Save, Crosshair, CameraOff, CameraIcon, Filter, MinusCircle, SunMedium, Palette, PencilRuler, PencilLine } from 'lucide';
import { mountModelingUI } from './modeling/modeling-ui';
import { validateLogicalFaceInteriorKnifePath } from './modeling/modeling';
import { Editor, type AnimationTrackMap, type Primitive, type Project, type KeyInterpolation, type KeyTangentMode, type ScalarAnimationChannel, type TransformOrientation } from './editor';
import { RigSystem, rigBones } from './rig/rig';
import { addSomaPreview, createSomaRig, RIG_SOURCE } from './rig/soma77';

const icons = { Box, ChevronDown, ChevronRight, Plus, MousePointer2, Move, Rotate3d, Scaling, Magnet, Grid2x2, Scan, Eye, EyeOff, Search, SlidersHorizontal, Layers, Diamond, Play, Pause, SkipBack, SkipForward, Download, Upload, FolderPlus, FolderOpen, Image, Camera, BoxSelect, Sparkles, Wrench, Pencil, Clapperboard, Trash2, RefreshCw, FileJson, GitBranch, Moon, Sun, Minus, Copy, Check, Type, ArrowUpRight, Activity, Hand, ChevronLeft, ChevronRight: ChevronRightAlt, AlignHorizontalJustifyCenter, Sliders, MousePointer, Orbit, Target, User, Flame, Maximize, Minimize2, Wand2, Lock, Unlock, Circle, FileText, ListTree, View, Frame, Eraser, Save, Crosshair, CameraOff, CameraIcon, Filter, MinusCircle, SunMedium, Palette, PencilRuler, PencilLine };
const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const button = (id: string, name: string, label: string, extra = '') => `<button id="${id}" class="icon-button ${extra}" title="${label}" aria-label="${label}">${icon(name)}</button>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.5 } });

// Existing code continues; we insert the action bar at the point after initial app markup.
