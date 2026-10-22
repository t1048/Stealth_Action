/**
 * mapgen-facility.js - 設計型レイアウト「facility」(部屋と廊下の施設)の生成
 *
 * 手順の概要(詳細は docs/05-algorithms.md §2.5):
 *   1. マップをグリッド状のセルに分け、セルごとに1部屋を置く(矩形配置)
 *   2. 部屋を節点、廊下を辺とするグラフを作る(全域木 + ループ辺)。スタート/ゴールは遠いセル
 *   3. 部屋の種類(start/hub/corridor/side/goal)で部屋の形を決め、廊下(直線/Z字)を掘る
 *   4. 柱・仕切り壁、アルコーブ、廊下の角を作り、hideSpots を登録。メインルート上に間隔を保証する
 *   5. enemyRoutes / cameraSpots / itemSpots を設計して返す
 * map[y][x] を直接書き換える(既存レイアウトと同じ流儀)。
 * 依存(実行時に解決される): map.js の lineIntersectsWall / validateConnectivity、state.js の定数。
 */

// ---- 調整つまみ(PMが決める値) ----
const FACILITY_LAYOUT_LEVEL = 3;        // 出現開始レベル(COLS>=14, ROWS>=12)
const FACILITY_LAYOUT_WEIGHT = 3;       // chooseLayoutType での重み
const FACILITY_CELL_W = 7;              // 1セルの目標幅(タイル)。大きいほど部屋数が減る
const FACILITY_CELL_H = 6;              // 1セルの目標高さ(タイル)
const FACILITY_MAX_GRID_COLS = 6;       // セルの最大列数
const FACILITY_MAX_GRID_ROWS = 5;       // セルの最大行数
const FACILITY_LOOP_RATIO = 0.35;       // 全域木に加えるループ辺の割合(残り候補辺に対して)
const FACILITY_Z_CORRIDOR_CHANCE = 0.55; // 廊下をZ字(角あり)にする確率(隙間が3タイル以上のとき)
const FACILITY_PILLAR_SKIP_CHANCE = 0.15; // 柱の格子点を間引く確率
const FACILITY_PARTITION_CHANCE = 0.5;  // 柱を2タイルの仕切り壁にする確率
const FACILITY_HIDE_MAX_GAP = 10;       // メインルート上の「隠れ場所のない区間」の上限(タイル)
const FACILITY_HIDE_REACH = 2;          // ルートから何タイル以内の隠れ場所を「ルート上」とみなすか
const FACILITY_ENEMY_SAFE_TILES = 4;    // プレイヤー初期位置からこの距離内には巡回点を置かない
const FACILITY_CAMERA_MIN_SEP = 5;      // カメラ同士の最小間隔(タイル)
const FACILITY_MAX_ATTEMPTS = 40;       // facility 内部の生成やり直し回数

const FACILITY_DIRS = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }
];

let facilityRng = null;          // 検証用: setFacilityRng(fn) で乱数を差し替える
let facilityLastLayout = null;   // 検証用: 直近の生成結果

// ---- 乱数(facility 内の乱数呼び出しはすべてここを通す) ----
function setFacilityRng(fn) { facilityRng = (typeof fn === "function") ? fn : null; }
function facilityRand() { return facilityRng ? facilityRng() : Math.random(); }
function facilityInt(lo, hi) { return lo + Math.floor(facilityRand() * (hi - lo + 1)); }
function facilityChance(p) { return facilityRand() < p; }
function facilityPick(arr) { return arr[Math.floor(facilityRand() * arr.length)]; }
function facilityShuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(facilityRand() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
}

// ---- 小さな補助 ----
function facilityKey(x, y) { return y * COLS + x; }
function facilityInBounds(x, y) { return x >= 1 && x <= COLS - 2 && y >= 1 && y <= ROWS - 2; }
function facilityIsFloor(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS && map[y][x] !== TILE_WALL;
}
function facilityInRoom(room, x, y) {
    return x >= room.x0 && x <= room.x1 && y >= room.y0 && y <= room.y1;
}
function facilityCenterPx(t) { return { x: t.x * TILE_SIZE + TILE_SIZE / 2, y: t.y * TILE_SIZE + TILE_SIZE / 2 }; }
function facilityLos(a, b) {
    const pa = facilityCenterPx(a), pb = facilityCenterPx(b);
    return !lineIntersectsWall(pa.x, pa.y, pb.x, pb.y);
}
function facilityClearMap() {
    for (let y = 0; y < ROWS; y++) {
        if (!map[y]) map[y] = [];
        for (let x = 0; x < COLS; x++) map[y][x] = TILE_WALL;
    }
}

/**
 * 床タイル間の最短歩行経路(4方向BFS)。近傍の順序は FACILITY_DIRS で固定(同じ入力なら同じ経路)。
 * blocked: 通行不可にするタイルキー(facilityKey)の Set。到達できなければ null。
 */
function facilityShortestPath(sx, sy, gx, gy, blocked) {
    const total = COLS * ROWS;
    if (!facilityIsFloor(sx, sy) || !facilityIsFloor(gx, gy)) return null;
    const prev = new Int32Array(total).fill(-2);
    const queue = new Int32Array(total);
    const s = sy * COLS + sx, g = gy * COLS + gx;
    let qh = 0, qt = 0;
    queue[qt++] = s;
    prev[s] = -1;
    while (qh < qt) {
        const cur = queue[qh++];
        if (cur === g) break;
        const cx = cur % COLS, cy = (cur - cx) / COLS;
        for (const d of FACILITY_DIRS) {
            const nx = cx + d.dx, ny = cy + d.dy;
            if (!facilityIsFloor(nx, ny)) continue;
            const k = ny * COLS + nx;
            if (prev[k] !== -2) continue;
            if (blocked && blocked.has(k)) continue;
            prev[k] = cur;
            queue[qt++] = k;
        }
    }
    if (prev[g] === -2) return null;
    const path = [];
    for (let k = g; k !== -1; k = prev[k]) {
        const x = k % COLS;
        path.push({ x, y: (k - x) / COLS });
    }
    return path.reverse();
}

