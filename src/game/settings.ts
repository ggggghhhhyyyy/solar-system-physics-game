export type Tool = 'pan' | 'launch';

export interface Settings {
  running: boolean;
  speed: number; // simulated days per real second
  tool: Tool;
  launchTypeId: string;
  showTrails: boolean;
  showLabels: boolean;
  showPrediction: boolean;
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
  followId: null,
  selectedId: null,
};

export const SPEED_STEPS = [1, 3, 10, 30, 60, 120, 240, 365, 730, 1500];

/** AU/yr per pixel of drag when launching bodies. */
export const LAUNCH_SCALE = 0.06;

/** 1 AU/yr in km/s */
export const AU_PER_YEAR_TO_KMS = 4.74047;
