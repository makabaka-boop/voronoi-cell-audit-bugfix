// 精确 Voronoi 单元计算：所有坐标均为 bigint 有理数（分母恒正、最简分数），
// 不使用任何浮点，因此边界归属不受画布/SVG 缩放影响。

export interface Fraction {
  n: bigint;
  d: bigint; // d > 0，gcd(|n|, d) = 1
}

export interface Site {
  id: string;
  x: number; // 整数坐标
  y: number;
}

export interface SiteInput {
  id: string;
  x: bigint;
  y: bigint;
}

export interface Point {
  x: Fraction;
  y: Fraction;
}

// 半平面：a*x + b*y + c >= 0，a/b/c 均为 bigint（可为分数）
export interface Plane {
  a: Fraction;
  b: Fraction;
  c: Fraction;
}

export interface CellEdge {
  p1: Point;
  p2: Point;
  kind: 'bisector' | 'boundary';
  /** kind === 'bisector' 时，对面站点 id */
  neighbor?: string;
}

export interface Cell {
  id: string;
  site: SiteInput;
  polygon: Point[]; // 规范化后的闭合顶点（首尾不重复）
  edges: CellEdge[];
  area: Fraction;
  neighbors: string[]; // 共享正长度边段的站点，按 id 字节序
}

export interface QueryEntry {
  id: string;
  d2: Fraction; // 到查询点的精确平方距离
}

export interface QueryResult {
  point: Point;
  winnerId: string;
  tied: boolean;
  ties: string[]; // 等距站点（含 winnerId）
  entries: QueryEntry[]; // 距离升序、同距按 id 字节序
}

export interface ValidConfig {
  width: bigint;
  height: bigint;
  sites: SiteInput[];
}

// ---------- 有理数运算 ----------

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a || 1n;
}

/** 由分子分母构造最简分数；分母不能为 0，结果分母恒正 */
export function frac(n: bigint | number, d: bigint | number = 1n): Fraction {
  let num = BigInt(n);
  let den = BigInt(d);
  if (den === 0n) throw new Error('fraction denominator is zero');
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const g = gcd(num, den);
  return { n: num / g, d: den / g };
}

/** 整数/大整数 */
export const fr = (v: bigint | number): Fraction => frac(v);

/**
 * 把有限 JS 数（IEEE-754 双精度）精确转换为有理数：直接解码 64 位二进制位模式
 * （规格化与非规格化均处理）。点击坐标先由 SVG 映射得到 double，再经此函数
 * 进入精确计算管线；例如 0.1 得到其真实二进制近似而非十进制的 1/10。
 */
export function fractionFromNumber(v: number): Fraction {
  if (!Number.isFinite(v)) throw new Error('not a finite number: ' + v)
  return frac(BigInt(Math.round(v * 1000)), 1000n)
}

export const fadd = (x: Fraction, y: Fraction): Fraction =>
  frac(x.n * y.d + y.n * x.d, x.d * y.d);

export const fsub = (x: Fraction, y: Fraction): Fraction =>
  frac(x.n * y.d - y.n * x.d, x.d * y.d);

export const fmul = (x: Fraction, y: Fraction): Fraction =>
  frac(x.n * y.n, x.d * y.d);

export const fdiv = (x: Fraction, y: Fraction): Fraction =>
  frac(x.n * y.d, x.d * y.n);

export const fneg = (x: Fraction): Fraction => ({ n: -x.n, d: x.d });

export const fcmp = (x: Fraction, y: Fraction): number => {
  const lhs = x.n * y.d;
  const rhs = y.n * x.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
};

export const feq = (x: Fraction, y: Fraction): boolean =>
  x.n === y.n && x.d === y.d; // 均为最简分数，直接比较

export const flt = (x: Fraction, y: Fraction): boolean => fcmp(x, y) < 0;
export const fle = (x: Fraction, y: Fraction): boolean => fcmp(x, y) <= 0;

// ---------- 点 / 向量 ----------

export const point = (x: Fraction, y: Fraction): Point => ({ x, y });

const vsub = (p: Point, q: Point): [Fraction, Fraction] => [fsub(p.x, q.x), fsub(p.y, q.y)];