// ---- セル分割 ----
function facilitySplit(total, n, minSize) {
    const base = Math.floor(total / n);
    let rem = total - base * n;
    const sizes = [];
    for (let i = 0; i < n; i++) {
        sizes.push(base + (rem > 0 ? 1 : 0));
        if (rem > 0) rem--;
    }
    facilityShuffle(sizes);
    const lo = Math.max(minSize, base - 1), hi = base + 2;
    for (let k = 0; k < n * 2; k++) {
        const i = facilityInt(0, n - 2);
        const d = facilityChance(0.5) ? 1 : -1;
        if (sizes[i] + d >= lo && sizes[i] + d <= hi && sizes[i + 1] - d >= lo && sizes[i + 1] - d <= hi) {
            sizes[i] += d;
            sizes[i + 1] -= d;
        }
    }
    return sizes;
}

// ---- 部屋グラフ ----
function facilityGraphPath(N, edges, s, g, skipIdx) {
    const adj = Array.from({ length: N }, () => []);
    edges.forEach((e, idx) => {
        if (idx === skipIdx) return;
        adj[e.a].push({ to: e.b, idx });
        adj[e.b].push({ to: e.a, idx });
    });
    const prev = new Array(N).fill(-2);
    const prevEdge = new Array(N).fill(-1);
    const queue = [s];
    prev[s] = -1;
    for (let qi = 0; qi < queue.length; qi++) {
        const u = queue[qi];
        if (u === g) break;
        for (const nb of adj[u]) {
            if (prev[nb.to] !== -2) continue;
            prev[nb.to] = u;
            prevEdge[nb.to] = nb.idx;
            queue.push(nb.to);
        }
    }
    if (prev[g] === -2) return null;
    const nodes = [], eds = [];
    for (let v = g; v !== -1; v = prev[v]) {
        nodes.push(v);
        if (prevEdge[v] >= 0) eds.push(prevEdge[v]);
    }
    return { nodes: nodes.reverse(), edges: eds.reverse() };
}

/** メインルート上のどれか1辺を外してもスタート→ゴールが繋がる(=迂回できる)ようにする。 */
function facilityEnsureBypass(N, edges, nC, nR, s, g) {
    const idOf = (i, j) => j * nC + i;
    const hasEdge = (x, y) => edges.some(e => (e.a === x && e.b === y) || (e.a === y && e.b === x));
    for (let iter = 0; iter < 6; iter++) {
        const P = facilityGraphPath(N, edges, s, g, -1);
        if (!P) return false;
        if (P.edges.some(ei => facilityGraphPath(N, edges, s, g, ei))) return true;

        let best = null;
        for (const ei of P.edges) {
            const e = edges[ei];
            const ai = e.a % nC, aj = Math.floor(e.a / nC), bi = e.b % nC, bj = Math.floor(e.b / nC);
            const perps = e.orient === "H" ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
            for (const [px, py] of perps) {
                const ai2 = ai + px, aj2 = aj + py, bi2 = bi + px, bj2 = bj + py;
                if (ai2 < 0 || ai2 >= nC || aj2 < 0 || aj2 >= nR || bi2 < 0 || bi2 >= nC || bj2 < 0 || bj2 >= nR) continue;
                const a2 = idOf(ai2, aj2), b2 = idOf(bi2, bj2);
                const missing = [[e.a, a2], [a2, b2], [b2, e.b]].filter(([x, y]) => !hasEdge(x, y));
                if (missing.length === 0) continue;
                if (!best || missing.length < best.missing.length || (missing.length === best.missing.length && facilityChance(0.5))) {
                    best = { missing };
                }
            }
        }
        if (!best) return false;
        for (const [x, y] of best.missing) {
            const a = Math.min(x, y), b = Math.max(x, y);
            edges.push({ a, b, orient: (b - a === 1 && Math.floor(a / nC) === Math.floor(b / nC)) ? "H" : "V" });
        }
    }
    return false;
}

// ---- 部屋の矩形 ----
function facilityMakeRoom(id, cell, type, orients, nC, nR) {
    const ex0 = cell.x0 + (cell.i === 0 ? 0 : 1);
    const ex1 = cell.x0 + cell.w - 1 - (cell.i === nC - 1 ? 0 : 1);
    const ey0 = cell.y0 + (cell.j === 0 ? 0 : 1);
    const ey1 = cell.y0 + cell.h - 1 - (cell.j === nR - 1 ? 0 : 1);
    const extW = ex1 - ex0 + 1, extH = ey1 - ey0 + 1;
    const xs = cell.x0 + Math.floor(cell.w / 2);   // 隣の部屋と廊下で繋ぐための「軸」(必ず部屋に含める)
    const ys = cell.y0 + Math.floor(cell.h / 2);

    let w, h;
    if (type === "hub") {
        w = Math.max(Math.min(5, extW), extW - facilityInt(0, 1));
        h = Math.max(Math.min(5, extH), extH - facilityInt(0, 1));
    } else if (type === "start" || type === "goal") {
        w = Math.max(Math.min(4, extW), extW - facilityInt(0, 2));
        h = Math.max(Math.min(4, extH), extH - facilityInt(0, 2));
    } else if (type === "side") {
        w = Math.min(extW, facilityInt(3, 4));
        h = Math.min(extH, facilityInt(3, 4));
    } else {
        const onlyH = orients.has("H") && !orients.has("V");
        const onlyV = orients.has("V") && !orients.has("H");
        if (onlyH) { w = extW; h = Math.min(extH, 2); }
        else if (onlyV) { w = Math.min(extW, 2); h = extH; }
        else {
            w = Math.max(Math.min(3, extW), extW - facilityInt(1, 2));
            h = Math.max(Math.min(3, extH), extH - facilityInt(1, 2));
        }
    }
    const x0 = facilityInt(Math.max(ex0, xs - w + 1), Math.min(xs, ex1 - w + 1));
    const y0 = facilityInt(Math.max(ey0, ys - h + 1), Math.min(ys, ey1 - h + 1));
    return {
        id, type, cell,
        x0, y0, x1: x0 + w - 1, y1: y0 + h - 1, w, h,
        x: x0, y: y0,
        degree: 0, onMain: false,
        doors: [], pillars: []
    };
}

