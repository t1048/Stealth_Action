
// A* Pathfinding
function findPath(startGx, startGy, endGx, endGy) {
    if (startGx === endGx && startGy === endGy) return [];
    
    // 目標地点が壁の場合、近隣の通行可能なタイルを探す（簡易対応）
    if (isTileBlockedForEnemy(endGx, endGy)) {
        const neighbors = [
            { x: endGx, y: endGy - 1 }, { x: endGx, y: endGy + 1 },
            { x: endGx - 1, y: endGy }, { x: endGx + 1, y: endGy }
        ];
        let found = false;
        for (const n of neighbors) {
            if (!isTileBlockedForEnemy(n.x, n.y)) {
                endGx = n.x;
                endGy = n.y;
                found = true;
                break;
            }
        }
        if (!found) return null;
    }

    const openSet = [];
    const closedSet = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = `${startGx},${startGy}`;
    gScore.set(startKey, 0);
    fScore.set(startKey, Math.abs(startGx - endGx) + Math.abs(startGy - endGy));

    openSet.push({ x: startGx, y: startGy, f: fScore.get(startKey) });

    // 安全装置：計算回数制限
    let loops = 0;
    const MAX_LOOPS = 500;

    while (openSet.length > 0) {
        loops++;
        if (loops > MAX_LOOPS) return null; // 計算打ち切り

        openSet.sort((a, b) => a.f - b.f);
        const current = openSet.shift();
        const currentKey = `${current.x},${current.y}`;

        if (current.x === endGx && current.y === endGy) {
            return reconstructPath(cameFrom, current);
        }

        closedSet.add(currentKey);

        const neighbors = [
            { x: current.x, y: current.y - 1 },
            { x: current.x, y: current.y + 1 },
            { x: current.x - 1, y: current.y },
            { x: current.x + 1, y: current.y }
        ];

        for (const neighbor of neighbors) {
            const neighborKey = `${neighbor.x},${neighbor.y}`;
            if (closedSet.has(neighborKey)) continue;
            if (isTileBlockedForEnemy(neighbor.x, neighbor.y)) continue;

            const tentativeGScore = gScore.get(currentKey) + 1;

            if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeGScore);
                const h = Math.abs(neighbor.x - endGx) + Math.abs(neighbor.y - endGy);
                fScore.set(neighborKey, tentativeGScore + h);

                if (!openSet.some(n => n.x === neighbor.x && n.y === neighbor.y)) {
                    openSet.push({ x: neighbor.x, y: neighbor.y, f: fScore.get(neighborKey) });
                }
            }
        }
    }

    return null;
}

function reconstructPath(cameFrom, current) {
    const totalPath = [current];
    let currentKey = `${current.x},${current.y}`;
    while (cameFrom.has(currentKey)) {
        current = cameFrom.get(currentKey);
        currentKey = `${current.x},${current.y}`;
        totalPath.unshift(current);
    }
    totalPath.shift();
    return totalPath;
}
