/**
 * rendering.js - 描画とビジュアルエフェクト
 */
function drawWall(x, y, theme) {
    const tx = x * TILE_SIZE;
    const ty = y * TILE_SIZE;

    const seed = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const rand = seed - Math.floor(seed);

    let type = 0;
    if (theme.name === "LABORATORY") {
        if (rand < 0.25) type = 0;
        else if (rand < 0.50) type = 1;
        else if (rand < 0.80) type = 2;
        else type = 3;
    } else {
        if (rand < 0.40) type = 0;
        else if (rand < 0.80) type = 1;
        else if (rand < 0.98) type = 3;
        else type = 2;
    }

    ctx.fillStyle = theme.wallColor;
    ctx.fillRect(tx, ty, TILE_SIZE, TILE_SIZE);

    ctx.strokeStyle = theme.wallBorder;
    ctx.lineWidth = 2;
    ctx.fillStyle = theme.wallSideColor;

    if (type === 0) {
        ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        ctx.beginPath();
        for (let i = 1; i <= 3; i++) {
            let yPos = ty + (TILE_SIZE * i / 4);
            ctx.moveTo(tx + 4, yPos);
            ctx.lineTo(tx + TILE_SIZE - 4, yPos);
        }
        ctx.stroke();
        ctx.strokeRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    } else if (type === 1) {
        ctx.fillRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
        ctx.beginPath();
        ctx.moveTo(tx + 4, ty + 4);
        ctx.lineTo(tx + TILE_SIZE - 4, ty + TILE_SIZE - 4);
        ctx.moveTo(tx + TILE_SIZE - 4, ty + 4);
        ctx.lineTo(tx + 4, ty + TILE_SIZE - 4);
        ctx.stroke();
        ctx.strokeRect(tx + 4, ty + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    } else if (type === 2) {
        ctx.fillRect(tx + 2, ty + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.fillStyle = (Math.floor(Date.now() / 500) + x + y) % 2 === 0 ? "#0f0" : "#222";
        ctx.fillRect(tx + 8, ty + 8, 6, 6);
        ctx.fillStyle = (Math.floor(Date.now() / 300) + x + y) % 2 === 0 ? "#f00" : "#222";
        ctx.fillRect(tx + 18, ty + 8, 6, 6);

        ctx.fillStyle = theme.wallBorder;
        ctx.fillRect(tx + 6, ty + 24, TILE_SIZE - 12, 4);
        ctx.fillRect(tx + 6, ty + 30, TILE_SIZE - 12, 4);
    } else {
        ctx.fillRect(tx + 5, ty + 5, TILE_SIZE - 10, TILE_SIZE - 10);
        ctx.fillStyle = theme.wallBorder;
        const b = 4;
        ctx.fillRect(tx + 2, ty + 2, b, b);
        ctx.fillRect(tx + TILE_SIZE - 2 - b, ty + 2, b, b);
        ctx.fillRect(tx + 2, ty + TILE_SIZE - 2 - b, b, b);
        ctx.fillRect(tx + TILE_SIZE - 2 - b, ty + TILE_SIZE - 2 - b, b, b);
        ctx.strokeRect(tx + 5, ty + 5, TILE_SIZE - 10, TILE_SIZE - 10);
    }
}

function draw() {
    ctx.fillStyle = currentTheme.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === "START") {
        drawCenterText("STEALTH ROGUE", "Press ENTER to Start", "#0f0");
        return;
    }

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    const startCol = Math.floor(camera.x / TILE_SIZE);
    const endCol = startCol + (canvas.width / TILE_SIZE) + 1;
    const startRow = Math.floor(camera.y / TILE_SIZE);
    const endRow = startRow + (canvas.height / TILE_SIZE) + 1;

    for (let y = Math.max(0, startRow); y < Math.min(ROWS, endRow); y++) {
        for (let x = Math.max(0, startCol); x < Math.min(COLS, endCol); x++) {
            if (map[y][x] === TILE_WALL) {
                drawWall(x, y, currentTheme);
            } else if (map[y][x] === TILE_DOOR) {
                const doorInfo = getDoorInfoAt(x, y);
                if (doorInfo && doorInfo.locked) {
                    const isUploadDoor = doorInfo.type === "UPLOAD";
                    ctx.fillStyle = isUploadDoor ? "#1a0428" : "#0a2138";
                    ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    ctx.fillStyle = isUploadDoor ? "#c800ff" : "#0af";
                    ctx.fillRect(x * TILE_SIZE + 6, y * TILE_SIZE + 4, TILE_SIZE - 12, TILE_SIZE - 8);
                    ctx.strokeStyle = "#fff";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x * TILE_SIZE + 6, y * TILE_SIZE + 4, TILE_SIZE - 12, TILE_SIZE - 8);
                } else {
                    ctx.fillStyle = currentTheme.floorColor;
                    ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    ctx.strokeStyle = currentTheme.gridColor;
                    ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                }
            } else {
                ctx.fillStyle = currentTheme.floorColor;
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                ctx.strokeStyle = currentTheme.gridColor;
                ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    ctx.fillStyle = "#00f";
    ctx.fillRect(goal.x, goal.y, goal.w, goal.h);

    if (uploadTerminal) {
        ctx.fillStyle = uploadStatus.complete ? "rgba(0, 255, 255, 0.2)" : "rgba(80, 0, 180, 0.2)";
        ctx.fillRect(uploadTerminal.x + 4, uploadTerminal.y + 4, uploadTerminal.w - 8, uploadTerminal.h - 8);
        ctx.strokeStyle = uploadStatus.complete ? "#0ff" : "#c800ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(uploadTerminal.x + 4, uploadTerminal.y + 4, uploadTerminal.w - 8, uploadTerminal.h - 8);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.fillText("UPLOAD", uploadTerminal.x + uploadTerminal.w / 2, uploadTerminal.y + uploadTerminal.h / 2 + 4);
    }

    items.forEach(item => {
        if (item.active) {
            ctx.fillStyle = item.type === ITEM_KEYCARD ? "#0ff" : "#ff0";
            ctx.beginPath();
            ctx.arc(item.x, item.y, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            let char = "?";
            if (item.type === ITEM_SPEED) char = "S";
            if (item.type === ITEM_VISION) char = "V";
            if (item.type === ITEM_CLOAK) char = "C";
            if (item.type === ITEM_KEYCARD) char = "K";
            ctx.fillText(char, item.x, item.y + 4);
        }
    });

    cameras.forEach(cam => {
        if (cam.state === "DISABLED") {
            ctx.fillStyle = "#333";
            ctx.beginPath();
            ctx.arc(cam.x, cam.y, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#888";
            ctx.beginPath();
            ctx.moveTo(cam.x - 4, cam.y - 4); ctx.lineTo(cam.x + 4, cam.y + 4);
            ctx.moveTo(cam.x + 4, cam.y - 4); ctx.lineTo(cam.x - 4, cam.y + 4);
            ctx.stroke();
            return;
        }

        ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
        ctx.beginPath();
        ctx.arc(cam.x, cam.y, cam.viewDistance, cam.currentAngle - cam.viewAngle, cam.currentAngle + cam.viewAngle, false);
        ctx.arc(cam.x, cam.y, cam.blindRadius, cam.currentAngle + cam.viewAngle, cam.currentAngle - cam.viewAngle, true);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = "rgba(0, 255, 0, 0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#0f0";
        ctx.beginPath();
        ctx.arc(cam.x, cam.y, 6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#000";
        ctx.beginPath();
        ctx.moveTo(cam.x, cam.y);
        ctx.lineTo(cam.x + Math.cos(cam.currentAngle) * 10, cam.y + Math.sin(cam.currentAngle) * 10);
        ctx.stroke();
    });

    ctx.strokeStyle = PLAYER_BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = player.activeEffect === ITEM_CLOAK ? "rgba(0, 128, 0, 0.4)" : PLAYER_COLOR;
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = PLAYER_BORDER_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + Math.cos(player.angle) * 25, player.y + Math.sin(player.angle) * 25);
    ctx.stroke();

    enemies.forEach(enemy => {
        if (enemy.state === "STUNNED") {
            ctx.fillStyle = "#555";
            ctx.beginPath();
            ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = "#ff0";
            ctx.lineWidth = 1;
            ctx.beginPath();
            const time = Date.now() / 100;
            ctx.moveTo(enemy.x + Math.cos(time) * 10, enemy.y + Math.sin(time) * 10);
            ctx.lineTo(enemy.x + Math.cos(time + 2.1) * 10, enemy.y + Math.sin(time + 2.1) * 10);
            ctx.lineTo(enemy.x + Math.cos(time + 4.2) * 10, enemy.y + Math.sin(time + 4.2) * 10);
            ctx.closePath();
            ctx.stroke();
            return;
        }

        if (enemy.state === "CHASE") {
            ctx.fillStyle = "rgba(255, 50, 50, 0.5)";
        } else if (enemy.state === "ALERT") {
            ctx.fillStyle = "rgba(255, 165, 0, 0.4)";
        } else {
            ctx.fillStyle = "rgba(255, 255, 50, 0.4)";
        }

        ctx.beginPath();
        ctx.moveTo(enemy.x, enemy.y);
        ctx.arc(enemy.x, enemy.y, enemy.viewDistance, enemy.angle - enemy.viewAngle, enemy.angle + enemy.viewAngle);
        ctx.lineTo(enemy.x, enemy.y);
        ctx.fill();

        ctx.fillStyle = enemy.state === "CHASE" ? "#f00" : "#d00";
        if (enemy.state === "ALERT") ctx.fillStyle = "orange";

        ctx.beginPath();
        const s = 10;
        ctx.moveTo(enemy.x + Math.cos(enemy.angle) * s, enemy.y + Math.sin(enemy.angle) * s);
        ctx.lineTo(enemy.x + Math.cos(enemy.angle + 2.5) * s, enemy.y + Math.sin(enemy.angle + 2.5) * s);
        ctx.lineTo(enemy.x + Math.cos(enemy.angle - 2.5) * s, enemy.y + Math.sin(enemy.angle - 2.5) * s);
        ctx.fill();

        if (enemy.state === "CHASE") {
            ctx.fillStyle = "red";
            ctx.font = "20px Arial";
            ctx.fillText("!", enemy.x, enemy.y - 20);
        } else if (enemy.state === "ALERT") {
            ctx.fillStyle = "orange";
            ctx.font = "20px Arial";
            ctx.fillText("?", enemy.x, enemy.y - 20);
        }
    });

    projectiles.forEach(p => {
        ctx.fillStyle = "#0ff";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 255, 255, 0.5)";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
        ctx.stroke();
    });

    if (navActive) {
        const goalCX = goal.x + goal.w / 2;
        const goalCY = goal.y + goal.h / 2;
        const angleToGoal = Math.atan2(goalCY - player.y, goalCX - player.x);
        const distFromPlayer = 60;

        const ax = player.x + Math.cos(angleToGoal) * distFromPlayer;
        const ay = player.y + Math.sin(angleToGoal) * distFromPlayer;

        if (Math.floor(Date.now() / 200) % 2 === 0) {
            ctx.fillStyle = "#0ff";
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - Math.cos(angleToGoal - 0.5) * 15, ay - Math.sin(angleToGoal - 0.5) * 15);
            ctx.lineTo(ax - Math.cos(angleToGoal + 0.5) * 15, ay - Math.sin(angleToGoal + 0.5) * 15);
            ctx.fill();
        }
    }

    drawParticles();

    if (player.activeEffect !== ITEM_VISION) {
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.rect(camera.x, camera.y, canvas.width, canvas.height);
        ctx.arc(player.x, player.y, player.visibleRadius, 0, Math.PI * 2, true);
        ctx.fill();
    } else {
        ctx.fillStyle = "rgba(0, 50, 0, 0.2)";
        ctx.fillRect(camera.x, camera.y, canvas.width, canvas.height);
    }

    if (player.activeEffect !== ITEM_NONE) {
        const pct = player.effectTimer / ITEM_DURATIONS[player.activeEffect];
        ctx.fillStyle = "#0ff";
        ctx.fillRect(player.x - 15, player.y + 20, 30 * pct, 4);

        ctx.fillStyle = "#0ff";
        ctx.font = "10px Arial";
        let shortName = "BUFF";
        if (player.activeEffect === ITEM_SPEED) shortName = "SPD";
        if (player.activeEffect === ITEM_VISION) shortName = "VIS";
        if (player.activeEffect === ITEM_CLOAK) shortName = "CLK";
        ctx.textAlign = "center";
        ctx.fillText(shortName, player.x, player.y - 15);
    }

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "14px Arial";
    ctx.textAlign = "left";
    ctx.fillText(currentTheme.name, camera.x + 10, camera.y + canvas.height - 10);

    ctx.restore();

    ctx.strokeStyle = "#0f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 10, 0, Math.PI * 2);
    ctx.moveTo(mouse.x - 15, mouse.y);
    ctx.lineTo(mouse.x + 15, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 15);
    ctx.lineTo(mouse.x, mouse.y + 15);
    ctx.stroke();

    drawUploadUI();

    if (navMessage.active) {
        ctx.fillStyle = "rgba(0, 20, 0, 0.85)";
        ctx.fillRect(0, canvas.height - 100, canvas.width, 50);

        ctx.strokeStyle = "#0f0";
        ctx.lineWidth = 1;
        ctx.strokeRect(0, canvas.height - 100, canvas.width, 50);

        ctx.fillStyle = "#0f0";
        ctx.font = "bold 20px Courier New";
        ctx.textAlign = "center";
        ctx.fillText(navMessage.currentText, canvas.width / 2, canvas.height - 68);
    }

    if (gameState === "GAMEOVER") {
        drawCenterText("GAME OVER", "Press ENTER to Retry", "#f00");
    } else if (gameState === "GOAL") {
        drawCenterText("LEVEL CLEARED", "Next Level...", "#0ff");
    }
}

function drawUploadUI() {
    if (!uploadTerminal) return;
    if (!uploadStatus.active && !uploadStatus.complete && uploadStatus.progress <= 0) return;
    if (uploadStatus.complete && uploadStatus.completeTimer > UPLOAD_COMPLETE_DISPLAY) return;

    const boxY = canvas.height - 160;
    const barWidth = canvas.width - 80;
    const pct = Math.min(1, uploadStatus.progress / UPLOAD_REQUIRED_TIME);
    const displayText = uploadStatus.currentText.length > 0
        ? uploadStatus.currentText
        : (uploadStatus.complete ? uploadStatus.completeText : uploadStatus.targetText);

    ctx.fillStyle = "rgba(10, 0, 20, 0.85)";
    ctx.fillRect(0, boxY, canvas.width, 60);

    ctx.strokeStyle = "#c800ff";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, boxY, canvas.width, 60);

    ctx.fillStyle = "#c800ff";
    ctx.font = "bold 18px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(displayText, canvas.width / 2, boxY + 22);

    ctx.strokeStyle = "#300046";
    ctx.strokeRect(40, boxY + 32, barWidth, 12);
    ctx.fillStyle = uploadStatus.complete ? "#0ff" : "#c800ff";
    ctx.fillRect(40, boxY + 32, barWidth * pct, 12);
}

function drawCenterText(main, sub, color) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = color;
    ctx.font = "40px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(main, canvas.width / 2, canvas.height / 2 - 20);

    ctx.fillStyle = "#fff";
    ctx.font = "20px Courier New";
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 20);
}

function createParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 30,
            color: color
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles() {
    particles.forEach(p => {
        ctx.globalAlpha = p.life / 30;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 4, 4);
    });
    ctx.globalAlpha = 1.0;
}
