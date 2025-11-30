/**
 * map.js - マップ生成・地形判定
 */
function createLevel() {
    let newCols = 20 + (level - 1) * 4;
    let newRows = 16 + (level - 1) * 3;

    if (level >= SECURITY_LAYOUT_LEVEL) {
        newCols = 44;
        newRows = 26;
    }

    COLS = Math.min(64, newCols);
    ROWS = Math.min(52, newRows);

    COLS = Math.floor(COLS / 2) * 2;
    ROWS = Math.floor(ROWS / 2) * 2;

    let keptInventory = [];
    if (player && player.inventory && Array.isArray(player.inventory)) {
        keptInventory = player.inventory;
    }

    let initialSelectedType = ITEM_NONE;
    if (keptInventory.length > 0) {
        const unique = [...new Set(keptInventory)].sort((a, b) => a - b);
        initialSelectedType = unique[0];
    }

    map = [];
    enemies = [];
    cameras = [];
    items = [];
    particles = [];
    projectiles = [];
    securityDoor = null;
    currentTheme = THEMES[(level - 1) % THEMES.length];
    canvas.style.borderColor = currentTheme.wallColor;

    for (let y = 0; y < ROWS; y++) {
        map[y] = [];
        for (let x = 0; x < COLS; x++) {
            map[y][x] = TILE_WALL;
        }
    }

    let floorTiles = [];
    let layoutInfo = null;

    if (level >= SECURITY_LAYOUT_LEVEL) {
        layoutInfo = createDualFacilityLayout();
        floorTiles = layoutInfo.floorTiles;
    } else if (level % 2 === 1) {
        floorTiles = createMazeLayout();
    } else {
        floorTiles = createCaveLayout();
    }

    const playerStartTile = layoutInfo?.playerStartTile
        ? layoutInfo.playerStartTile
        : floorTiles[Math.floor(Math.random() * floorTiles.length)];

    player = {
        x: playerStartTile.x * TILE_SIZE + TILE_SIZE / 2,
        y: playerStartTile.y * TILE_SIZE + TILE_SIZE / 2,
        radius: 12,
        speed: 1.8,
        baseSpeed: 1.8,
        dx: 0,
        dy: 0,
        angle: 0,
        inventory: keptInventory,
        maxInventorySize: 8,
        selectedItemType: initialSelectedType,
        activeEffect: ITEM_NONE,
        effectTimer: 0,
        visibleRadius: 180,
        stunAmmo: 3,
        hasKeycard: false
    };

    const minGoalDistance = Math.min(COLS, ROWS) * TILE_SIZE * 0.6;
    let goalTile = layoutInfo?.goalTile;

    if (!goalTile) {
        let goalCandidates = floorTiles.filter(tile => {
            const d = dist(tile.x * TILE_SIZE, tile.y * TILE_SIZE, player.x, player.y);
            return d >= minGoalDistance;
        });

        if (goalCandidates.length === 0) {
            floorTiles.sort((a, b) => {
                const dA = dist(a.x * TILE_SIZE, a.y * TILE_SIZE, player.x, player.y);
                const dB = dist(b.x * TILE_SIZE, b.y * TILE_SIZE, player.x, player.y);
                return dB - dA;
            });
            goalCandidates.push(floorTiles[0]);
        }

        goalTile = goalCandidates[Math.floor(Math.random() * goalCandidates.length)];
    }

    goal = {
        x: goalTile.x * TILE_SIZE,
        y: goalTile.y * TILE_SIZE,
        w: TILE_SIZE,
        h: TILE_SIZE
    };

    const totalDifficultyBudget = 30 + (level * 18);
    let currentDifficulty = 0;

    const maxCameras = 2 + (level - 1);
    const cameraCost = 10;

    for (let i = 0; i < maxCameras; i++) {
        if (currentDifficulty + cameraCost > totalDifficultyBudget * 0.4) break;

        if (createSecurityCamera(floorTiles)) {
            currentDifficulty += cameraCost;
        }
    }

    let attempts = 0;
    const maxAttempts = 200;

    while (currentDifficulty < totalDifficultyBudget && attempts < maxAttempts) {
        attempts++;
        const tile = floorTiles[Math.floor(Math.random() * floorTiles.length)];

        if (dist(tile.x * TILE_SIZE, tile.y * TILE_SIZE, player.x, player.y) < 300) continue;

        let tooClose = false;
        for (const existingEnemy of enemies) {
            if (dist(tile.x * TILE_SIZE, tile.y * TILE_SIZE, existingEnemy.x, existingEnemy.y) < 400) {
                tooClose = true;
                break;
            }
        }
        if (tooClose) continue;

        const enemy = createSmartEnemy(tile.x, tile.y);

        if (enemy) {
            const routeCost = enemy.waypoints.length * 3 + (getPathLength(enemy.waypoints) / TILE_SIZE);
            if (enemies.length > 0 && currentDifficulty + routeCost > totalDifficultyBudget) {
                continue;
            }
            enemies.push(enemy);
            currentDifficulty += routeCost;
        }
    }

    const baseItemCount = 2 + Math.floor(Math.random() * 2);
    const extraItems = Math.floor(level / 3);
    const itemCount = baseItemCount + extraItems;

    for (let i = 0; i < itemCount; i++) {
        const tile = floorTiles[Math.floor(Math.random() * floorTiles.length)];
        const type = Math.floor(Math.random() * 3) + 1;
        items.push({
            x: tile.x * TILE_SIZE + TILE_SIZE / 2,
            y: tile.y * TILE_SIZE + TILE_SIZE / 2,
            type: type,
            active: true
        });
    }

    if (layoutInfo?.keycardTile) {
        items.push({
            x: layoutInfo.keycardTile.x * TILE_SIZE + TILE_SIZE / 2,
            y: layoutInfo.keycardTile.y * TILE_SIZE + TILE_SIZE / 2,
            type: ITEM_KEYCARD,
            active: true
        });
    }
}

