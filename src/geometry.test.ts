import { describe, expect, it } from 'vitest';
import {
  Cell,
  Point,
  SiteInput,
  ValidConfig,
  bisectorPlane,
  compareId,
  computeCells,
  cross,
  evalPlane,
  feq,
  frac,
  fractionFromNumber,
  fractionToNumber,
  fractionToString,
  nearestSite,
  pointToString,
  removeCollinear,
  removeConsecutiveDupes,
  toValidConfig,
  validateConfig,
  fmul,
  fdiv,
  fadd,
  fle,
} from './geometry';

function cfg(w: number, h: number, sites: Array<[string, number, number]>): ValidConfig {
  return {
    width: BigInt(w),
    height: BigInt(h),
    sites: sites.map(([id, x, y]) => ({ id, x: BigInt(x), y: BigInt(y) })),
  };
}

const cellById = (cells: Cell[], id: string): Cell => {
  const c = cells.find((c) => c.id === id);
  if (!c) throw new Error('missing cell ' + id);
  return c;
};

function hasVertex(cell: Cell, x: string | number, y: string | number): boolean {
  const vx = typeof x === 'number' ? frac(BigInt(x)) : parseFrac(x);
  const vy = typeof y === 'number' ? frac(BigInt(y)) : parseFrac(y);
  return cell.polygon.some((p) => feq(p.x, vx) && feq(p.y, vy));
}

function parseFrac(s: string) {
  const [n, d] = s.split('/');
  return frac(BigInt(n), BigInt(d));
}

// 独立的朴素参考实现：整数平方距离 + 显式等距判定（小整数，JS 数值精确）
function naiveNearest(
  sites: SiteInput[],
  x: bigint,
  y: bigint,
): { winner: string; ties: string[] } {
  const X = Number(x);
  const Y = Number(y);
  let best = Infinity;
  let ties: string[] = [];
  for (const s of sites) {
    const d = (X - Number(s.x)) ** 2 + (Y - Number(s.y)) ** 2;
    if (d < best) {
      best = d;
      ties = [s.id];
    } else if (d === best) {
      ties.push(s.id);
    }
  }
  ties = ties.sort(compareId);
  return { winner: ties[0], ties };
}

// ---------- 双站点平分 ----------

describe('双站点平分线', () => {
  const c = cfg(100, 100, [
    ['A', 20, 50],
    ['B', 80, 50],
  ]);
  const cells = computeCells(c);

  it('矩形在 x=50 处被精确平分，面积各 5000', () => {
    const a = cellById(cells, 'A');
    const b = cellById(cells, 'B');
    expect(fractionToString(a.area)).toBe('5000');
    expect(fractionToString(b.area)).toBe('5000');
    expect(a.polygon).toHaveLength(4);
    expect(b.polygon).toHaveLength(4);
    for (const p of a.polygon) expect(fle(p.x, frac(50n))).toBe(true);
    for (const p of b.polygon) expect(!fle(p.x, frac(50n)) || feq(p.x, frac(50n))).toBe(true);
  });

  it('等分线边为 bisector 且邻接正确，矩形边为 boundary', () => {
    const a = cellById(cells, 'A');
    const bis = a.edges.filter((e) => e.kind === 'bisector');
    expect(bis).toHaveLength(1);
    expect(bis[0].neighbor).toBe('B');
    expect(feq(bis[0].p1.x, frac(50n))).toBe(true);
    expect(feq(bis[0].p2.x, frac(50n))).toBe(true);
    expect(a.edges.filter((e) => e.kind === 'boundary')).toHaveLength(3);
    expect(a.neighbors).toEqual(['B']);
  });

  it('穷举所有整数查询点，平分线 x=50 上按 id 字节序归 A', () => {
    for (let x = 0; x <= 100; x++) {
      for (let y = 0; y <= 100; y++) {
        const p = { x: frac(BigInt(x)), y: frac(BigInt(y)) };
        const q = nearestSite(c, p);
        const naive = naiveNearest(c.sites, BigInt(x), BigInt(y));
        expect(q.winnerId).toBe(naive.winner);
        expect(q.tied).toBe(x === 50);
        if (x === 50) {
          expect(q.winnerId).toBe('A'); // 'A' < 'B'
          expect(q.ties).toEqual(['A', 'B']);
        }
        // 距离证据：到 A、B 的精确平方距离
        const da = (x - 20) ** 2 + (y - 50) ** 2;
        const db = (x - 80) ** 2 + (y - 50) ** 2;
        const eA = q.entries.find((e) => e.id === 'A')!;
        const eB = q.entries.find((e) => e.id === 'B')!;
        expect(Number(eA.d2.n) / Number(eA.d2.d)).toBe(da);
        expect(Number(eB.d2.n) / Number(eB.d2.d)).toBe(db);
      }
    }
  });
});