// ---- 廊下 ----
/** 部屋A(左/上)と部屋B(右/下)を結ぶ廊下の候補。skeleton は必ず衝突しない直線(軸上)。 */
function facilityCorridorPaths(A, B, orient, cell) {
    const H = orient === "H";
    const g0 = (H ? A.x1 : A.y1) + 1;
    const g1 = (H ? B.x0 : B.y0) - 1;
    const aV0 = H ? A.y0 : A.x0, aV1 = H ? A.y1 : A.x1;
    const bV0 = H ? B.y0 : B.x0, bV1 = H ? B.y1 : B.x1;
    const oV0 = Math.max(aV0, bV0), oV1 = Math.min(aV1, bV1);
    const spine = H ? cell.y0 + Math.floor(cell.h / 2) : cell.x0 + Math.floor(cell.w / 2);
    const tile = (u, v) => H ? { x: u, y: v } : { x: v, y: u };
    const straight = (v) => {
        const p = [];
        for (let u = g0; u <= g1; u++) p.push(tile(u, v));
        return p;
    };

    const skeleton = straight(spine);
    const zs = [], ss = [];
    if (g1 - g0 + 1 >= 3) {
        for (let t = 0; t < 4; t++) {
            const va = facilityInt(aV0, aV1), vb = facilityInt(bV0, bV1);
            if (va === vb) continue;
            const mu = facilityInt(g0 + 1, g1 - 1);
            const p = [];
            for (let u = g0; u <= mu; u++) p.push(tile(u, va));
            const step = vb > va ? 1 : -1;
            for (let v = va + step; v !== vb; v += step) p.push(tile(mu, v));
            for (let u = mu; u <= g1; u++) p.push(tile(u, vb));
            zs.push(p);
        }
    }
    for (let t = 0; t < 2; t++) ss.push(straight(facilityInt(oV0, oV1)));
    const alts = facilityChance(FACILITY_Z_CORRIDOR_CHANCE) ? zs.concat(ss) : ss.concat(zs);
    return { skeleton, alts };
}

function facilityPathConflicts(path, edgeIdx, owner) {
    for (const t of path) {
        let k = owner.get(facilityKey(t.x, t.y));
        if (k !== undefined && k !== edgeIdx) return true;
        for (const d of FACILITY_DIRS) {
            const nx = t.x + d.dx, ny = t.y + d.dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            k = owner.get(facilityKey(nx, ny));
            if (k !== undefined && k !== edgeIdx) return true;
        }
    }
    return false;
}

function facilityCorners(path) {
    const corners = [];
    for (let i = 1; i < path.length - 1; i++) {
        const a = path[i - 1], b = path[i], c = path[i + 1];
        if ((b.x - a.x) !== (c.x - b.x) || (b.y - a.y) !== (c.y - b.y)) corners.push(b);
    }
    return corners;
}

// ---- 隠れ場所 ----
/** 壁タイル w(= p + d)を1タイルのアルコーブ(凹み)として掘れるなら掘って座標を返す。 */
function facilityTryAlcove(px, py, dx, dy) {
    const wx = px + dx, wy = py + dy;
    if (!facilityInBounds(wx, wy) || map[wy][wx] !== TILE_WALL) return null;
    const tx = dy !== 0 ? 1 : 0, ty = dx !== 0 ? 1 : 0;
    const around = [
        [wx + dx, wy + dy], [wx + tx, wy + ty], [wx - tx, wy - ty],
        [wx + dx + tx, wy + dy + ty], [wx + dx - tx, wy + dy - ty]
    ];
    for (const [nx, ny] of around) {
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return null;
        if (map[ny][nx] !== TILE_WALL) return null;
    }
    map[wy][wx] = TILE_FLOOR;
    return { x: wx, y: wy };
}

/** ルート上の隠れ場所の間隔。端(スタート/ゴール)は隠れ場所があるものとして数える。 */
function facilityRouteGap(route, hideKeys) {
    const n = route.length;
    const marks = new Uint8Array(n);
    marks[0] = 1;
    marks[n - 1] = 1;
    for (let i = 0; i < n; i++) {
        if (marks[i]) continue;
        const t = route[i];
        let found = false;
        for (let dy = -FACILITY_HIDE_REACH; dy <= FACILITY_HIDE_REACH && !found; dy++) {
            for (let dx = -FACILITY_HIDE_REACH; dx <= FACILITY_HIDE_REACH; dx++) {
                const x = t.x + dx, y = t.y + dy;
                if (x < 0 || y < 0 || x >= COLS || y >= ROWS) continue;
                if (hideKeys.has(facilityKey(x, y))) { found = true; break; }
            }
        }
        if (found) marks[i] = 1;
    }
    let last = 0, max = 0, ma = 0, mb = 0;
    for (let i = 1; i < n; i++) {
        if (!marks[i]) continue;
        if (i - last > max) { max = i - last; ma = last; mb = i; }
        last = i;
    }
    return { max, a: ma, b: mb };
}

// ---- 巡回ルート ----
function facilityLegClear(a, b) {
    if (a.x !== b.x && a.y !== b.y) return false;
    const sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    let x = a.x, y = a.y;
    for (let guard = 0; guard < 400; guard++) {
        if (!facilityIsFloor(x, y)) return false;
        if (x === b.x && y === b.y) return true;
        x += sx;
        y += sy;
    }
    return false;
}