function createSecurityCamera(floorTiles) {
    const candidates = [];

    for (let i = 0; i < 50; i++) {
        const tile = floorTiles[Math.floor(Math.random() * floorTiles.length)];
        if (dist(tile.x * TILE_SIZE, tile.y * TILE_SIZE, player.x, player.y) < 200) continue;
        if (dist(tile.x * TILE_SIZE, tile.y * TILE_SIZE, goal.x, goal.y) < 200) continue;

        const wallDirs = [];
        if (map[tile.y - 1][tile.x] === TILE_WALL) wallDirs.push({ angle: Math.PI / 2, label: "TOP" });
        if (map[tile.y + 1][tile.x] === TILE_WALL) wallDirs.push({ angle: -Math.PI / 2, label: "BOTTOM" });
        if (map[tile.y][tile.x - 1] === TILE_WALL) wallDirs.push({ angle: 0, label: "LEFT" });
        if (map[tile.y][tile.x + 1] === TILE_WALL) wallDirs.push({ angle: Math.PI, label: "RIGHT" });

        if (wallDirs.length > 0) {
            candidates.push({ tile: tile, dir: wallDirs[Math.floor(Math.random() * wallDirs.length)] });
        }
    }

    if (candidates.length > 0) {
        const selected = candidates[Math.floor(Math.random() * candidates.length)];
        const tile = selected.tile;
        const dir = selected.dir;

        let cx = tile.x * TILE_SIZE + TILE_SIZE / 2;
        let cy = tile.y * TILE_SIZE + TILE_SIZE / 2;
        const offset = 8;

        if (dir.label === "TOP") {
            cy = tile.y * TILE_SIZE + offset;
        } else if (dir.label === "BOTTOM") {
            cy = tile.y * TILE_SIZE + TILE_SIZE - offset;
        } else if (dir.label === "LEFT") {
            cx = tile.x * TILE_SIZE + offset;
        } else if (dir.label === "RIGHT") {
            cx = tile.x * TILE_SIZE + TILE_SIZE - offset;
        }

        cameras.push({
            x: cx,
            y: cy,
            baseAngle: dir.angle,
            currentAngle: dir.angle,
            viewDistance: 130,
            blindRadius: 40,
            viewAngle: Math.PI / 6,
            swingSpeed: 0.01 + Math.random() * 0.01,
            swingRange: Math.PI / 3,
            phase: Math.random() * Math.PI * 2,
            state: "ACTIVE",
            disableTimer: 0
        });
        return true;
    }
    return false;
}