// ---------- 共线站点 ----------

describe('共线站点', () => {
  const c = cfg(100, 100, [
    ['A', 10, 50],
    ['B', 50, 50],
    ['C', 90, 50],
  ]);
  const cells = computeCells(c);

  it('中间站点单元为 [30,70]，两侧单元宽 30', () => {
    expect(fractionToString(cellById(cells, 'A').area)).toBe('3000');
    expect(fractionToString(cellById(cells, 'B').area)).toBe('4000');
    expect(fractionToString(cellById(cells, 'C').area)).toBe('3000');
    expect(cellById(cells, 'A').neighbors).toEqual(['B']); // A-C 等分线 x=50 不形成边
    expect(cellById(cells, 'B').neighbors).toEqual(['A', 'C']);
    expect(cellById(cells, 'C').neighbors).toEqual(['B']);
  });

  it('穷举整数点：x=30 归 A（A/B 等距，A 字节序小），x=70 归 B', () => {
    for (let x = 0; x <= 100; x++) {
      for (let y = 0; y <= 100; y++) {
        const q = nearestSite(c, { x: frac(BigInt(x)), y: frac(BigInt(y)) });
        const naive = naiveNearest(c.sites, BigInt(x), BigInt(y));
        expect(q.winnerId).toBe(naive.winner);
        if (x === 30) {
          expect(q.tied).toBe(true);
          expect(q.ties).toEqual(['A', 'B']);
          expect(q.winnerId).toBe('A');
        } else if (x === 70) {
          expect(q.tied).toBe(true);
          expect(q.ties).toEqual(['B', 'C']);
          expect(q.winnerId).toBe('B');
        } else {
          expect(q.tied).toBe(false);
        }
      }
    }
  });
});

// ---------- 角落裁切 + 分数顶点 ----------