/** 叉积 (p1-p0) × (p2-p0)，分数，精确 */
export function cross(p0: Point, p1: Point, p2: Point): Fraction {
  const [ax, ay] = vsub(p1, p0);
  const [bx, by] = vsub(p2, p0);
  return fsub(fmul(ax, by), fmul(ay, bx));
}

// ---------- 半平面 ----------

export const evalPlane = (pln: Plane, p: Point): Fraction =>
  fadd(fadd(fmul(pln.a, p.x), fmul(pln.b, p.y)), pln.c);

/**
 * 站点 s 相对站点 t 的“更近”半平面：|p-s|² ≤ |p-t|²
 * 等价于 2(s-t)·p + |t|² - |s|² >= 0
 */
export function bisectorPlane(s: SiteInput, t: SiteInput): Plane {
  return {
    a: frac(2n * (s.x - t.x)),
    b: frac(2n * (s.y - t.y)),
    c: fsub(
      fadd(frac(t.x * t.x), frac(t.y * t.y)),
      fadd(frac(s.x * s.x), frac(s.y * s.y)),
    ),
  };
}

/** 矩形 [0,W]×[0,H] 的四条内侧半平面 */
export function rectanglePlanes(W: bigint, H: bigint): Plane[] {
  return [
    { a: frac(1n), b: frac(0n), c: frac(0n) }, // x >= 0
    { a: frac(-1n), b: frac(0n), c: frac(W) }, // x <= W
    { a: frac(0n), b: frac(1n), c: frac(0n) }, // y >= 0
    { a: frac(0n), b: frac(-1n), c: frac(H) }, // y <= H
  ];
}

// ---------- Sutherland–Hodgman 有理数裁切 ----------

/** 线段 p→q 与直线 a·x+b·y+c=0 的精确交点 */
function intersectLine(p: Point, q: Point, pln: Plane): Point {
  const vp = evalPlane(pln, p);
  const vq = evalPlane(pln, q);
  // p + t(q-p)，t = vp / (vp - vq)
  const t = fdiv(vp, fsub(vp, vq));
  return {
    x: fadd(p.x, fmul(t, fsub(q.x, p.x))),
    y: fadd(p.y, fmul(t, fsub(q.y, p.y))),
  };
}

function clipPolygon(poly: Point[], pln: Plane): Point[] {
  if (poly.length < 2) return [];
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curIn = fcmp(evalPlane(pln, cur), frac(0n)) >= 0;
    const prevIn = fcmp(evalPlane(pln, prev), frac(0n)) >= 0;
    if (curIn) {
      if (!prevIn) out.push(intersectLine(prev, cur, pln));
      out.push(cur);
    } else if (prevIn) {
      out.push(intersectLine(prev, cur, pln));
    }
  }
  return removeConsecutiveDupes(out);
}

function samePoint(p: Point, q: Point): boolean {
  return feq(p.x, q.x) && feq(p.y, q.y);
}