function createDualFacilityLayout() {
    const floorTiles = [];
    const padding = 2;
    const corridorY = Math.floor(ROWS / 2);
    const leftArea = { x: padding, y: padding, w: 16, h: ROWS - padding * 2 };
    const rightArea = { x: COLS - padding - 16, y: padding, w: 16, h: ROWS - padding * 2 };

    const addTile = (x, y, collector) => {
        if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
        if (map[y][x] !== TILE_FLOOR) {
            map[y][x] = TILE_FLOOR;
        }
        if (collector) collector.push({ x, y });
    };

    const leftTiles = carveMiniArea(leftArea, corridorY);
    const rightTiles = carveMiniArea(rightArea, corridorY);
    floorTiles.push(...leftTiles, ...rightTiles);

    const corridorStart = leftArea.x + leftArea.w - 1;
    const corridorEnd = rightArea.x;
    for (let x = corridorStart; x <= corridorEnd; x++) {
        addTile(x, corridorY, floorTiles);
    }

    const unique = new Map();
    floorTiles.forEach(t => {
        const key = `${t.x},${t.y}`;
        if (!unique.has(key)) unique.set(key, t);
    });
    floorTiles.length = 0;
    floorTiles.push(...unique.values());

    const doorX = Math.floor((corridorStart + corridorEnd) / 2);
    const doorY = corridorY;
    map[doorY][doorX] = TILE_DOOR;
    securityDoor = { x: doorX, y: doorY, locked: true };

    const filtered = floorTiles.filter(t => !(t.x === doorX && t.y === doorY));
    floorTiles.length = 0;
    floorTiles.push(...filtered);

    const pickTile = (tiles, exclude) => {
        const candidates = tiles.filter(t => !exclude || (t.x !== exclude.x || t.y !== exclude.y));
        const pool = candidates.length > 0 ? candidates : tiles;
        if (pool.length === 0) return { x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) };
        return pool[Math.floor(Math.random() * pool.length)];
    };

    const playerStartTile = pickTile(leftTiles);
    const goalTile = pickTile(rightTiles);

    let keycardTile = pickTile(leftTiles, playerStartTile);
    if (!keycardTile) keycardTile = playerStartTile;

    return { floorTiles, playerStartTile, goalTile, keycardTile };
}

function carveMiniArea(area, corridorY) {
    const tiles = [];
    const visited = new Set();

    const addTile = (x, y) => {
        if (x <= area.x || x >= area.x + area.w - 1) return;
        if (y <= area.y || y >= area.y + area.h - 1) return;
        const key = `${x},${y}`;
        if (visited.has(key)) return;
        visited.add(key);
        map[y][x] = TILE_FLOOR;
        tiles.push({ x, y });
    };

    let cx = area.x + Math.floor(area.w / 2);
    let cy = area.y + Math.floor(area.h / 2);
    const steps = Math.floor(area.w * area.h * 0.8);

    for (let i = 0; i < steps; i++) {
        addTile(cx, cy);
        const dir = Math.floor(Math.random() * 4);
        if (dir === 0) cx++;
        else if (dir === 1) cx--;
        else if (dir === 2) cy++;
        else cy--;
        cx = Math.max(area.x + 1, Math.min(area.x + area.w - 2, cx));
        cy = Math.max(area.y + 1, Math.min(area.y + area.h - 2, cy));
    }

    const anchorY = Math.min(area.y + area.h - 3, Math.max(area.y + 2, corridorY));
    for (let x = area.x + 1; x < area.x + area.w - 1; x++) {
        addTile(x, anchorY);
    }

    return tiles;
}

function createCaveLayout() {
    let x = Math.floor(COLS / 2);
    let y = Math.floor(ROWS / 2);
    let floorTiles = [];
    const maxSteps = (COLS * ROWS) * 0.6;

    const visitedSet = new Set();

    for (let i = 0; i < maxSteps; i++) {
        if (map[y][x] === TILE_WALL) {
            map[y][x] = TILE_FLOOR;
        }

        const key = `${x},${y}`;
        if (!visitedSet.has(key)) {
            visitedSet.add(key);
            floorTiles.push({ x, y });
        }

        const dir = Math.floor(Math.random() * 4);
        if (dir === 0 && x < COLS - 2) x++;
        else if (dir === 1 && x > 1) x--;
        else if (dir === 2 && y < ROWS - 2) y++;
        else if (dir === 3 && y > 1) y--;
    }
    return floorTiles;
}