/** 1周するルート(部屋の外周)。w,h が小さいときは長辺方向の往復にする。 */
function facilityRoomRoute(room) {
    if (room.w >= 4 && room.h >= 4) {
        const corners = [
            { x: room.x0, y: room.y0 }, { x: room.x1, y: room.y0 },
            { x: room.x1, y: room.y1 }, { x: room.x0, y: room.y1 }
        ];
        const k = facilityInt(0, 3);
        let tiles = corners.slice(k).concat(corners.slice(0, k));
        if (facilityChance(0.5)) tiles = [tiles[0]].concat(tiles.slice(1).reverse());
        return { loop: true, tiles };
    }
    const ys = room.cell.y0 + Math.floor(room.cell.h / 2);
    const xs = room.cell.x0 + Math.floor(room.cell.w / 2);
    if (room.w >= room.h) {
        const y = Math.min(room.y1, Math.max(room.y0, ys));
        return { loop: false, tiles: [{ x: room.x0, y }, { x: room.x1, y }] };
    }
    const x = Math.min(room.x1, Math.max(room.x0, xs));
    return { loop: false, tiles: [{ x, y: room.y0 }, { x, y: room.y1 }] };
}

/** 端点列 L を往復する巡回列に展開する(巡回は最後→最初に戻るので折り返しを含める)。 */
function facilityPingPong(L) {
    if (L.length <= 2) return L.slice();
    return L.concat(L.slice(1, -1).reverse());
}

function facilityRouteLengthTiles(tiles) {
    let d = 0;
    for (let i = 0; i < tiles.length; i++) {
        const a = tiles[i], b = tiles[(i + 1) % tiles.length];
        d += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }
    return d;
}

// ---- 本体 ----
function createFacilityLayout() {
    let last = null;
    for (let attempt = 0; attempt < FACILITY_MAX_ATTEMPTS; attempt++) {
        facilityClearMap();
        const info = facilityBuild(attempt);
        if (!info) continue;
        info.attempts = attempt + 1;
        last = info;
        if (info.valid) break;
    }
    if (!last || !last.valid) {
        // 内部でのやり直しが尽きた場合は最低限の通路を返す(createLevel 側のリトライ機構に任せる)
        const reason = last ? last.failReason : "unbuildable";
        last = facilityMinimalLayout();
        last.failReason = reason;
    }
    facilityLastLayout = last;
    return last;
}

/** どうしても組めない極小マップ用: 部屋2つを廊下で結ぶだけ(接続性のみ保証)。 */
function facilityMinimalLayout() {
    facilityClearMap();
    const tiles = [];
    const y = Math.floor(ROWS / 2);
    for (let x = 1; x <= COLS - 2; x++) {
        map[y][x] = TILE_FLOOR;
        tiles.push({ x, y });
    }
    return {
        floorTiles: tiles, playerStartTile: tiles[0], goalTile: tiles[tiles.length - 1],
        rooms: [], hideSpots: [], enemyRoutes: [], cameraSpots: [], itemSpots: [],
        corridors: [], designed: true, valid: false, failReason: "minimal", attempts: FACILITY_MAX_ATTEMPTS,
        mainRoute: tiles.slice(), bypassRoute: []
    };
}

