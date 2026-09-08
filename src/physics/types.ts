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
  /** 黑洞:参与引力计算,渲染为事件视界+吸积盘,合并时保留黑洞属性 */
  isBlackHole?: boolean;
  /**
   * 无碰撞体(如小行星带/吸积盘气体粒子):两个 noCollide 天体之间跳过碰撞合并,
   * 但与普通天体(行星/卫星/黑洞)仍可碰撞——既避免碎块互相 grind,又保留撞击与吸积。
   */
  noCollide?: boolean;
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
  /** 该场景推荐的引力软化长度(AU)。含卫星/吸积盘的场景需要更小的值,App 层加载时应执行 `engine.softening = p.softening ?? 0.003`。 */
  softening?: number;
}
