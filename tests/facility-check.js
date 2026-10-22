/**
 * facility-check.js - facility レイアウトのヘッドレス検証
 *
 * 使い方: node tests/facility-check.js [--n 200] [--seed 12345] [--dump Lv] [--quiet]
 *   state.js / mapgen-facility.js / map.js / pathfinding.js / enemies.js を vm に読み込み、
 *   DOM は最小限のスタブにして Lv3〜Lv20(+最大サイズのLv28) × n 回生成し、設計上の性質を検査する。
 *   1つでも「必須チェック」に失敗したら終了コード 1。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const N = parseInt(opt("n", "200"), 10);
const SEED = parseInt(opt("seed", "20261022"), 10);
const DUMP = opt("dump", null);
const QUIET = args.includes("--quiet");
const ROOT = path.join(__dirname, "..");

// ---- DOM スタブ(何を呼んでも落ちない) ----
function makeStub() {
    const fn = function () { return makeStub(); };
    return new Proxy(fn, {
        get: (t, p) => {
            if (p === "style") return {};
            if (p === Symbol.toPrimitive) return () => 0;
            if (p === "width" || p === "height") return 800;
            return makeStub();
        },
        set: () => true,
        apply: () => makeStub()
    });
}
const warnings = [];
const sandbox = {
    document: { getElementById: () => makeStub() },
    window: { forceLayout: "facility" },
    console: { log: () => {}, warn: (...a) => warnings.push(a.join(" ")), error: (...a) => warnings.push("ERROR " + a.join(" ")) },
    performance
};
const ctx = vm.createContext(sandbox);
for (const f of ["state.js", "mapgen-facility.js", "map.js", "pathfinding.js", "enemies.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), ctx, { filename: f });
}
const ev = (code) => vm.runInContext(code, ctx);

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}
let seedCounter = SEED;
function reseed(extra) {
    const rng = mulberry32((seedCounter++) ^ (extra * 7919));
    sandbox.__rng = rng;
    ev("Math.random = __rng; setFacilityRng(__rng);");
}

// createFacilityLayout の呼び出し回数(createLevel の再試行を数える)
ev("globalThis.__fcalls = 0; (function(){ const o = createFacilityLayout; createFacilityLayout = function(){ __fcalls++; return o.apply(this, arguments); }; })();");

const TILE = ev("TILE_SIZE");
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // facilityShortestPath と同じ近傍順

function setSize(lvl) {
    ev(`level = ${lvl}; COLS = Math.min(64, 10 + (level - 1) * 2); ROWS = Math.min(52, 8 + (level - 1) * 2); ` +
        `COLS = Math.floor(COLS / 2) * 2; ROWS = Math.floor(ROWS / 2) * 2; map = [];`);
}

// ---- 検査用の独立した BFS(ジェネレータの関数は使わない。近傍順だけ同じ) ----
function bfsPath(map, COLS, ROWS, s, g, blockedFn) {
    const prev = new Int32Array(COLS * ROWS).fill(-2);
    const q = [s.y * COLS + s.x];
    prev[q[0]] = -1;
    const gk = g.y * COLS + g.x;
    for (let qi = 0; qi < q.length; qi++) {
        const cur = q[qi];
        if (cur === gk) break;
        const cx = cur % COLS, cy = (cur - cx) / COLS;
        for (const [dx, dy] of DIRS) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            if (map[ny][nx] === 1) continue;
            const k = ny * COLS + nx;
            if (prev[k] !== -2) continue;
            if (blockedFn && blockedFn(nx, ny)) continue;
            prev[k] = cur;
            q.push(k);
        }
    }
    if (prev[gk] === -2) return null;
    const out = [];
    for (let k = gk; k !== -1; k = prev[k]) out.push({ x: k % COLS, y: Math.floor(k / COLS) });
    return out.reverse();
}

// ルート上の隠れ場所の間隔。reach 以内に隠れ場所があるルート上の位置を「覆われている」とみなす。
// ends=true: 始点/終点を覆われている位置として扱う(ジェネレータの定義)。false: 始点→最初の隠れ場所、最後→終点も区間に数える。
function hideGap(route, hideSet, COLS, reach, ends) {
    const n = route.length;
    const mark = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
        const t = route[i];
        outer: for (let dy = -reach; dy <= reach; dy++) {
            for (let dx = -reach; dx <= reach; dx++) {
                if (hideSet.has((t.y + dy) * COLS + (t.x + dx))) { mark[i] = true; break outer; }
            }
        }
    }
    if (ends) { mark[0] = true; mark[n - 1] = true; }
    let last = ends ? 0 : -1, max = 0;
    for (let i = ends ? 1 : 0; i < n; i++) {
        if (!mark[i]) continue;
        max = Math.max(max, i - last);
        last = i;
    }
    if (!ends) max = Math.max(max, n - 1 - last);
    return max;
}

// lineIntersectsWall(map.js)と同じ規則(TILE/4刻みのサンプリング)をローカルのマップで再実装した視線判定
function losBlocked(map, COLS, ROWS, a, b) {
    const x1 = a.x * TILE + TILE / 2, y1 = a.y * TILE + TILE / 2, x2 = b.x * TILE + TILE / 2, y2 = b.y * TILE + TILE / 2;
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d === 0) return false;
    const steps = d / (TILE / 4);
    const dx = (x2 - x1) / steps, dy = (y2 - y1) / steps;
    for (let i = 0; i < steps; i++) {
        const col = Math.floor((x1 + dx * i) / TILE), row = Math.floor((y1 + dy * i) / TILE);
        if (col < 0 || row < 0 || col >= COLS || row >= ROWS || map[row][col] === 1) return true;
    }
    return false;
}

// 地点 s の「見えにくさ」: s から歩行距離6以内かつ直線4タイル(160px)以内の床タイルのうち、s への視線が壁で遮られる割合
function hiddenRatio(map, COLS, ROWS, s) {
    const dist = new Map([[s.y * COLS + s.x, 0]]);
    const q = [s];
    for (let qi = 0; qi < q.length; qi++) {
        const c = q[qi], dc = dist.get(c.y * COLS + c.x);
        if (dc >= 6) continue;
        for (const [dx, dy] of DIRS) {
            const nx = c.x + dx, ny = c.y + dy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || map[ny][nx] === 1) continue;
            const k = ny * COLS + nx;
            if (dist.has(k)) continue;
            dist.set(k, dc + 1);
            q.push({ x: nx, y: ny });
        }
    }
    let total = 0, blocked = 0;
    for (const t of q) {
        if (t.x === s.x && t.y === s.y) continue;
        if (Math.hypot(t.x - s.x, t.y - s.y) * TILE > 160) continue;
        total++;
        if (losBlocked(map, COLS, ROWS, t, s)) blocked++;
    }
    return total === 0 ? null : blocked / total;
}

function pct(a, b) { return b === 0 ? "n/a" : (100 * a / b).toFixed(1) + "%"; }
function stat(arr) {
    if (arr.length === 0) return { mean: 0, max: 0, min: 0, p95: 0 };
    const s = arr.slice().sort((a, b) => a - b);
    return { mean: s.reduce((x, y) => x + y, 0) / s.length, max: s[s.length - 1], min: s[0], p95: s[Math.floor(s.length * 0.95)] };
}
const f1 = (x) => x.toFixed(1);

function dumpMap(info, map, COLS, ROWS) {
    const g = [];
    for (let y = 0; y < ROWS; y++) { g.push([]); for (let x = 0; x < COLS; x++) g[y].push(map[y][x] === 1 ? "#" : "."); }
    info.itemSpots.forEach(t => g[t.y][t.x] = "i");
    info.hideSpots.forEach(t => g[t.y][t.x] = { alcove: "a", pillar: "p", corner: "c" }[t.kind] || "h");
    info.enemyRoutes.forEach(r => r.tiles.forEach(t => { if (g[t.y][t.x] === ".") g[t.y][t.x] = "e"; }));
    info.cameraSpots.forEach(t => g[t.y][t.x] = "C");
    g[info.playerStartTile.y][info.playerStartTile.x] = "S";
    g[info.goalTile.y][info.goalTile.x] = "G";
    return g.map(r => r.join("")).join("\n");
}

// ---- 本体 ----
const failures = [];
const hideRatios = { baseline: [] };
const must = (cond, msg) => { if (!cond) failures.push(msg); };
const rows = [];
const levels = [];
for (let l = 3; l <= 20; l++) levels.push(l);
levels.push(28);   // 64x52(最大サイズ)

console.log(`facility-check: N=${N}/level, seed=${SEED}, levels=${levels.join(",")}`);
let totalGen = 0;

for (const lvl of levels) {
    const acc = {
        lvl, size: "", gen: 0, rawFail: 0, notValid: 0, minimal: 0, attempts: [], timeMs: [],
        lenOk: 0, walkLen: [], minLen: 0,
        gapEnds: [], gapStrict: [], gapB: [], gapBworst: [],
        loop: 0, bypassRoute: 0,
        rooms: [], sideRooms: [], types: {}, spots: [], kinds: {}, routesPerLayout: [], hidePerRoute: 0, routeCount: 0,
        routeBad: 0, enemyNearStart: 0, enemyInStartRoom: 0, enemiesTotal: 0, enemies: [], cams: [], itemsN: [], itemBad: 0,
        camBad: 0, budgetBad: 0, pipeFail: 0, pipeFcalls: [], warn: 0, itemShort: 0, itemExpected: 0, enemyZero: 0,
        goalEuclidBad: 0, firstWpBad: 0
    };
    for (let n = 0; n < N; n++) {
        reseed(lvl * 1000 + n);
        setSize(lvl);
        const COLS = ev("COLS"), ROWS = ev("ROWS");
        acc.size = `${COLS}x${ROWS}`;

        // A) レイアウトのみ(createLevel のリトライなし)
        const t0 = performance.now();
        const info = ev("createFacilityLayout()");
        const t1 = performance.now();
        acc.gen++;
        acc.timeMs.push(t1 - t0);
        acc.attempts.push(info.attempts || 0);
        if (!info.valid) { acc.notValid++; if (info.failReason === "minimal" || (info.rooms || []).length === 0) acc.minimal++; }
        const map = ev("map");
        const S = info.playerStartTile, G = info.goalTile;

        const conn = ev(`validateConnectivity(${JSON.stringify(S)}, [${JSON.stringify(G)}])`);
        if (!conn) acc.rawFail++;
        if (!info.valid) continue;

        const A = bfsPath(map, COLS, ROWS, S, G, null);
        if (!A) { acc.rawFail++; continue; }
        const walk = A.length - 1;
        acc.walkLen.push(walk);
        const minLen = Math.min(COLS, ROWS) * 0.6;
        if (walk >= minLen) acc.lenOk++;
        const eu = Math.hypot((S.x - G.x) * TILE, (S.y - G.y) * TILE);
        if (eu < Math.min(COLS, ROWS) * TILE * 0.6) acc.goalEuclidBad++;

        const hideSet = new Set(info.hideSpots.map(t => t.y * COLS + t.x));
        acc.gapEnds.push(hideGap(A, hideSet, COLS, 2, true));
        acc.gapStrict.push(hideGap(A, hideSet, COLS, 2, false));
        info.hideSpots.forEach(t => acc.kinds[t.kind] = (acc.kinds[t.kind] || 0) + 1);
        if (n < 20) {
            // 隠れ場所の見えにくさ(種類別)と、床タイル全体での基準値
            info.hideSpots.forEach(t => {
                const r = hiddenRatio(map, COLS, ROWS, t);
                if (r !== null) (hideRatios[t.kind] = hideRatios[t.kind] || []).push(r);
            });
            const floors = info.floorTiles;
            for (let k = 0; k < 40; k++) {
                const t = floors[Math.floor(sandbox.__rng() * floors.length)];
                const r = hiddenRatio(map, COLS, ROWS, t);
                if (r !== null) hideRatios.baseline.push(r);
            }
        }
        acc.spots.push(info.hideSpots.length);

        // 迂回: メインルート上の廊下(次数2のタイル)を1枚塞いでもゴールに着けるか
        const aSet = new Set(A.map(t => t.y * COLS + t.x));
        const nbCount = (x, y) => DIRS.reduce((c, [dx, dy]) => c + (map[y + dy] && map[y + dy][x + dx] !== 1 && map[y + dy][x + dx] !== undefined ? 1 : 0), 0);
        let loopFound = false;
        let worstB = 0, chosenBgap = null;
        const triedBlocks = [];
        for (const c of info.corridors.filter(c => c.tiles.some(t => aSet.has(t.y * COLS + t.x)))) {
            const blocked = new Set(c.tiles.map(t => t.y * COLS + t.x));
            const B = bfsPath(map, COLS, ROWS, S, G, (x, y) => blocked.has(y * COLS + x));
            if (B) {
                loopFound = true;
                worstB = Math.max(worstB, hideGap(B, hideSet, COLS, 2, true));
            }
        }
        if (loopFound) acc.loop++;
        acc.gapBworst.push(worstB);
        const chosenB = info.bypassRoute;
        if (chosenB && chosenB.length > 1) {
            acc.bypassRoute++;
            acc.gapB.push(hideGap(chosenB, hideSet, COLS, 2, true));
        }

        // 部屋・種類
        acc.rooms.push(info.rooms.length);
        acc.sideRooms.push(info.rooms.filter(r => r.type === "side").length);
        info.rooms.forEach(r => acc.types[r.type] = (acc.types[r.type] || 0) + 1);
        acc.routesPerLayout.push(info.enemyRoutes.length);

        // 巡回ルート: 全 waypoint 間(最後→最初も)が壁に遮られない・スタート部屋に入らない
        const startRoom = info.rooms.find(r => r.type === "start");
        for (const r of info.enemyRoutes) {
            acc.routeCount++;
            let bad = false;
            for (let i = 0; i < r.tiles.length; i++) {
                const a = r.tiles[i], b = r.tiles[(i + 1) % r.tiles.length];
                const blocked = ev(`lineIntersectsWall(${a.x * TILE + TILE / 2}, ${a.y * TILE + TILE / 2}, ${b.x * TILE + TILE / 2}, ${b.y * TILE + TILE / 2})`);
                if (blocked) bad = true;
                if (a.x >= startRoom.x0 && a.x <= startRoom.x1 && a.y >= startRoom.y0 && a.y <= startRoom.y1) acc.enemyInStartRoom++;
            }
            if (bad) acc.routeBad++;
            // ルートの近く(3タイル以内)に隠れ場所があるか
            if (r.tiles.some(t => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (hideSet.has((t.y + dy) * COLS + t.x + dx)) return true; return false; })) acc.hidePerRoute++;
        }
        if (DUMP && String(lvl) === DUMP && n === 0) {
            console.log(`--- dump Lv${lvl} (${COLS}x${ROWS}) rooms=${info.rooms.length} attempts=${info.attempts} walk=${walk}`);
            console.log(dumpMap(info, map, COLS, ROWS));
        }

        // B) createLevel 全体(facility 強制。再試行・設計配置の採用まで)
        reseed(lvl * 1000 + n + 500000);
        ev("__fcalls = 0");
        const warnBefore = warnings.length;
        let threw = null;
        try { ev("createLevel()"); } catch (e) { threw = e; }
        if (threw) { acc.pipeFail++; failures.push(`createLevel threw at Lv${lvl}: ${threw.message}`); continue; }
        acc.warn += warnings.length - warnBefore;
        acc.pipeFcalls.push(ev("__fcalls"));
        const lay = ev("facilityLastLayout");
        if (!lay.valid) acc.minimal++;
        const COLS2 = ev("COLS"), ROWS2 = ev("ROWS");
        const map2 = ev("map");
        const pl = ev("({x: player.x, y: player.y})");
        const gl = ev("({x: goal.x, y: goal.y})");
        const enemies = ev("enemies"), cameras = ev("cameras"), items = ev("items");
        const startTile = { x: Math.floor(pl.x / TILE), y: Math.floor(pl.y / TILE) };
        const goalTile = { x: Math.floor(gl.x / TILE), y: Math.floor(gl.y / TILE) };
        if (!ev(`validateConnectivity(${JSON.stringify(startTile)}, [${JSON.stringify(goalTile)}])`)) acc.pipeFail++;

        acc.enemies.push(enemies.length);
        acc.cams.push(cameras.length);
        acc.itemsN.push(items.length);
        if (enemies.length === 0) acc.enemyZero++;
        const sRoom = lay.rooms.find(r => r.type === "start");
        for (const e of enemies) {
            acc.enemiesTotal++;
            if (Math.hypot(e.x - pl.x, e.y - pl.y) < 300) acc.enemyNearStart++;
            if (Math.floor(e.x / TILE) >= sRoom.x0 && Math.floor(e.x / TILE) <= sRoom.x1 && Math.floor(e.y / TILE) >= sRoom.y0 && Math.floor(e.y / TILE) <= sRoom.y1) acc.enemyInStartRoom++;
            if (e.x !== e.waypoints[0].x || e.y !== e.waypoints[0].y) acc.firstWpBad++;
            for (let i = 0; i < e.waypoints.length; i++) {
                const a = e.waypoints[i], b = e.waypoints[(i + 1) % e.waypoints.length];
                if (ev(`lineIntersectsWall(${a.x}, ${a.y}, ${b.x}, ${b.y})`)) { acc.routeBad++; break; }
            }
        }
        const itemExpectedMin = 2 + Math.floor(lvl / 3);
        acc.itemExpected += itemExpectedMin;
        if (items.length < itemExpectedMin) acc.itemShort++;
        for (const it of items) {
            const tx = Math.floor(it.x / TILE), ty = Math.floor(it.y / TILE);
            if (Math.abs(tx - goalTile.x) <= 2 && Math.abs(ty - goalTile.y) <= 2) acc.itemBad++;
            if (tx >= sRoom.x0 && tx <= sRoom.x1 && ty >= sRoom.y0 && ty <= sRoom.y1) acc.itemBad++;
            if (map2[ty][tx] === 1) acc.itemBad++;
        }
        for (const c of cameras) {
            // カメラの実位置から、プレイヤー中心・ゴールタイル中心までが200px以上
            if (Math.hypot(c.x - pl.x, c.y - pl.y) < 200 || Math.hypot(c.x - (gl.x + TILE / 2), c.y - (gl.y + TILE / 2)) < 200) acc.camBad++;
        }
        const budget = 30 + lvl * 18;
        let diff = cameras.length * 10;
        if (cameras.length * 10 > budget * 0.4 + 1e-9 || cameras.length > 2 + (lvl - 1)) acc.budgetBad++;
        for (const e of enemies) diff += e.waypoints.length * 3 + ev(`getPathLength(${JSON.stringify(e.waypoints.map(w => ({ x: w.x, y: w.y })))})`) / TILE;
        if (enemies.length > 1 && diff > budget + 1e-9) acc.budgetBad++;
    }
    rows.push(acc);
    totalGen += acc.gen;

    // 必須チェック
    must(acc.rawFail === 0, `Lv${lvl}: 生成直後の接続性/ゴール到達 失敗 ${acc.rawFail}/${acc.gen}`);
    must(acc.notValid === 0, `Lv${lvl}: facility 内部検証を通らず最小レイアウトに落ちた ${acc.notValid}/${acc.gen}`);
    must(acc.lenOk === acc.walkLen.length && acc.walkLen.length === acc.gen, `Lv${lvl}: ゴールまでの歩行経路長が不足 ${acc.gen - acc.lenOk}/${acc.gen}`);
    must(acc.loop === acc.gen, `Lv${lvl}: 迂回ルート無し ${acc.gen - acc.loop}/${acc.gen}`);
    must(Math.max(0, ...acc.gapEnds) <= 10, `Lv${lvl}: メインルートの無隠れ区間が10超 (max ${Math.max(0, ...acc.gapEnds)})`);
    must(acc.routeBad === 0, `Lv${lvl}: 巡回ルートの waypoint 間が壁に遮られる ${acc.routeBad}`);
    must(acc.enemyNearStart === 0, `Lv${lvl}: プレイヤー初期位置300px以内に敵 ${acc.enemyNearStart}`);
    must(acc.enemyInStartRoom === 0, `Lv${lvl}: スタート部屋に敵/巡回点 ${acc.enemyInStartRoom}`);
    must(acc.pipeFail === 0, `Lv${lvl}: createLevel 後の接続性/例外 ${acc.pipeFail}`);
    must(acc.firstWpBad === 0, `Lv${lvl}: 敵の初期位置が先頭 waypoint と不一致 ${acc.firstWpBad}`);
    must(acc.itemBad === 0, `Lv${lvl}: アイテムがスタート部屋/ゴール付近/壁 ${acc.itemBad}`);
    must(acc.camBad === 0, `Lv${lvl}: カメラがプレイヤー/ゴールに近い ${acc.camBad}`);
    must(acc.budgetBad === 0, `Lv${lvl}: 予算/カメラ上限超過 ${acc.budgetBad}`);
    must(acc.warn === 0, `Lv${lvl}: console.warn/error ${acc.warn}`);
}

// 既存レイアウトの回帰(落ちないか)。facility 以外を強制して数回回す
let regression = "";
for (const lt of ["cave", "maze", "security", "upload"]) {
    ev(`window.forceLayout = "${lt}"`);
    let okCount = 0, errs = 0;
    for (const lvl of [1, 3, 6, 10, 20]) {
        for (let n = 0; n < 20; n++) {
            reseed(lvl * 77 + n);
            ev(`level = ${lvl}`);
            try { ev("createLevel()"); okCount++; } catch (e) { errs++; failures.push(`${lt} Lv${lvl} threw: ${e.message}`); }
        }
    }
    regression += `${lt}: ok=${okCount} err=${errs}  `;
}
ev(`window.forceLayout = "facility"`);
// 低レベルで facility を強制した場合(デバッグ用)。落ちないか
let lowRegression = "";
for (const lvl of [1, 2]) {
    let ok = 0, bad = 0;
    for (let n = 0; n < 50; n++) {
        reseed(lvl * 31 + n);
        setSize(lvl);
        try { const info = ev("createFacilityLayout()"); if (info.valid) ok++; else bad++; } catch (e) { bad++; failures.push(`facility Lv${lvl} threw: ${e.message}`); }
    }
    lowRegression += `Lv${lvl}: valid=${ok} fallback=${bad}  `;
}

// ---- レポート ----
const line = (s) => console.log(s);
line("");
line("== 生成の健全性(facility 単体 / createLevel 全体) ==");
line("Lv  size   gen  rawFail  notValid  attempts(mean/max)  walkLen(min/mean)  minReq  loop%   pipeFail  createLevel内facility呼出(mean/max)");
for (const a of rows) {
    const at = stat(a.attempts), wl = stat(a.walkLen), pf = stat(a.pipeFcalls);
    line(`${String(a.lvl).padStart(2)}  ${a.size.padEnd(6)} ${String(a.gen).padStart(4)} ${String(a.rawFail).padStart(7)} ${String(a.notValid).padStart(9)}  ${f1(at.mean).padStart(6)}/${String(at.max).padEnd(4)}          ${String(wl.min).padStart(4)}/${f1(wl.mean).padEnd(6)}       ${f1(Math.min(...[a.size.split("x").map(Number)].flat()) * 0.6).padStart(5)}  ${pct(a.loop, a.gen).padStart(6)}  ${String(a.pipeFail).padStart(8)}  ${f1(pf.mean)}/${pf.max}`);
}
line("");
line("== 隠れ場所の間隔(メインルート=最短歩行経路。reach=2タイル) ==");
line("Lv  最大無隠れ区間: 端を覆う定義(mean/p95/max)  端も区間に数える(mean/p95/max)  迂回ルートB(max)  全迂回の最悪(max)  隠れ場所数(mean)  種類別(alcove/pillar/corner 平均)");
for (const a of rows) {
    const g1 = stat(a.gapEnds), g2 = stat(a.gapStrict), g3 = stat(a.gapB), g4 = stat(a.gapBworst), sp = stat(a.spots);
    const k = (name) => f1((a.kinds[name] || 0) / a.gen);
    line(`${String(a.lvl).padStart(2)}  ${f1(g1.mean).padStart(5)}/${String(g1.p95).padStart(3)}/${String(g1.max).padStart(3)}                         ${f1(g2.mean).padStart(5)}/${String(g2.p95).padStart(3)}/${String(g2.max).padStart(3)}                           ${String(g3.max).padStart(3)}              ${String(g4.max).padStart(3)}           ${f1(sp.mean).padStart(6)}      ${k("alcove")}/${k("pillar")}/${k("corner")}`);
}
line("");
line("== 隠れ場所の見えにくさ(各レベル先頭20生成。歩行6以内・直線160px以内の床から視線が壁で遮られる割合) ==");
for (const k of ["alcove", "pillar", "corner", "baseline"]) {
    const s = stat(hideRatios[k] || []);
    line(`${k.padEnd(8)} n=${String((hideRatios[k] || []).length).padStart(5)}  mean ${(s.mean * 100).toFixed(1)}%  p95 ${((s.p95 || 0) * 100).toFixed(1)}%${k === "baseline" ? "  (床タイル無作為40点/生成)" : ""}`);
}
line("");
line("== 部屋・敵・カメラ・アイテム(createLevel 後) ==");
line("Lv  部屋数(mean/max)  side部屋(mean)  巡回ルート候補(mean)  敵(mean/min/max)  敵0体  カメラ(mean/max)  アイテム(mean/min)  ルート近傍3tに隠れ場所  waypoint遮蔽  敵<300px  初期位置不一致");
for (const a of rows) {
    const r = stat(a.rooms), sd = stat(a.sideRooms), rp = stat(a.routesPerLayout), en = stat(a.enemies), cm = stat(a.cams), it = stat(a.itemsN);
    line(`${String(a.lvl).padStart(2)}  ${f1(r.mean).padStart(5)}/${String(r.max).padEnd(3)}       ${f1(sd.mean).padStart(5)}           ${f1(rp.mean).padStart(5)}                ${f1(en.mean)}/${en.min}/${en.max}        ${String(a.enemyZero).padStart(3)}   ${f1(cm.mean)}/${cm.max}            ${f1(it.mean)}/${it.min}               ${pct(a.hidePerRoute, a.routeCount).padStart(6)}               ${a.routeBad}            ${a.enemyNearStart}         ${a.firstWpBad}`);
}
line("");
const maxRow = rows.find(r => r.lvl === 28);
const allTimes = rows.flatMap(r => r.timeMs);
line("== 生成時間 createFacilityLayout (ms) ==");
for (const a of rows) {
    const t = stat(a.timeMs);
    if (a.lvl === 3 || a.lvl === 10 || a.lvl === 20 || a.lvl === 28) line(`Lv${a.lvl} (${a.size}): mean ${t.mean.toFixed(2)}  p95 ${t.p95.toFixed(2)}  max ${t.max.toFixed(2)}`);
}
const tm = stat(allTimes);
line(`全体: mean ${tm.mean.toFixed(2)}  max ${tm.max.toFixed(2)}`);
line("");
line("== 既存レイアウトの回帰(createLevel が例外なく動くか) ==");
line(regression);
line("== facility を Lv1/2 で強制した場合(デバッグ用。仕様対象外) ==");
line(lowRegression);
line("");
line(`総生成数(facility単体): ${totalGen}`);
if (failures.length) {
    line("");
    line("== 失敗 ==");
    failures.slice(0, 40).forEach(f => line("FAIL: " + f));
    process.exit(1);
} else {
    line("全チェック OK");
}