function facilityBuild(attempt) {
    const W = COLS - 2, H = ROWS - 2;
    if (W < 8 || H < 6) return null;
    const fail = (reason) => ({ valid: false, failReason: reason, floorTiles: [], designed: true,
        playerStartTile: { x: 1, y: 1 }, goalTile: { x: 1, y: 1 }, rooms: [], hideSpots: [], enemyRoutes: [],
        cameraSpots: [], itemSpots: [], corridors: [] });

    // 1. セル分割(後半のやり直しでは部屋数を減らす)
    let nC = Math.max(2, Math.min(FACILITY_MAX_GRID_COLS, Math.floor(W / FACILITY_CELL_W)));
    let nR = Math.max(2, Math.min(FACILITY_MAX_GRID_ROWS, Math.floor(H / FACILITY_CELL_H)));
    if (attempt >= FACILITY_MAX_ATTEMPTS / 2) {
        nC = Math.max(2, nC - 1);
        nR = Math.max(2, nR - 1);
    }
    while (nC > 2 && Math.floor(W / nC) < 4) nC--;
    while (nR > 2 && Math.floor(H / nR) < 3) nR--;
    const colW = facilitySplit(W, nC, 4), rowH = facilitySplit(H, nR, 3);
    const cells = [];
    let cy = 1;
    for (let j = 0; j < nR; j++) {
        let cx = 1;
        for (let i = 0; i < nC; i++) {
            cells.push({ i, j, x0: cx, y0: cy, w: colW[i], h: rowH[j] });
            cx += colW[i];
        }
        cy += rowH[j];
    }
    const N = nC * nR;
    const idOf = (i, j) => j * nC + i;

    // 2. 部屋グラフ: スタート(角のセル)・ゴール(遠いセル)・全域木・ループ辺
    const sc = facilityPick([[0, 0], [nC - 1, 0], [0, nR - 1], [nC - 1, nR - 1]]);
    const startId = idOf(sc[0], sc[1]);
    const gridDist = (id) => Math.abs((id % nC) - sc[0]) + Math.abs(Math.floor(id / nC) - sc[1]);
    let dmax = 0;
    for (let id = 0; id < N; id++) dmax = Math.max(dmax, gridDist(id));
    const minD = dmax <= 2 ? dmax : dmax - 1;
    const goalId = facilityPick(cells.map((c, id) => id).filter(id => gridDist(id) >= minD));

    const candEdges = [];
    for (let j = 0; j < nR; j++) {
        for (let i = 0; i < nC; i++) {
            if (i < nC - 1) candEdges.push({ a: idOf(i, j), b: idOf(i + 1, j), orient: "H" });
            if (j < nR - 1) candEdges.push({ a: idOf(i, j), b: idOf(i, j + 1), orient: "V" });
        }
    }
    facilityShuffle(candEdges);
    const uf = Array.from({ length: N }, (_, i) => i);
    const find = (x) => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    const edges = [], rest = [];
    for (const e of candEdges) {
        const ra = find(e.a), rb = find(e.b);
        if (ra !== rb) { uf[ra] = rb; edges.push(e); } else rest.push(e);
    }
    const loopCount = Math.max(1, Math.round(rest.length * FACILITY_LOOP_RATIO));
    for (let k = 0; k < loopCount && k < rest.length; k++) edges.push(rest[k]);
    if (!facilityEnsureBypass(N, edges, nC, nR, startId, goalId)) return fail("no-bypass-graph");

    // 3. 部屋の種類と矩形
    const orients = Array.from({ length: N }, () => new Set());
    const degree = new Array(N).fill(0);
    edges.forEach(e => {
        orients[e.a].add(e.orient); orients[e.b].add(e.orient);
        degree[e.a]++; degree[e.b]++;
    });
    const rooms = cells.map((cell, id) => {
        let type;
        if (id === startId) type = "start";
        else if (id === goalId) type = "goal";
        else if (degree[id] >= 3) type = "hub";
        else if (degree[id] <= 1) type = "side";
        else type = "corridor";
        const room = facilityMakeRoom(id, cell, type, orients[id], nC, nR);
        room.degree = degree[id];
        return room;
    });
    const startRoom = rooms[startId], goalRoom = rooms[goalId];
    rooms.forEach(r => {
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) map[y][x] = TILE_FLOOR;
    });

    // 4. 廊下: まず軸上の直線で予約し、衝突しない範囲でZ字/ずらし直線に置き換える
    const cand = edges.map((e, idx) => facilityCorridorPaths(rooms[e.a], rooms[e.b], e.orient, cells[e.a]));
    const owner = new Map();
    const current = cand.map(c => c.skeleton);
    const reserve = (idx, path) => path.forEach(t => owner.set(facilityKey(t.x, t.y), idx));
    const release = (idx, path) => path.forEach(t => { if (owner.get(facilityKey(t.x, t.y)) === idx) owner.delete(facilityKey(t.x, t.y)); });
    current.forEach((p, idx) => reserve(idx, p));
    const order = facilityShuffle(edges.map((e, idx) => idx));
    for (const idx of order) {
        for (const alt of cand[idx].alts) {
            if (facilityPathConflicts(alt, idx, owner)) continue;
            release(idx, current[idx]);
            current[idx] = alt;
            reserve(idx, alt);
            break;
        }
    }
    const corridors = edges.map((e, idx) => {
        const tiles = current[idx];
        const H = e.orient === "H";
        const f = tiles[0], l = tiles[tiles.length - 1];
        const ringA = H ? { x: f.x - 1, y: f.y } : { x: f.x, y: f.y - 1 };
        const ringB = H ? { x: l.x + 1, y: l.y } : { x: l.x, y: l.y + 1 };
        tiles.forEach(t => { map[t.y][t.x] = TILE_FLOOR; });
        rooms[e.a].doors.push({ x: ringA.x, y: ringA.y, cx: f.x, cy: f.y });
        rooms[e.b].doors.push({ x: ringB.x, y: ringB.y, cx: l.x, cy: l.y });
        return { idx, a: e.a, b: e.b, orient: e.orient, tiles, corners: facilityCorners(tiles),
            z: facilityCorners(tiles).length > 0, ringA, ringB };
    });

    // 5. 隠れ場所の登録(柱・廊下の角・アルコーブ)
    const hideSpots = [];
    const hideKeys = new Set();
    const addHide = (x, y, kind) => {
        const k = facilityKey(x, y);
        if (hideKeys.has(k)) return false;
        hideKeys.add(k);
        hideSpots.push({ x, y, kind });
        return true;
    };

    // 柱の影: 部屋の出入口から見て柱の陰になる隣接タイル
    const registerPillarShadows = (room, px, py) => {
        const found = [];
        for (const d of FACILITY_DIRS) {
            const t = { x: px + d.dx, y: py + d.dy };
            if (!facilityIsFloor(t.x, t.y) || !facilityInRoom(room, t.x, t.y)) continue;
            let blocked = 0;
            for (const door of room.doors) if (!facilityLos(door, t)) blocked++;
            if (blocked >= 1) found.push({ t, blocked });
        }
        found.sort((a, b) => b.blocked - a.blocked);
        let added = 0;
        for (const f of found.slice(0, 2)) if (addHide(f.t.x, f.t.y, "pillar")) added++;
        return added;
    };

    for (const room of rooms) {
        if (!(room.type === "start" || room.type === "hub" || room.type === "goal")) continue;
        if (room.w < 5 || room.h < 5) continue;
        const lattice = (a, b) => {
            const len = b - a + 1, out = [];
            for (let p = a + Math.floor(((len - 1) % 4) / 2); p <= b; p += 4) out.push(p);
            return out;
        };
        const ax0 = room.x0 + 2, ax1 = room.x1 - 2, ay0 = room.y0 + 2, ay1 = room.y1 - 2;
        for (const py of lattice(ay0, ay1)) {
            for (const px of lattice(ax0, ax1)) {
                if (facilityChance(FACILITY_PILLAR_SKIP_CHANCE)) continue;
                const tiles = [{ x: px, y: py }];
                if (facilityChance(FACILITY_PARTITION_CHANCE)) {
                    const horizontal = facilityChance(0.5);
                    if (horizontal && px + 1 <= ax1) tiles.push({ x: px + 1, y: py });
                    else if (!horizontal && py + 1 <= ay1) tiles.push({ x: px, y: py + 1 });
                }
                tiles.forEach(t => { map[t.y][t.x] = TILE_WALL; room.pillars.push(t); });
            }
        }
        room.pillars.forEach(t => registerPillarShadows(room, t.x, t.y));
    }

    // 廊下の角(L字/Z字)と、廊下の途中のアルコーブ
    for (const c of corridors) {
        c.corners.forEach(t => addHide(t.x, t.y, "corner"));
        const n = c.tiles.length;
        if (n < 4) continue;
        const cornerKeys = new Set(c.corners.map(t => facilityKey(t.x, t.y)));
        const idxs = [];
        for (let i = 1; i < n - 1; i++) {
            const a = c.tiles[i - 1], b = c.tiles[i], d = c.tiles[i + 1];
            if (cornerKeys.has(facilityKey(b.x, b.y))) continue;
            if ((b.x - a.x) !== (d.x - b.x) || (b.y - a.y) !== (d.y - b.y)) continue;
            idxs.push(i);
        }
        idxs.sort((p, q) => Math.abs(p - n / 2) - Math.abs(q - n / 2));
        for (const i of idxs) {
            const b = c.tiles[i], a = c.tiles[i - 1];
            const horizontal = b.x !== a.x;
            const perps = facilityShuffle(horizontal ? [{ dx: 0, dy: 1 }, { dx: 0, dy: -1 }] : [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }]);
            let done = false;
            for (const d of perps) {
                const w = facilityTryAlcove(b.x, b.y, d.dx, d.dy);
                if (w) { addHide(w.x, w.y, "alcove"); done = true; break; }
            }
            if (done) break;
        }
    }

    // 6. スタート/ゴールのタイル(部屋の出入口から最も遠いタイル)
    const deepTile = (room, exclude) => {
        let best = null, bestScore = -1;
        for (let y = room.y0; y <= room.y1; y++) {
            for (let x = room.x0; x <= room.x1; x++) {
                if (!facilityIsFloor(x, y)) continue;
                if (exclude && exclude(x, y)) continue;
                let m = 1e9;
                for (const d of room.doors) m = Math.min(m, Math.abs(d.x - x) + Math.abs(d.y - y));
                const s = m + facilityRand() * 0.5;
                if (s > bestScore) { bestScore = s; best = { x, y }; }
            }
        }
        return best;
    };
    const playerStartTile = deepTile(startRoom);
    const goalTile = deepTile(goalRoom);
    if (!playerStartTile || !goalTile) return fail("no-start-goal");

    // 7. メインルート(最短歩行経路)と迂回ルート、隠れ場所の間隔を保証
    const routeA = () => facilityShortestPath(playerStartTile.x, playerStartTile.y, goalTile.x, goalTile.y, null);
    let A = routeA();
    if (!A) return fail("no-route");
    const mainCorridors = corridors.filter(c => c.tiles.some(t => A.some(a => a.x === t.x && a.y === t.y)));
    let bypassBlocked = null;
    let B = null;
    for (const c of facilityShuffle(mainCorridors.slice())) {
        const blocked = new Set(c.tiles.map(t => facilityKey(t.x, t.y)));
        const p = facilityShortestPath(playerStartTile.x, playerStartTile.y, goalTile.x, goalTile.y, blocked);
        if (p) { bypassBlocked = blocked; B = p; break; }
    }
    if (!B) return fail("no-bypass-tile");
    const routeB = () => facilityShortestPath(playerStartTile.x, playerStartTile.y, goalTile.x, goalTile.y, bypassBlocked);

    const routeSetOf = (route) => new Set(route.map(t => facilityKey(t.x, t.y)));
    const roomAt = (x, y) => rooms.find(r => facilityInRoom(r, x, y)) || null;

    const placeHideNear = (route, a, b) => {
        const mid = (a + b) >> 1;
        const idxs = [];
        for (let i = a + 1; i < b; i++) idxs.push(i);
        idxs.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
        for (const i of idxs) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const px = route[i].x + dx, py = route[i].y + dy;
                    if (!facilityIsFloor(px, py)) continue;
                    for (const d of facilityShuffle(FACILITY_DIRS.slice())) {
                        const w = facilityTryAlcove(px, py, d.dx, d.dy);
                        if (w) { addHide(w.x, w.y, "alcove"); return true; }
                    }
                }
            }
        }
        // アルコーブを掘れない区間(広間の中など)は、柱を1本立ててその影を隠れ場所にする
        const onRoute = routeSetOf(route);
        for (const i of idxs) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const px = route[i].x + dx, py = route[i].y + dy;
                    if (onRoute.has(facilityKey(px, py))) continue;
                    if ((px === playerStartTile.x && py === playerStartTile.y) || (px === goalTile.x && py === goalTile.y)) continue;
                    const room = roomAt(px, py);
                    if (!room) continue;
                    let open = true;
                    for (let ny = -1; ny <= 1 && open; ny++) {
                        for (let nx = -1; nx <= 1; nx++) {
                            if (!facilityIsFloor(px + nx, py + ny) || !facilityInRoom(room, px + nx, py + ny)) { open = false; break; }
                        }
                    }
                    if (!open) continue;
                    map[py][px] = TILE_WALL;
                    if (registerPillarShadows(room, px, py) > 0) {
                        room.pillars.push({ x: px, y: py });
                        return true;
                    }
                    map[py][px] = TILE_FLOOR;
                }
            }
        }
        return false;
    };

    let gapOk = false;
    for (let iter = 0; iter < 80; iter++) {
        A = routeA();
        B = routeB();
        if (!A || !B) return fail("route-lost");
        const gA = facilityRouteGap(A, hideKeys);
        if (gA.max > FACILITY_HIDE_MAX_GAP) {
            if (!placeHideNear(A, gA.a, gA.b)) break;
            continue;
        }
        const gB = facilityRouteGap(B, hideKeys);
        if (gB.max > FACILITY_HIDE_MAX_GAP) {
            if (!placeHideNear(B, gB.a, gB.b)) break;
            continue;
        }
        gapOk = true;
        break;
    }
    if (!gapOk) return fail("hide-gap");

    // 8. 検証
    const minLen = Math.min(COLS, ROWS) * 0.6;
    if (A.length - 1 < minLen) return fail("route-short");
    const minGoalPx = Math.min(COLS, ROWS) * TILE_SIZE * 0.6;
    const startPx = facilityCenterPx(playerStartTile), goalPx = facilityCenterPx(goalTile);
    if (dist(startPx.x, startPx.y, goalPx.x, goalPx.y) < minGoalPx) return fail("goal-near");
    if (!validateConnectivity(playerStartTile, [goalTile])) return fail("connectivity");

    // 9. 巡回ルート・カメラ・アイテムの設計
    const mainRooms = new Set();
    A.forEach(t => { const r = roomAt(t.x, t.y); if (r) mainRooms.add(r.id); });
    rooms.forEach(r => { r.onMain = mainRooms.has(r.id); });
    const mainRouteSet = routeSetOf(A);
    const corridorOnMain = (c) => c.tiles.some(t => mainRouteSet.has(facilityKey(t.x, t.y)));

    const enemyRoutes = [];
    const startTilePx = facilityCenterPx(playerStartTile);
    const safePx = FACILITY_ENEMY_SAFE_TILES * TILE_SIZE;
    const addRoute = (kind, priority, tiles, loop, ref) => {
        if (tiles.length < 2) return;
        for (let i = 0; i < tiles.length; i++) {
            const a = tiles[i], b = tiles[(i + 1) % tiles.length];
            if (!facilityLegClear(a, b)) return;
            if (facilityInRoom(startRoom, a.x, a.y)) return;
            const p = facilityCenterPx(a);
            if (dist(p.x, p.y, startTilePx.x, startTilePx.y) < safePx) return;
        }
        if (facilityRouteLengthTiles(tiles) < 4) return;
        enemyRoutes.push({ kind, priority, loop, tiles: tiles.map(t => ({ x: t.x, y: t.y })), ref });
    };

    const goalRoute = facilityRoomRoute(goalRoom);
    addRoute("goalGuard", 1, goalRoute.loop ? goalRoute.tiles : facilityPingPong(goalRoute.tiles), goalRoute.loop, goalId);
    for (const room of rooms) {
        if (room.type === "start" || room.type === "goal" || room.type === "side") continue;
        const r = facilityRoomRoute(room);
        const kind = room.type === "hub" ? "hubLoop" : "hall";
        addRoute(kind, room.onMain ? 2 : 3, r.loop ? r.tiles : facilityPingPong(r.tiles), r.loop, room.id);
    }
    for (const c of corridors) {
        const first = c.tiles[0], last = c.tiles[c.tiles.length - 1];
        const inward = (ring, edge) => ({ x: ring.x + (ring.x - edge.x), y: ring.y + (ring.y - edge.y) });
        const aRoom = rooms[c.a], bRoom = rooms[c.b];
        const endA = aRoom.type === "start" ? first : (() => {
            const t = inward(c.ringA, first);
            return facilityInRoom(aRoom, t.x, t.y) ? t : c.ringA;
        })();
        const endB = bRoom.type === "start" ? last : (() => {
            const t = inward(c.ringB, last);
            return facilityInRoom(bRoom, t.x, t.y) ? t : c.ringB;
        })();
        const L = [endA].concat(c.corners, [endB]);
        const toGoal = c.a === goalId || c.b === goalId;
        const priority = corridorOnMain(c) ? (toGoal ? 1 : 2) : 3;
        addRoute("corridor", priority, facilityPingPong(L), false, c.idx);
    }
    facilityShuffle(enemyRoutes);
    enemyRoutes.sort((p, q) => p.priority - q.priority);

    // カメラ: 主要ルートと出入口を見渡せる壁際のタイル
    const cameraSpots = facilityPlanCameras(rooms, corridors, A, B, hideKeys, playerStartTile, goalTile);

    // アイテム: 行き止まりの小部屋・サブルートを優先。スタート部屋とゴール付近には置かない
    const itemSpots = facilityPlanItems(rooms, goalTile, startRoom, goalRoom);

    const floorTiles = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (map[y][x] !== TILE_WALL) floorTiles.push({ x, y });

    return {
        valid: true, failReason: null, designed: true,
        floorTiles, playerStartTile, goalTile,
        rooms: rooms.map(r => Object.assign({}, r, { cell: undefined })),
        corridors: corridors.map(c => ({ idx: c.idx, a: c.a, b: c.b, orient: c.orient, tiles: c.tiles, corners: c.corners, z: c.z, onMain: corridorOnMain(c) })),
        hideSpots, enemyRoutes, cameraSpots, itemSpots,
        mainRoute: A, bypassRoute: B, grid: { cols: nC, rows: nR }, startId, goalId
    };
}