describe('角落裁切单元（5×5，小区域直接走精确有理数管线）', () => {
  const c = cfg(5, 5, [
    ['A', 4, 4],
    ['B', 1, 4],
    ['C', 4, 1],
  ]);
  const cells = computeCells(c);

  it('角点 A 的单元被两条等分线裁到 (5/2,5/2)，面积 25/4', () => {
    const a = cellById(cells, 'A');
    expect(hasVertex(a, '5/2', '5/2')).toBe(true);
    expect(hasVertex(a, 5, '5/2')).toBe(true);
    expect(hasVertex(a, 5, 5)).toBe(true);
    expect(hasVertex(a, '5/2', 5)).toBe(true);
    expect(a.polygon).toHaveLength(4);
    expect(fractionToString(a.area)).toBe('25/4');
    expect(a.neighbors).toEqual(['B', 'C']);
    const bis = a.edges.filter((e) => e.kind === 'bisector');
    expect(bis).toHaveLength(2);
    expect(new Set(bis.map((e) => e.neighbor))).toEqual(new Set(['B', 'C']));
  });

  it('B 单元同时含与 A 的垂直边和与 C 的对角边 y=x，面积 75/8', () => {
    const b = cellById(cells, 'B');
    expect(hasVertex(b, 0, 0)).toBe(true);
    expect(hasVertex(b, '5/2', '5/2')).toBe(true);
    expect(hasVertex(b, '5/2', 5)).toBe(true);
    expect(hasVertex(b, 0, 5)).toBe(true);
    expect(fractionToString(b.area)).toBe('75/8');
    expect(b.neighbors).toEqual(['A', 'C']);
    // 与 C 的等分线 y=x 上的边：(0,0)→(5/2,5/2)
    const edgeBC = b.edges.find((e) => e.neighbor === 'C');
    expect(edgeBC).toBeTruthy();
  });

  it('三单元面积之和恰好等于矩形面积（分数精确求和）', () => {
    const total = cells.reduce((acc, c) => fadd(acc, c.area), frac(0n));
    expect(fractionToString(total)).toBe('25');
  });

  it('邻接边段在两个单元中是同一条正长度线段（端点一致）', () => {
    for (const cell of cells) {
      for (const e of cell.edges) {
        expect(feq(e.p1.x, e.p2.x) && feq(e.p1.y, e.p2.y)).toBe(false); // 正长度
        if (e.kind !== 'bisector' || !e.neighbor) continue;
        const other = cellById(cells, e.neighbor);
        const reverse = other.edges.find(
          (o) =>
            o.neighbor === cell.id &&
            ((feq(o.p1.x, e.p1.x) && feq(o.p1.y, e.p1.y) && feq(o.p2.x, e.p2.x) && feq(o.p2.y, e.p2.y)) ||
              (feq(o.p1.x, e.p2.x) && feq(o.p1.y, e.p2.y) && feq(o.p2.x, e.p1.x) && feq(o.p2.y, e.p1.y))),
        );
        expect(reverse, `${cell.id}-${e.neighbor} 的共享边应双向存在`).toBeTruthy();
      }
    }
  });
});

// ---------- 随机小区域穷举 ----------

// 确定性 LCG，避免测试依赖随机种子
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe('随机小区域整数点穷举', () => {
  it('多组配置：每个整数点的最近站点与朴素枚举一致，且面积划分完整、邻接对称', () => {
    const rng = makeRng(20260926);
    for (let trial = 0; trial < 24; trial++) {
      const w = 4 + Math.floor(rng() * 5);
      const h = 4 + Math.floor(rng() * 5);
      const k = 2 + Math.floor(rng() * Math.min(5, w * h - 1));
      const coords = new Set<string>();
      const sites: SiteInput[] = [];
      let guard = 0;
      while (sites.length < k && guard++ < 1000) {
        const x = Math.floor(rng() * (w + 1));
        const y = Math.floor(rng() * (h + 1));
        const key = x + ',' + y;
        if (coords.has(key)) continue;
        coords.add(key);
        sites.push({ id: String.fromCharCode(65 + sites.length), x: BigInt(x), y: BigInt(y) });
      }
      const c: ValidConfig = { width: BigInt(w), height: BigInt(h), sites };
      const cells = computeCells(c);

      // 面积与邻接性质
      const total = cells.reduce((acc, cell) => fadd(acc, cell.area), frac(0n));
      expect(fractionToString(total)).toBe(`${w * h}`);
      for (const cell of cells) {
        expect(cell.polygon.length).toBeGreaterThanOrEqual(3);
        expect(fractionToNumber(cell.area)).toBeGreaterThan(0);
        for (const nId of cell.neighbors) {
          const other = cellById(cells, nId);
          expect(other.neighbors).toContain(cell.id);
        }
      }

      // 穷举整数查询点
      for (let x = 0; x <= w; x++) {
        for (let y = 0; y <= h; y++) {
          const p = { x: frac(BigInt(x)), y: frac(BigInt(y)) };
          const q = nearestSite(c, p);
          const naive = naiveNearest(sites, BigInt(x), BigInt(y));
          expect(q.winnerId).toBe(naive.winner);
          expect(q.ties.slice().sort()).toEqual(naive.ties.slice().sort());

          // 胜者必须满足全部半平面（查询结果与裁切单元同源一致）
          const winner = sites.find((s) => s.id === q.winnerId)!;
          for (const t of sites) {
            if (t.id === winner.id) continue;
            expect(fle(frac(0n), evalPlane(bisectorPlane(winner, t), p))).toBe(true);
          }
        }
      }
    }
  });
});

