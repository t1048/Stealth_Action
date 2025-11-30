/**
 * game.js - メインループ・衝突判定・イベント
 */
function initGame() {
    initAudio();
    level = 1;
    startGame();
}

function startGame() {
    createLevel();
    gameState = "PLAYING";
    levelDisplay.innerText = level;

    levelTime = 0;
    navActive = false;
    navMessage.active = false;
    navMessage.currentText = "";
    navMessage.index = 0;
    navMessage.timer = 0;

    updateHUD();

    if (isAudioInit) {
        bgmState.nextNoteTime = audioCtx.currentTime;
    }
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

function update() {
    frameCount++;

    if (gameState === "PLAYING") {
        levelTime++;
        if (!navActive && levelTime > NAV_ANNOUNCE_SECONDS * FPS) {
            navActive = true;
            navMessage.active = true;
            playSE("item_use");
        }

        if (navMessage.active) {
            navMessage.timer++;
            if (navMessage.timer % 3 === 0) {
                if (navMessage.index < navMessage.text.length) {
                    navMessage.currentText += navMessage.text[navMessage.index];
                    navMessage.index++;
                } else {
                    if (navMessage.timer > 240) {
                        navMessage.active = false;
                    }
                }
            }
        }

        updatePlayer();
        updateSecurityDoor();
        updateEnemies();
        updateCameras();
        updateProjectiles();
        checkCollisions();
        updateParticles();
        updateCamera();
        updateBGM();
    }
}

function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        if (isWall(p.x, p.y) || p.life <= 0) {
            projectiles.splice(i, 1);
            createParticles(p.x, p.y, "#0ff", 3);
            continue;
        }
    }
}

function checkCollisions() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        let hit = false;

        for (const enemy of enemies) {
            if (enemy.state === "STUNNED") continue;

            if (dist(p.x, p.y, enemy.x, enemy.y) < enemy.radius + 25) {
                playSE("stun_hit");
                enemy.state = "STUNNED";
                enemy.waitTimer = 300;
                createParticles(enemy.x, enemy.y, "#ff0", 15);
                projectiles.splice(i, 1);
                hit = true;
                break;
            }
        }
        if (hit) continue;

        for (const cam of cameras) {
            if (cam.state === "DISABLED") continue;
            if (dist(p.x, p.y, cam.x, cam.y) < 15) {
                playSE("stun_hit");
                cam.state = "DISABLED";
                cam.disableTimer = 450;
                createParticles(cam.x, cam.y, "#aaa", 10);
                showNotification("CAMERA DISABLED");
                projectiles.splice(i, 1);
                hit = true;
                break;
            }
        }
    }

    if (player.x > goal.x && player.x < goal.x + goal.w &&
        player.y > goal.y && player.y < goal.y + goal.h) {
        playSE("goal");
        levelComplete();
        return;
    }
    for (let i = 0; i < items.length; i++) {
        if (items[i].active && dist(player.x, player.y, items[i].x, items[i].y) < 25) {
            if (items[i].type === ITEM_KEYCARD) {
                items[i].active = false;
                if (!player.hasKeycard) {
                    player.hasKeycard = true;
                    playSE("item_get");
                    createParticles(items[i].x, items[i].y, "#00ffff", 8);
                    showNotification("SECURITY CARD ACQUIRED");
                    updateHUD();
                }
                continue;
            }

            if (!player.inventory) player.inventory = [];

            if (player.inventory.length >= player.maxInventorySize) {
                if (frameCount % 60 === 0) {
                    playSE("error");
                    showNotification("INVENTORY FULL");
                }
                continue;
            }

            items[i].active = false;
            player.inventory.push(items[i].type);

            if (player.selectedItemType === ITEM_NONE) {
                player.selectedItemType = items[i].type;
            }

            playSE("item_get");
            createParticles(items[i].x, items[i].y, "#ffff00", 5);
            showNotification(`GOT ${ITEM_NAMES[items[i].type]}`);
            updateHUD();
        }
    }
    for (const enemy of enemies) {
        if (enemy.state === "STUNNED") continue;

        if (dist(player.x, player.y, enemy.x, enemy.y) < player.radius + enemy.radius) {
            playSE("gameover");
            gameOver();
        }
    }
}

function levelComplete() {
    level++;
    gameState = "GOAL";
    setTimeout(() => {
        startGame();
    }, 1000);
}

function gameOver() {
    gameState = "GAMEOVER";
}

window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (e.key === "Enter") {
        if (gameState === "START" || gameState === "GAMEOVER") initGame();
    }
    if (gameState === "PLAYING") {
        if (e.key === " ") {
            useItem();
        }
        if (e.key === "q" || e.key === "Q") {
            dropItem();
        }
        if (e.key === "1") selectItemBySlot(0);
        if (e.key === "2") selectItemBySlot(1);
        if (e.key === "3") selectItemBySlot(2);
        if (e.key === "4") selectItemBySlot(3);
    }
});

window.addEventListener('keyup', e => {
    keys[e.key] = false;
});

canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouse.x = (e.clientX - rect.left) * scaleX;
    mouse.y = (e.clientY - rect.top) * scaleY;
});

canvas.addEventListener('mousedown', e => {
    if (gameState === "PLAYING") {
        fireStunGun();
    }
});

volumeSlider.addEventListener('input', e => {
    setVolume(e.target.value / 100);
});

window.addEventListener('wheel', e => {
    if (gameState === "PLAYING" && player.inventory && player.inventory.length > 0) {
        const uniqueTypes = [...new Set(player.inventory)].sort((a, b) => a - b);
        if (uniqueTypes.length === 0) return;

        let currentIndex = uniqueTypes.indexOf(player.selectedItemType);
        if (currentIndex === -1) currentIndex = 0;

        if (e.deltaY > 0) {
            currentIndex = (currentIndex + 1) % uniqueTypes.length;
        } else {
            currentIndex = (currentIndex - 1 + uniqueTypes.length) % uniqueTypes.length;
        }

        player.selectedItemType = uniqueTypes[currentIndex];
        updateHUD();
    }
});

gameLoop();
