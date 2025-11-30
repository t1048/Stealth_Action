/**
 * enemies.js - 敵・カメラ挙動
 */
function createSmartEnemy(gridX, gridY) {
    const startX = gridX * TILE_SIZE + TILE_SIZE / 2;
    const startY = gridY * TILE_SIZE + TILE_SIZE / 2;
    const startPoint = { x: startX, y: startY, gx: gridX, gy: gridY };

    let waypoints = [startPoint];

    let p1 = findLongestPath(gridX, gridY);
    if (!p1) return null;

    waypoints.push(p1);

    let p2 = findTurnPath(p1.gx, p1.gy, gridX, gridY);
    if (p2) {
        waypoints.push(p2);

        let p3 = findTurnPath(p2.gx, p2.gy, p1.gx, p1.gy);
        if (p3) {
            if (dist(p3.x, p3.y, startX, startY) < TILE_SIZE * 3) {
            } else {
                waypoints.push(p3);
            }
        }
    }

    if (getPathLength(waypoints) < TILE_SIZE * 4) return null;

    return {
        x: startX,
        y: startY,
        radius: 12,
        speed: (0.9 + (level * 0.09)) * 0.9,
        angle: 0,
        state: "PATROL",
        waypoints: waypoints,
        currentWpIndex: 1,
        waitTimer: 0,
        viewDistance: 160,
        viewAngle: Math.PI / 4,
        targetX: null,
        targetY: null,
        lostSightTimer: 0,
        color: "#ff3333"
    };
}

function findLongestPath(gx, gy) {
    const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    let bestPoint = null;
    let maxDist = 0;

    directions.forEach(dir => {
        let cx = gx;
        let cy = gy;
        let distCount = 0;
        while (true) {
            let nx = cx + dir[0];
            let ny = cy + dir[1];
            if (isTileBlockedForEnemy(nx, ny)) break;
            cx = nx;
            cy = ny;
            distCount++;
        }
        if (distCount > maxDist) {
            maxDist = distCount;
            bestPoint = {
                x: cx * TILE_SIZE + TILE_SIZE / 2,
                y: cy * TILE_SIZE + TILE_SIZE / 2,
                gx: cx, gy: cy
            };
        }
    });

    return maxDist > 1 ? bestPoint : null;
}

function findTurnPath(gx, gy, prevGx, prevGy) {
    const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    let bestPoint = null;
    let maxDist = 0;

    directions.forEach(dir => {
        if (gx + dir[0] === prevGx && gy + dir[1] === prevGy) return;

        let cx = gx;
        let cy = gy;
        let distCount = 0;
        while (true) {
            let nx = cx + dir[0];
            let ny = cy + dir[1];
            if (isTileBlockedForEnemy(nx, ny)) break;
            cx = nx;
            cy = ny;
            distCount++;
        }
        if (distCount > maxDist) {
            maxDist = distCount;
            bestPoint = {
                x: cx * TILE_SIZE + TILE_SIZE / 2,
                y: cy * TILE_SIZE + TILE_SIZE / 2,
                gx: cx, gy: cy
            };
        }
    });

    return maxDist > 1 ? bestPoint : null;
}

