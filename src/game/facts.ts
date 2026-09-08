/**
 * 儿童天文科普一句话（6-12 岁，带比喻，每条 50 字以内）。
 */

/** 20 条科普，按数组存放，适合随机抽取展示。 */
export const FUN_FACTS: string[] = [
  '引力像隐形橡皮筋，把行星拽着围太阳转圈圈。',
  '轨道像操场跑道，跑快了飞出去，跑慢了掉进去。',
  '引力弹弓像荡秋千借力，蹭一下木星就加速啦。',
  '黑洞像超级吸尘器，连跑最快的光都逃不掉。',
  '潮汐是月亮在玩拔河，把海水拉得一起一伏。',
  '柯伊伯带像太阳系冰库，藏着无数个脏雪球。',
  '太阳像大火炉，一秒发的光够我们用好久好久。',
  '阳光像快递员，从太阳跑到地球要花8分钟。',
  '月亮像害羞的娃娃，总用同一张脸看我们。',
  '火星像生锈的苹果，红彤彤因为全是铁锈。',
  '木星像老大哥，用大肚子挡住飞来的小行星。',
  '土星环像呼啦圈，是碎冰块和石头在跳舞。',
  '彗星像脏雪球，靠近太阳就拖出长长尾巴。',
  '小行星带像石头高速路，挤着几十万块石头。',
  '一天是地球转一圈，像陀螺原地打个转。',
  '一年是地球跑一圈，像围着操场跑完一整圈。',
  '四季是地球歪着头跑步，歪向太阳就是夏天。',
  '逃逸速度像扔球比赛，扔够快才能飞出地球。',
  '拉格朗日点像太空停车位，停那儿省油又省力。',
  '双星像手拉手的小朋友，转着圈一起跳舞。',
];

/** 同一份科普的 Record 视图：key 为主题，便于按主题取用。 */
export const FACTS: Record<string, string> = {
  gravity: FUN_FACTS[0],
  orbit: FUN_FACTS[1],
  slingshot: FUN_FACTS[2],
  blackhole: FUN_FACTS[3],
  tide: FUN_FACTS[4],
  kuiper: FUN_FACTS[5],
  sun: FUN_FACTS[6],
  light: FUN_FACTS[7],
  moon: FUN_FACTS[8],
  mars: FUN_FACTS[9],
  jupiter: FUN_FACTS[10],
  saturn: FUN_FACTS[11],
  comet: FUN_FACTS[12],
  asteroid: FUN_FACTS[13],
  day: FUN_FACTS[14],
  year: FUN_FACTS[15],
  season: FUN_FACTS[16],
  escape: FUN_FACTS[17],
  lagrange: FUN_FACTS[18],
  binary: FUN_FACTS[19],
};

/** 确定性随机（mulberry32），与 dailyMissions 共用同算法。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 按种子取一条随机科普（纯函数，相同 seed 返回相同结果）。
 * @param seed 任意整数种子
 */
export function getRandomFact(seed: number): string {
  const s = Number.isFinite(seed) ? Math.floor(seed) : 0;
  const rand = mulberry32(s >>> 0);
  const idx = Math.floor(rand() * FUN_FACTS.length) % FUN_FACTS.length;
  return FUN_FACTS[idx];
}