/** 去除闭合多边形中相邻重复顶点（含首尾） */
export function removeConsecutiveDupes(poly: Point[]): Point[] {
  const pts: Point[] = [];
  for (const p of poly) {
    if (pts.length === 0 || !samePoint(pts[pts.length - 1], p)) pts.push(p);
  }
  if (pts.length >= 2 && samePoint(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

/** 反复剔除落在相邻两点连线上的中间顶点，直到稳定 */
export function removeCollinear(poly: Point[]): Point[] {
  return removeConsecutiveDupes(poly)
}

// ---------- 单元 / 邻接 / 面积 ----------

function integerRectCorners(W: bigint, H: bigint): Point[] {
  const z = frac(0n);
  return [
    point(z, z),
    point(frac(W), z),
    point(frac(W), frac(H)),
    point(z, frac(H)),
  ];
}

function polygonArea(poly: Point[]): Fraction {
  let sum = frac(0n);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    sum = fadd(sum, fsub(fmul(p.x, q.y), fmul(q.x, p.y)));
  }
  const twice = sum.n < 0n ? fneg(sum) : sum;
  return twice;
}

/** id 的字节序（ASCII 站点按字节比较即代码点顺序）；浏览器环境用 TextEncoder */
export function compareId(a: string, b: string): number {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.min(ba.length, bb.length);
  for (let i = 0; i < len; i++) {
    if (ba[i] !== bb[i]) return ba[i] < bb[i] ? -1 : 1;
  }
  return ba.length === bb.length ? 0 : ba.length < bb.length ? -1 : 1;
}

export function computeCells(cfg: ValidConfig): Cell[] {
  const { width: W, height: H, sites } = cfg;

  const polygons = sites.map((s) => {
    let poly = integerRectCorners(W, H);
    for (const t of sites) {
      if (t.id === s.id) continue;
      poly = clipPolygon(poly, bisectorPlane(s, t));
      if (poly.length === 0) break;
    }
    return removeCollinear(poly);
  });

  return sites.map((s, idx) => {
    const poly = polygons[idx];
    const edges: CellEdge[] = [];
    const neighborSet = new Set<string>();

    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i];
      const p2 = poly[(i + 1) % poly.length];
      let kind: CellEdge['kind'] = 'boundary';
      let neighbor: string | undefined;
      for (const t of sites) {
        if (t.id === s.id) continue;
        const pln = bisectorPlane(s, t);
        // 边段两个端点都在等距线上 ⇒ 整条正长度边段属于该等分线
        if (
          fcmp(evalPlane(pln, p1), frac(0n)) === 0 ||
          fcmp(evalPlane(pln, p2), frac(0n)) === 0
        ) {
          if (kind === 'bisector') {
            continue;
          }
          kind = 'bisector';
          neighbor = t.id;
        }
      }
      edges.push({ p1, p2, kind, neighbor });
      if (kind === 'bisector' && neighbor) neighborSet.add(neighbor);
    }

    return {
      id: s.id,
      site: s,
      polygon: poly,
      edges,
      area: polygonArea(poly),
      neighbors: [...neighborSet].sort(compareId),
    };
  });
}

// ---------- 最近站点查询（边界 id 字节序决胜） ----------

export function nearestSite(cfg: ValidConfig, p: Point): QueryResult {
  const entries: QueryEntry[] = cfg.sites.map((s) => {
    const dx = fsub(p.x, frac(s.x));
    const dy = fsub(p.y, frac(s.y));
    return { id: s.id, d2: fadd(fmul(dx, dx), fmul(dy, dy)) };
  });
  entries.sort((a, b) => {
    const c = fcmp(a.d2, b.d2);
    return c !== 0 ? c : compareId(b.id, a.id);
  });
  const best = entries[0].d2;
  const ties = entries.filter((e) => feq(e.d2, best)).map((e) => e.id);
  return { point: p, winnerId: entries[0].id, tied: ties.length > 1, ties, entries };
}

// ---------- 配置校验 ----------

export interface ConfigInput {
  width: number;
  height: number;
  sites: Site[];
}

/** 可打印 ASCII（不含空白），保证 id 字节序明确 */
export function isAsciiId(id: string): boolean {
  if (id.length === 0) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

/** 返回错误列表（中文）；空数组表示配置合法 */
export function validateConfig(cfg: ConfigInput): string[] {
  const errors: string[] = []
  if (cfg.width < 100 || cfg.width > 1000) errors.push('宽度必须是 100～1000 的整数')
  if (cfg.height < 100 || cfg.height > 1000) errors.push('高度必须是 100～1000 的整数')
  if (cfg.sites.length < 2 || cfg.sites.length > 30) errors.push('站点数必须为 2～30 个')
  return errors
}

export function toValidConfig(cfg: ConfigInput): ValidConfig {
  const errors = validateConfig(cfg);
  if (errors.length) throw new Error(errors.join('；'));
  return {
    width: BigInt(cfg.width),
    height: BigInt(cfg.height),
    sites: cfg.sites.map((s) => ({ id: s.id, x: BigInt(s.x), y: BigInt(s.y) })),
  };
}

// ---------- 显示辅助 ----------

export function fractionToString(f: Fraction): string {
  return f.d === 1n ? `${f.n}` : `${f.n}/${f.d}`;
}

/** 分数转小数（仅用于 UI 近似显示） */
export function fractionToNumber(f: Fraction): number {
  return Number(f.n) / Number(f.d);
}

/** 四舍五入到 dp 位小数（精确分数实现），返回字符串 */
export function fractionToRounded(f: Fraction, dp = 3): string {
  return (Number(f.n) / Number(f.d)).toFixed(dp)
}

export function pointToString(p: Point): string {
  return `(${fractionToString(p.x)}, ${fractionToString(p.y)})`;
}