// ---------- 等距按 id 字节序 ----------

describe('等距决胜按站点 id 字节序', () => {
  const c = cfg(10, 2, [
    ['b', 0, 1],
    ['a', 2, 1],
  ]);

  it('平分线 x=1 上的所有整数点归 id 字节序更小的 a', () => {
    for (const y of [0, 1, 2]) {
      const q = nearestSite(c, { x: frac(1n), y: frac(BigInt(y)) });
      expect(q.tied).toBe(true);
      expect(q.ties).toEqual(['a', 'b']);
      expect(q.winnerId).toBe('a');
      expect(q.entries[0].id).toBe('a');
    }
  });

  it('分数查询点同样成立：(1/2, 1) 距 (0,1)、(1,1) 等距', () => {
    const c2 = cfg(4, 4, [
      ['Z', 0, 1],
      ['A', 1, 1],
    ]);
    const q = nearestSite(c2, { x: frac(1n, 2n), y: frac(1n) });
    expect(q.tied).toBe(true);
    expect(q.winnerId).toBe('A');
    expect(fractionToString(q.entries[0].d2)).toBe('1/4');
  });
});

// ---------- SVG 缩放不改变归属 ----------

describe('缩放不变性（模拟画布→逻辑坐标的精确换算）', () => {
  const c = cfg(100, 100, [
    ['A', 20, 50],
    ['B', 80, 50],
  ]);

  it('逻辑点 50 无论经何种整数倍画布缩放换算，都落在等距线上且归 A', () => {
    for (const viewW of [100, 250, 800, 1000]) {
      const cssX = viewW / 2; // 50% 处
      // x = cssX / viewW * W，全部经 fractionFromNumber 精确表示 double
      const x = fdiv(fmul(fractionFromNumber(cssX), frac(100n)), fractionFromNumber(viewW));
      expect(fractionToString(x)).toBe('50');
      const q = nearestSite(c, { x, y: frac(37n) });
      expect(q.winnerId).toBe('A');
      expect(q.tied).toBe(true);
    }
  });

  it('fractionFromNumber 还原 double 精确值（0.1 是二进制近似而非 1/10）', () => {
    expect(fractionToString(fractionFromNumber(0.5))).toBe('1/2');
    expect(fractionToString(fractionFromNumber(-1.5))).toBe('-3/2');
    // 0.1 的真实 double：3602879701896397 / 2^55
    const f = fractionFromNumber(0.1);
    expect(f.d).toBe(2n ** 55n);
    expect(f.n).toBe(3602879701896397n);
    expect(fractionToString(f)).not.toBe('1/10');
    expect(Number(f.n) / Number(f.d)).toBe(0.1);
    expect(fractionToNumber(frac(1n, 10n))).toBeCloseTo(0.1, 15);
  });
});

// ---------- 输入校验与重合拒绝 ----------