function facilityPlanCameras(rooms, corridors, A, B, hideKeys, startTile, goalTile) {
    const targets = new Map();
    A.concat(B).forEach(t => targets.set(facilityKey(t.x, t.y), t));
    const doorKeys = new Set();
    rooms.forEach(r => r.doors.forEach(d => doorKeys.add(facilityKey(d.x, d.y))));
    const wallDirs = [
        { dx: 0, dy: -1, label: "TOP" }, { dx: 0, dy: 1, label: "BOTTOM" },
        { dx: -1, dy: 0, label: "LEFT" }, { dx: 1, dy: 0, label: "RIGHT" }
    ];
    const cands = [];
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            if (!facilityIsFloor(x, y) || hideKeys.has(facilityKey(x, y))) continue;
            if (Math.hypot(x - startTile.x, y - startTile.y) < 5) continue;
            if (Math.hypot(x - goalTile.x, y - goalTile.y) < 5) continue;
            for (const wd of wallDirs) {
                if (map[y + wd.dy]?.[x + wd.dx] !== TILE_WALL) continue;
                const fx = -wd.dx, fy = -wd.dy;
                let score = 0;
                for (let dy = -3; dy <= 3; dy++) {
                    for (let dx = -3; dx <= 3; dx++) {
                        if (dx * fx + dy * fy <= 0) continue;
                        if (Math.hypot(dx, dy) * TILE_SIZE > 130) continue;
                        const t = targets.get(facilityKey(x + dx, y + dy));
                        if (!t || !facilityLos({ x, y }, t)) continue;
                        score++;
                    }
                }
                if (score < 2) continue;
                for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                    if (doorKeys.has(facilityKey(x + dx, y + dy))) { score += 2; dy = 3; break; }
                }
                cands.push({ x, y, wall: wd.label, angle: Math.atan2(fy, fx), score: score + facilityRand() });
            }
        }
    }
    cands.sort((p, q) => q.score - p.score);
    const picked = [];
    const maxN = 2 + (level - 1);
    for (const c of cands) {
        if (picked.length >= maxN) break;
        if (picked.some(p => Math.hypot(p.x - c.x, p.y - c.y) < FACILITY_CAMERA_MIN_SEP)) continue;
        picked.push({ x: c.x, y: c.y, wall: c.wall, angle: c.angle, score: Math.floor(c.score) });
    }
    return picked;
}