function updateEnemies() {
    let anyChase = false;

    enemies.forEach(enemy => {
        let moveSpeed = enemy.speed;

        if (enemy.state === "STUNNED") {
            enemy.waitTimer--;
            if (enemy.waitTimer <= 0) {
                enemy.state = "ALERT";
                enemy.waitTimer = 60;
            }
            return;
        }

        if (player.activeEffect === ITEM_CLOAK && enemy.state === "CHASE") {
            enemy.state = "ALERT";
            enemy.waitTimer = 60;
        }

        if (canSeePlayer(enemy)) {
            if (player.activeEffect !== ITEM_CLOAK) {
                if (enemy.state !== "CHASE") playSE("alert");
                enemy.state = "CHASE";
                enemy.targetX = player.x;
                enemy.targetY = player.y;
                enemy.waitTimer = 0;
                enemy.lostSightTimer = 0;
            }
        }

        if (enemy.state === "CHASE") {
            anyChase = true;

            if (!canSeePlayer(enemy)) {
                enemy.lostSightTimer++;

                const distToLastKnown = dist(enemy.x, enemy.y, enemy.targetX, enemy.targetY);

                if (enemy.lostSightTimer > 120 || distToLastKnown < TILE_SIZE / 2) {
                    enemy.state = "ALERT";
                    enemy.waitTimer = 90;
                    enemy.dx = 0;
                    enemy.dy = 0;
                    return;
                }
            }

            const angle = Math.atan2(enemy.targetY - enemy.y, enemy.targetX - enemy.x);
            enemy.angle = angle;
            enemy.dx = Math.cos(angle) * (moveSpeed * 1.5);
            enemy.dy = Math.sin(angle) * (moveSpeed * 1.5);

        } else if (enemy.state === "ALERT") {
            enemy.dx = 0;
            enemy.dy = 0;
            enemy.angle += 0.1;
            enemy.waitTimer--;
            if (enemy.waitTimer <= 0) {
                enemy.state = "PATROL";
                let minDist = Infinity;
                let nearestIdx = 0;
                enemy.waypoints.forEach((wp, idx) => {
                    const d = dist(enemy.x, enemy.y, wp.x, wp.y);
                    if (d < minDist) {
                        minDist = d;
                        nearestIdx = idx;
                    }
                });
                enemy.currentWpIndex = nearestIdx;
            }
        } else if (enemy.state === "PATROL") {
            if (enemy.waitTimer > 0) {
                enemy.waitTimer--;
                enemy.dx = 0;
                enemy.dy = 0;
            } else {
                const target = enemy.waypoints[enemy.currentWpIndex];
                const d = dist(enemy.x, enemy.y, target.x, target.y);

                if (d < 5) {
                    enemy.waitTimer = 40;
                    enemy.dx = 0;
                    enemy.dy = 0;
                    enemy.currentWpIndex = (enemy.currentWpIndex + 1) % enemy.waypoints.length;
                } else {
                    const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
                    enemy.angle = angle;
                    enemy.dx = Math.cos(angle) * moveSpeed;
                    enemy.dy = Math.sin(angle) * moveSpeed;
                }
            }
        }
        moveEntity(enemy);
    });
    bgmState.isChase = anyChase;
}

function updateCameras() {
    cameras.forEach(cam => {
        if (cam.state === "DISABLED") {
            cam.disableTimer--;
            if (cam.disableTimer <= 0) {
                cam.state = "ACTIVE";
            }
            return;
        }

        cam.phase += cam.swingSpeed;
        cam.currentAngle = cam.baseAngle + Math.sin(cam.phase) * cam.swingRange;

        if (player.activeEffect !== ITEM_CLOAK && canCameraSeePlayer(cam)) {
            let nearestEnemy = null;
            let minDist = Infinity;
            enemies.forEach(e => {
                if (e.state === "STUNNED") return;
                const d = dist(cam.x, cam.y, e.x, e.y);
                if (d < minDist) {
                    minDist = d;
                    nearestEnemy = e;
                }
            });

            if (nearestEnemy) {
                if (nearestEnemy.state !== "CHASE") {
                    playSE("camera_detect");
                    createParticles(cam.x, cam.y, "#f00", 5);
                    showNotification("SECURITY ALERT!");
                }
                nearestEnemy.state = "CHASE";
                nearestEnemy.targetX = player.x;
                nearestEnemy.targetY = player.y;
                nearestEnemy.waitTimer = 0;
                nearestEnemy.lostSightTimer = 0;
            }
        }
    });
}

function canCameraSeePlayer(cam) {
    const d = dist(cam.x, cam.y, player.x, player.y);
    if (d > cam.viewDistance || d < cam.blindRadius) return false;

    const angleToPlayer = Math.atan2(player.y - cam.y, player.x - cam.x);
    let angleDiff = angleToPlayer - cam.currentAngle;

    while (angleDiff <= -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    if (Math.abs(angleDiff) < cam.viewAngle) {
        return !lineIntersectsWall(cam.x, cam.y, player.x, player.y);
    }
    return false;
}

function canSeePlayer(enemy) {
    if (player.activeEffect === ITEM_CLOAK) return false;
    if (enemy.state === "STUNNED") return false;
    const d = dist(enemy.x, enemy.y, player.x, player.y);
    if (d > enemy.viewDistance) return false;
    const angleToPlayer = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    let angleDiff = angleToPlayer - enemy.angle;
    while (angleDiff <= -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    if (Math.abs(angleDiff) < enemy.viewAngle) {
        return !lineIntersectsWall(enemy.x, enemy.y, player.x, player.y);
    }
    return false;
}