describe('配置校验', () => {
  it('接受边界尺寸与 2～30 个 ASCII 站点', () => {
    expect(
      validateConfig({
        width: 100,
        height: 1000,
        sites: [
          { id: 'A', x: 0, y: 0 },
          { id: 'B', x: 100, y: 1000 },
        ],
      }),
    ).toEqual([]);
  });

  it('拒绝越界宽高', () => {
    const e1 = validateConfig({ width: 99, height: 100, sites: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }] });
    expect(e1.join(';')).toContain('宽度');
    const e2 = validateConfig({ width: 100, height: 1001, sites: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }] });
    expect(e2.join(';')).toContain('高度');
  });

  it('拒绝非整数尺寸', () => {
    const e = validateConfig({ width: 100.5, height: 100, sites: [{ id: 'A', x: 0, y: 0 }, { id: 'B', x: 1, y: 1 }] });
    expect(e.length).toBeGreaterThan(0);
  });

  it('拒绝少于 2 或多于 30 个站点', () => {
    expect(validateConfig({ width: 100, height: 100, sites: [{ id: 'A', x: 0, y: 0 }] }).length).toBeGreaterThan(0);
    const many = Array.from({ length: 31 }, (_, i) => ({ id: 's' + i, x: i, y: 0 }));
    expect(validateConfig({ width: 100, height: 100, sites: many }).length).toBeGreaterThan(0);
  });

  it('拒绝重复 id 与非 ASCII id', () => {
    const e = validateConfig({
      width: 100,
      height: 100,
      sites: [
        { id: 'A', x: 0, y: 0 },
        { id: 'A', x: 5, y: 5 },
      ],
    });
    expect(e.join(';')).toContain('重复');
    const e2 = validateConfig({
      width: 100,
      height: 100,
      sites: [
        { id: '站点', x: 0, y: 0 },
        { id: 'B', x: 5, y: 5 },
      ],
    });
    expect(e2.join(';')).toContain('ASCII');
  });

  it('拒绝坐标越界', () => {
    const e = validateConfig({
      width: 100,
      height: 100,
      sites: [
        { id: 'A', x: -1, y: 0 },
        { id: 'B', x: 5, y: 101 },
      ],
    });
    expect(e.length).toBeGreaterThanOrEqual(2);
  });

  it('拒绝重合坐标（toValidConfig 抛错）', () => {
    expect(() =>
      toValidConfig({
        width: 100,
        height: 100,
        sites: [
          { id: 'A', x: 7, y: 8 },
          { id: 'B', x: 7, y: 8 },
        ],
      }),
    ).toThrow(/重合/);
  });

  it('合法配置可转为 bigint 配置', () => {
    const v = toValidConfig({
      width: 200,
      height: 300,
      sites: [
        { id: 'A', x: 0, y: 0 },
        { id: 'B', x: 200, y: 300 },
      ],
    });
    expect(v.width).toBe(200n);
    expect(v.sites[1]).toEqual({ id: 'B', x: 200n, y: 300n });
  });
});

// ---------- 多边形工具 ----------

describe('多边形规范化工具', () => {
  it('去除相邻重复顶点（含首尾）', () => {
    const a: Point = { x: frac(0n), y: frac(0n) };
    const b: Point = { x: frac(1n), y: frac(0n) };
    const cPt: Point = { x: frac(1n), y: frac(1n) };
    const out = removeConsecutiveDupes([a, a, b, cPt, a]);
    expect(out).toHaveLength(3);
  });

  it('去除共线中间点', () => {
    const pts: Point[] = [
      { x: frac(0n), y: frac(0n) },
      { x: frac(1n), y: frac(0n) },
      { x: frac(2n), y: frac(0n) },
      { x: frac(2n), y: frac(1n) },
    ];
    const out = removeCollinear(pts);
    expect(out).toHaveLength(3);
  });

  it('叉积为精确分数', () => {
    const p0 = { x: frac(0n), y: frac(0n) };
    const p1 = { x: frac(1n, 2n), y: frac(0n) };
    const p2 = { x: frac(0n), y: frac(1n, 4n) };
    expect(fractionToString(cross(p0, p1, p2))).toBe('1/8');
  });

  it('pointToString 显示精确分数顶点', () => {
    expect(pointToString({ x: frac(5n, 2n), y: frac(3n) })).toBe('(5/2, 3)');
  });
});