function facilityPlanItems(rooms, goalTile, startRoom, goalRoom) {
    const eligible = rooms.filter(r => r.id !== startRoom.id && r.id !== goalRoom.id);
    const group = (r) => (r.degree <= 1 ? 0 : (!r.onMain ? 1 : 2));
    facilityShuffle(eligible);
    eligible.sort((p, q) => group(p) - group(q));
    const deepList = (room) => {
        const list = [];
        for (let y = room.y0; y <= room.y1; y++) {
            for (let x = room.x0; x <= room.x1; x++) {
                if (!facilityIsFloor(x, y)) continue;
                if (Math.abs(x - goalTile.x) <= 2 && Math.abs(y - goalTile.y) <= 2) continue;
                let m = 1e9;
                for (const d of room.doors) m = Math.min(m, Math.abs(d.x - x) + Math.abs(d.y - y));
                list.push({ x, y, s: m + facilityRand() * 0.5 });
            }
        }
        return list.sort((p, q) => q.s - p.s);
    };
    const lists = eligible.map(r => ({ room: r, tiles: deepList(r), picked: [] }));
    const spots = [];
    for (let round = 0; round < 12; round++) {
        let any = false;
        for (const l of lists) {
            const t = l.tiles.find(c => l.picked.every(p => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) >= 2) && !l.picked.includes(c));
            if (!t) continue;
            l.picked.push(t);
            spots.push({ x: t.x, y: t.y, roomId: l.room.id, group: group(l.room) });
            any = true;
        }
        if (!any) break;
    }
    return spots;
}

