import type { ReferenceFrameKind, UiMode } from '../physics/types';

export type Tool = 'pan' | 'launch';

export interface Settings {
  running: boolean;
  speed: number;
  tool: Tool;
  launchTypeId: string;
  showTrails: boolean;
  showLabels: boolean;
  showPrediction: boolean;
  showHillSphere: boolean;
  showSOI: boolean;
  showLagrange: boolean;
  showRoche: boolean;
  adaptiveDt: boolean;
  uiMode: UiMode;
  referenceFrame: ReferenceFrameKind;
  followId: number | null;
  selectedId: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  running: true,
  speed: 30,
  tool: 'launch',
  launchTypeId: 'rocky',
  showTrails: true,
  showLabels: true,
  showPrediction: true,
  showHillSphere: false,
  showSOI: false,
  showLagrange: true,
  showRoche: false,
  adaptiveDt: false,
  uiMode: 'game',
  referenceFrame: 'barycentric',
  followId: null,
  selectedId: null,
};

export const SPEED_STEPS = [1, 3, 10, 30, 60, 120, 240, 365, 730, 1500];

export const LAUNCH_SCALE = 0.06;

export { AU_PER_YEAR_TO_KMS } from '../physics/constants';
