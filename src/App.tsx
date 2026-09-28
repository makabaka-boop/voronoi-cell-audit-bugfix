import { useMemo, useRef, useState } from 'react';
import {
  Cell,
  Fraction,
  Point,
  QueryResult,
  Site,
  ValidConfig,
  computeCells,
  fadd,
  frac,
  fractionFromNumber,
  fractionToNumber,
  fractionToRounded,
  fractionToString,
  nearestSite,
  pointToString,
  toValidConfig,
  validateConfig,
} from './geometry';

interface Model {
  cfg: ValidConfig;
  cells: Cell[];
}

// 稳定的浅色调色板（按站点在配置中的顺序循环）
const PALETTE = [
  '#dbeafe', '#dcfce7', '#fef3c7', '#fce7f3', '#e0e7ff',
  '#cffafe', '#ffedd5', '#f3e8ff', '#ecfccb', '#fee2e2',
  '#e2e8f0', '#d1fae5',
];

function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

function fracText(f: Fraction, dp = 2): string {
  const exact = fractionToString(f);
  const approx = fractionToRounded(f, dp);
  return exact.includes('/') ? `${exact} ≈ ${approx}` : exact;
}

export default function App() {
  const [width, setWidth] = useState(300);
  const [height, setHeight] = useState(200);
  const [sites, setSites] = useState<Site[]>([
    { id: 'A', x: 60, y: 100 },
    { id: 'B', x: 200, y: 60 },
    { id: 'C', x: 240, y: 160 },
  ]);
  const [query, setQuery] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragMoved = useRef(false);

  // 新增站点表单
  const [newId, setNewId] = useState('');
  const [newX, setNewX] = useState('');
  const [newY, setNewY] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const errors = useMemo(
    () => validateConfig({ width, height, sites }),
    [width, height, sites],
  );

  // 图形与列表共享的唯一计算结果
  const model: Model | null = useMemo(() => {
    if (errors.length > 0) return null;
    try {
      const cfg = toValidConfig({ width, height, sites });
      return { cfg, cells: computeCells(cfg) };
    } catch {
      return null;
    }
  }, [errors, width, height, sites]);

  const queryResult: QueryResult | null = useMemo(() => {
    if (!model || !query) return null;
    return nearestSite(model.cfg, query);
  }, [model, query]);

  const cellById = useMemo(() => {
    const m = new Map<string, Cell>();
    model?.cells.forEach((c) => m.set(c.id, c));
    return m;
  }, [model]);

  /** 浏览器事件坐标 → viewBox 逻辑坐标（double），与 SVG 缩放方式无关 */
  function clientToLogical(clientX: number, clientY: number): { x: number; y: number } {
    const svg = svgRef.current!;
    const ctm = svg.getScreenCTM();
    if (!ctm) throw new Error('SVG CTM 不可用');
    const loc = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  }

  function toLogical(clientX: number, clientY: number): Point {
    const loc = clientToLogical(clientX, clientY);
    return { x: fractionFromNumber(loc.x), y: fractionFromNumber(loc.y) };
  }

  const clampInt = (v: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(v)));

  function onCanvasPointerDown(e: React.PointerEvent) {
    // 点到站点标记交给标记处理（其 onPointerDown 已 stopPropagation）；
    // 点到单元多边形/边线/空白都应得到一次完整查询。
    setQuery(toLogical(e.clientX, e.clientY));
    setSelectedId(null);
  }

  function onMarkerPointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragMoved.current = false;
    setDragId(id);
    setSelectedId(id);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    // 先经逆 CTM 还原到 viewBox 逻辑坐标再取整，缩放/留白不改变落点
    const loc = clientToLogical(e.clientX, e.clientY);
    const nx = clampInt(loc.x, 0, width);
    const ny = clampInt(loc.y, 0, height);
    setSites((prev) => {
      const target = prev.find((s) => s.id === dragId);
      if (!target) return prev;
      if (target.x === nx && target.y === ny) return prev;
      // 重合坐标拒绝（不落到其它站点上）
      if (prev.some((s) => s.id !== dragId && s.x === nx && s.y === ny)) return prev;
      dragMoved.current = true;
      return prev.map((s) => (s.id === dragId ? { ...s, x: nx, y: ny } : s));
    });
  }

  function onPointerUp() {
    setDragId(null);
  }

  function addSite() {
    setFormError(null);
    const id = newId.trim();
    const x = Number(newX);
    const y = Number(newY);
    // 本地预检（完整规则复用 validateConfig），非法站点绝不进入状态
    if (!id) {
      setFormError('id 不能为空');
      return;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isInteger(x) || !Number.isInteger(y)) {
      setFormError('坐标必须填写整数');
      return;
    }
    if (x < 0 || x > width || y < 0 || y > height) {
      setFormError(`坐标须在 [0,${width}]×[0,${height}] 内`);
      return;
    }
    if (sites.some((s) => s.id === id)) {
      setFormError(`id 已存在：${id}`);
      return;
    }
    if (sites.some((s) => s.x === x && s.y === y)) {
      setFormError(`坐标 (${x}, ${y}) 已被其它站点占用`);
      return;
    }
    if (sites.length >= 30) {
      setFormError('站点数不能超过 30');
      return;
    }
    setSites([...sites, { id, x, y }]);
    setNewId('');
    setNewX('');
    setNewY('');
  }

  function removeSite(id: string) {
    setSites((prev) => prev.filter((s) => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function polygonPoints(cell: Cell): string {
    return cell.polygon
      .map((p) => `${fractionToNumber(p.x)},${fractionToNumber(p.y)}`)
      .join(' ');
  }

  const W = width;
  const H = height;
  const winnerId = queryResult?.winnerId ?? null;
  const tieSet = new Set(queryResult?.ties ?? []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>站点服务区编辑器</h1>
        <p className="subtitle">
          平方欧氏距离 · 有理数半平面依次裁切矩形 · 精确面积与邻接 ·
          等距边界按站点 id 字节序取胜（不依赖画布像素）
        </p>
      </header>

      <section className="controls">
        <label>
          区域宽
          <input
            type="number" min={100} max={1000} step={1}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
        <label>
          区域高
          <input
            type="number" min={100} max={1000} step={1}
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </label>
        <span className="hint">宽高为 100～1000 的整数</span>
        <div className="add-form">
          <input
            className="id-input" placeholder="id (ASCII)"
            value={newId} onChange={(e) => setNewId(e.target.value)}
          />
          <input
            className="xy-input" placeholder="x" type="number"
            value={newX} onChange={(e) => setNewX(e.target.value)}
          />
          <input
            className="xy-input" placeholder="y" type="number"
            value={newY} onChange={(e) => setNewY(e.target.value)}
          />
          <button onClick={addSite} disabled={sites.length >= 30}>添加站点</button>
          {formError && <span className="form-error">{formError}</span>}
        </div>
      </section>

      {errors.length > 0 && (
        <div className="errors">
          <strong>配置不合法：</strong>
          <ul>{errors.map((msg, i) => <li key={i}>{msg}</li>)}</ul>
        </div>
      )}

      <main className="main">
        <div className="canvas-card">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="canvas"
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* 底图：点击空白处查询 */}
            <rect x={0} y={0} width={W} height={H} fill="#ffffff" />

            {model && model.cells.map((cell, i) => {
              const isWinner = cell.id === winnerId;
              const isSelected = cell.id === selectedId;
              const inTie = tieSet.has(cell.id);
              return (
                <polygon
                  key={cell.id}
                  points={polygonPoints(cell)}
                  fill={colorFor(i)}
                  fillOpacity={winnerId ? (isWinner ? 0.95 : 0.35) : 0.7}
                  stroke={
                    isWinner
                      ? '#4338ca'
                      : isSelected
                        ? '#111827'
                        : inTie
                          ? '#ca8a04'
                          : '#6b7280'
                  }
                  strokeWidth={isWinner ? 3 : isSelected || inTie ? 2.5 : 1}
                  strokeDasharray={inTie && !isWinner ? '6 3' : undefined}
                  vectorEffect="non-scaling-stroke"
                  style={{ transition: 'fill-opacity 120ms' }}
                />
              );
            })}

            {/* 边分类：等分线（邻接边）粗、矩形边界细 */}
            {model && model.cells.map((cell) =>
              cell.edges.map((edge, i) => {
                const x1 = fractionToNumber(edge.p1.x);
                const y1 = fractionToNumber(edge.p1.y);
                const x2 = fractionToNumber(edge.p2.x);
                const y2 = fractionToNumber(edge.p2.y);
                return (
                  <line
                    key={`${cell.id}-${i}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={edge.kind === 'bisector' ? '#312e81' : '#9ca3af'}
                    strokeWidth={edge.kind === 'bisector' ? 2.25 : 1}
                    strokeDasharray={edge.kind === 'bisector' ? undefined : '4 3'}
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                );
              }),
            )}

            {/* 查询点 */}
            {query && (
              <g pointerEvents="none">
                <line
                  x1={fractionToNumber(query.x)} y1={0}
                  x2={fractionToNumber(query.x)} y2={H}
                  stroke="#dc2626" strokeWidth={0.8} strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={0} y1={fractionToNumber(query.y)}
                  x2={W} y2={fractionToNumber(query.y)}
                  stroke="#dc2626" strokeWidth={0.8} strokeDasharray="5 4"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={fractionToNumber(query.x)}
                  cy={fractionToNumber(query.y)}
                  r={5} fill="#dc2626" stroke="#fff" strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}

            {/* 站点（可拖动） */}
            {sites.map((s) => (
              <g key={s.id}>
                <circle
                  cx={s.x} cy={s.y}
                  r={dragId === s.id ? 9 : 7}
                  className="site-marker"
                  fill={s.id === winnerId ? '#4338ca' : s.id === selectedId ? '#111827' : '#0f172a'}
                  stroke="#fff" strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: dragId === s.id ? 'grabbing' : 'grab' }}
                  onPointerDown={(e) => onMarkerPointerDown(e, s.id)}
                />
                <text
                  x={s.x + 10} y={s.y - 8}
                  className="site-label" pointerEvents="none"
                >
                  {s.id} ({s.x},{s.y})
                </text>
              </g>
            ))}
          </svg>
          <p className="canvas-help">
            拖站点改变单元（整数坐标，禁止重合）· 点击空白处查询最近站点与距离证据
          </p>
        </div>

        <aside className="side">
          {queryResult && (
            <section className="panel query-panel">
              <h2>边界查询</h2>
              <p className="query-point">
                查询点：<code>{pointToString(queryResult.point)}</code>
                <br />
                <span className="muted">
                  ≈ ({fractionToRounded(queryResult.point.x, 4)},{' '}
                  {fractionToRounded(queryResult.point.y, 4)})
                </span>
              </p>
              <p className="winner">
                命中站点：<strong>{queryResult.winnerId}</strong>
                {queryResult.tied && (
                  <span className="tie-badge">
                    等距决胜：{queryResult.ties.join(' = ')}（按 id 字节序取胜）
                  </span>
                )}
              </p>
              <table className="evidence">
                <thead>
                  <tr>
                    <th>站点</th>
                    <th>精确平方距离 d²</th>
                    <th>≈</th>
                  </tr>
                </thead>
                <tbody>
                  {queryResult.entries.map((e) => (
                    <tr
                      key={e.id}
                      className={e.id === queryResult.winnerId ? 'row-winner' : ''}
                    >
                      <td>{e.id}</td>
                      <td className="mono">{fractionToString(e.d2)}</td>
                      <td className="mono muted">{fractionToRounded(e.d2, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="panel">
            <h2>站点与单元（{sites.length}）</h2>
            {model && (
              <p className="muted">
                单元面积合计：
                <code>
                  {fractionToString(
                    model.cells.reduce((acc, c) => fadd(acc, c.area), frac(0n)),
                  )}
                </code>
                {' '}/ 区域面积 <code>{width * height}</code>
              </p>
            )}
            {!model && <p className="muted">配置合法后显示计算结果。</p>}
            <ul className="cell-list">
              {sites.map((s, i) => {
                const cell = cellById.get(s.id);
                const active = s.id === selectedId || s.id === winnerId;
                return (
                  <li key={s.id} className={active ? 'cell-active' : ''}>
                    <div className="cell-head">
                      <span className="swatch" style={{ background: colorFor(i) }} />
                      <button
                        className="cell-title"
                        onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                      >
                        {s.id} @ ({s.x}, {s.y})
                      </button>
                      <button
                        className="del-btn"
                        onClick={() => removeSite(s.id)}
                        disabled={sites.length <= 2}
                        title="删除站点"
                      >
                        ✕
                      </button>
                    </div>
                    {cell && (
                      <div className="cell-body">
                        <p>精确面积：<code>{fracText(cell.area, 3)}</code></p>
                        <p>
                          邻接站点（共享正长度边段）：
                          {cell.neighbors.length === 0 && <span className="muted">无</span>}
                          {cell.neighbors.map((n) => (
                            <button
                              key={n}
                              className="neighbor-chip"
                              onClick={() => setSelectedId(n)}
                            >
                              {n}
                            </button>
                          ))}
                        </p>
                        {active && (
                          <>
                            <p>顶点（精确分数，共 {cell.polygon.length} 个）：</p>
                            <ol className="vertex-list">
                              {cell.polygon.map((p, vi) => (
                                <li key={vi} className="mono">
                                  V{vi} {pointToString(p)}{' '}
                                  <span className="muted">≈ ({fractionToRounded(p.x, 3)}, {fractionToRounded(p.y, 3)})</span>
                                </li>
                              ))}
                            </ol>
                            <p>邻接边 / 边界边证据：</p>
                            <ul className="edge-list">
                              {cell.edges.map((edge, ei) => {
                                const v1 = cell.polygon.findIndex(
                                  (p) => p === edge.p1,
                                );
                                const v2 = cell.polygon.findIndex(
                                  (p) => p === edge.p2,
                                );
                                return (
                                  <li key={ei} className="mono">
                                    {edge.kind === 'bisector' ? (
                                      <span className="tag tag-bis">等分线 ↔ {edge.neighbor}</span>
                                    ) : (
                                      <span className="tag tag-bnd">矩形边界</span>
                                    )}{' '}
                                    V{v1} {pointToString(edge.p1)} → V{v2}{' '}
                                    {pointToString(edge.p2)}
                                  </li>
                                );
                              })}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </main>

      <footer className="footer">
        全部裁切、面积、距离均以 bigint 有理数计算；SVG 仅负责绘制，缩放不改变归属。
      </footer>
    </div>
  );
}