// ---- createLevel から呼ばれる: 設計済み配置(カメラ・敵・アイテム)の採用 ----
function createFacilityCamera(spot) {
    const offset = 8;
    let cx = spot.x * TILE_SIZE + TILE_SIZE / 2;
    let cy = spot.y * TILE_SIZE + TILE_SIZE / 2;
    if (spot.wall === "TOP") cy = spot.y * TILE_SIZE + offset;
    else if (spot.wall === "BOTTOM") cy = spot.y * TILE_SIZE + TILE_SIZE - offset;
    else if (spot.wall === "LEFT") cx = spot.x * TILE_SIZE + offset;
    else if (spot.wall === "RIGHT") cx = spot.x * TILE_SIZE + TILE_SIZE - offset;
    // createSecurityCamera(map.js)と同じ形のカメラオブジェクト
    return {
        x: cx,
        y: cy,
        baseAngle: spot.angle,
        currentAngle: spot.angle,
        viewDistance: 130,
        blindRadius: 40,
        viewAngle: Math.PI / 6,
        swingSpeed: (0.01 + Math.random() * 0.01) * 0.7,
        swingRange: Math.PI / 3,
        phase: Math.random() * Math.PI * 2,
        state: "ACTIVE",
        disableTimer: 0
    };
}

/**
 * layoutInfo.designed のとき、ランダム配置の代わりに設計済みの
 * cameraSpots / enemyRoutes / itemSpots を採用する。
 * 予算(30 + level*18)・カメラ上限(2 + level-1)・既存の距離制約は createLevel と同じ。
 */
function placeDesignedLayoutContents(info) {
    const totalDifficultyBudget = 30 + (level * 18);
    let currentDifficulty = 0;

    const maxCameras = 2 + (level - 1);
    const cameraCost = 10;
    for (const spot of info.cameraSpots) {
        if (cameras.length >= maxCameras) break;
        if (currentDifficulty + cameraCost > totalDifficultyBudget * 0.4) break;
        // 距離は設置後のカメラ位置(壁際)で測る。既存の「プレイヤー・ゴールから200px以上」と同じ基準値
        const cam = createFacilityCamera(spot);
        if (dist(cam.x, cam.y, player.x, player.y) < 200) continue;
        if (dist(cam.x, cam.y, goal.x + TILE_SIZE / 2, goal.y + TILE_SIZE / 2) < 200) continue;
        cameras.push(cam);
        currentDifficulty += cameraCost;
    }

    for (const route of info.enemyRoutes) {
        if (currentDifficulty >= totalDifficultyBudget) break;
        const spawnIdx = [];
        // 出現位置(先頭 waypoint)は、プレイヤーから300px以上・既存の敵から400px以上(タイル中心で測る)
        route.tiles.forEach((t, i) => {
            const cx = t.x * TILE_SIZE + TILE_SIZE / 2, cy = t.y * TILE_SIZE + TILE_SIZE / 2;
            if (dist(cx, cy, player.x, player.y) < 300) return;
            for (const e of enemies) {
                if (dist(cx, cy, e.x, e.y) < 400) return;
            }
            spawnIdx.push(i);
        });
        if (spawnIdx.length === 0) continue;
        const k = facilityPick(spawnIdx);
        const tiles = route.tiles.slice(k).concat(route.tiles.slice(0, k));
        const enemy = createRouteEnemy(tiles);
        if (!enemy) continue;
        const routeCost = enemy.waypoints.length * 3 + (getPathLength(enemy.waypoints) / TILE_SIZE);
        if (enemies.length > 0 && currentDifficulty + routeCost > totalDifficultyBudget) continue;
        enemies.push(enemy);
        currentDifficulty += routeCost;
    }

    const baseItemCount = 2 + Math.floor(Math.random() * 2);
    const itemCount = baseItemCount + Math.floor(level / 3);
    for (let i = 0; i < itemCount && i < info.itemSpots.length; i++) {
        const tile = info.itemSpots[i];
        items.push({
            x: tile.x * TILE_SIZE + TILE_SIZE / 2,
            y: tile.y * TILE_SIZE + TILE_SIZE / 2,
            type: Math.floor(Math.random() * 3) + 1,
            active: true
        });
    }
}