function createMazeLayout() {
    const stack = [];
    let floorTiles = [];
    const visitedSet = new Set();

    const mazeCols = Math.floor(COLS / 2);
    const mazeRows = Math.floor(ROWS / 2);
    const visited = Array(mazeRows).fill(null).map(() => Array(mazeCols).fill(false));

    let cx = 1, cy = 1;
    stack.push({ x: cx, y: cy });
    visited[cy][cx] = true;

    map[cy * 2 - 1][cx * 2 - 1] = TILE_FLOOR;

    const addFloor = (tx, ty) => {
        if (map[ty][tx] === TILE_WALL) {
            map[ty][tx] = TILE_FLOOR;
        }
        const key = `${tx},${ty}`;
        if (!visitedSet.has(key)) {
            visitedSet.add(key);
            floorTiles.push({ x: tx, y: ty });
        }
    };

    addFloor(cx * 2 - 1, cy * 2 - 1);

    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const neighbors = [];

        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        dirs.sort(() => Math.random() - 0.5);

        for (const dir of dirs) {
            const nx = current.x + dir[0];
            const ny = current.y + dir[1];
            if (nx > 0 && nx < mazeCols && ny > 0 && ny < mazeRows && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny, dir: dir });
            }
        }

        if (neighbors.length > 0) {
            const next = neighbors[0];
            const wallX = (current.x * 2 - 1) + next.dir[0];
            const wallY = (current.y * 2 - 1) + next.dir[1];
            const floorX = (next.x * 2 - 1);
            const floorY = (next.y * 2 - 1);

            addFloor(wallX, wallY);
            addFloor(floorX, floorY);

            visited[next.y][next.x] = true;
            stack.push(next);
        } else {
            stack.pop();
        }
    }

    const roomCount = Math.floor((COLS * ROWS) / 80) + Math.floor(Math.random() * 4);
    for (let i = 0; i < roomCount; i++) {
        const rw = 3 + Math.floor(Math.random() * 3);
        const rh = 3 + Math.floor(Math.random() * 3);
        const rx = Math.floor(Math.random() * (COLS - rw - 2)) + 1;
        const ry = Math.floor(Math.random() * (ROWS - rh - 2)) + 1;

        for (let dy = 0; dy < rh; dy++) {
            for (let dx = 0; dx < rw; dx++) {
                const tx = rx + dx;
                const ty = ry + dy;
                addFloor(tx, ty);
            }
        }
    }

    const loops = Math.floor((COLS * ROWS) / 20);
    for (let i = 0; i < loops; i++) {
        const x = Math.floor(Math.random() * (COLS - 2)) + 1;
        const y = Math.floor(Math.random() * (ROWS - 2)) + 1;
        if (map[y][x] === TILE_WALL) {
            addFloor(x, y);
        }
    }

    return floorTiles;
}

function getPathLength(points) {
    let d = 0;
    for (let i = 0; i < points.length - 1; i++) {
        d += dist(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y);
    }
    d += dist(points[points.length - 1].x, points[points.length - 1].y, points[0].x, points[0].y);
    return d;
}

function moveEntity(entity) {
    let nextX = entity.x + entity.dx;
    let nextY = entity.y + entity.dy;
    if (!isWall(nextX, entity.y)) entity.x = nextX;
    if (!isWall(entity.x, nextY)) entity.y = nextY;
}

function isWall(x, y) {
    const col = Math.floor(x / TILE_SIZE);
    const row = Math.floor(y / TILE_SIZE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    if (map[row][col] === TILE_WALL) return true;
    if (map[row][col] === TILE_DOOR && securityDoor && securityDoor.x === col && securityDoor.y === row && securityDoor.locked) return true;
    return false;
}

function lineIntersectsWall(x1, y1, x2, y2) {
    const steps = dist(x1, y1, x2, y2) / (TILE_SIZE / 4);
    const dx = (x2 - x1) / steps;
    const dy = (y2 - y1) / steps;
    for (let i = 0; i < steps; i++) {
        if (isWall(x1 + dx * i, y1 + dy * i)) return true;
    }
    return false;
}

function updateSecurityDoor() {
    if (!securityDoor || !securityDoor.locked) return;

    const cx = securityDoor.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = securityDoor.y * TILE_SIZE + TILE_SIZE / 2;
    const d = dist(player.x, player.y, cx, cy);

    if (player.hasKeycard && d < TILE_SIZE * 0.8) {
        map[securityDoor.y][securityDoor.x] = TILE_FLOOR;
        securityDoor.locked = false;
        playSE("item_use");
        showNotification("SECURITY DOOR OPENED");
    } else if (!player.hasKeycard && d < TILE_SIZE && frameCount % 60 === 0) {
        playSE("error");
        showNotification("ACCESS DENIED");
    }
}
