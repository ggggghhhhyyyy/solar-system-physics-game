export interface BodySpec {
  name: string;
  key?: string; // stable identifier for well-known bodies (e.g. 'earth')
  mass: number; // solar masses
  radius: number; // AU (display / collision radius, not to scale)
  x: number; // AU
  y: number; // AU
  vx: number; // AU / year
  vy: number; // AU / year
  color: string;
  isStar?: boolean;
  ring?: boolean;
  userLaunched?: boolean;
  fixed?: boolean;
}

export interface Body extends BodySpec {
  id: number;
  ax: number;
  ay: number;
  createdAt: number;
  trail: Float32Array;
  trailHead: number;
  trailCount: number;
}

export interface SimEvent {
  type: 'collision' | 'escaped';
  time: number;
  survivor?: Body;
  absorbed?: Body;
  body?: Body;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  viewRadius: number; // AU visible from center to edge
  bodies: BodySpec[];
  /** 该场景推荐的积分步长(年)。App 层加载时应执行 `engine.dt = p.dt ?? 0.0002`。 */
  dt?: number;
}
