/**
 * player.js - プレイヤー操作・アイテム・射撃
 */
function updatePlayer() {
    if (player.activeEffect !== ITEM_NONE) {
        player.effectTimer--;
        if (player.effectTimer <= 0) {
            player.activeEffect = ITEM_NONE;
            player.speed = player.baseSpeed;
            player.visibleRadius = 180;
        }
    }
    player.dx = 0;
    player.dy = 0;
    if (keys['ArrowUp'] || keys['w']) player.dy = -player.speed;
    if (keys['ArrowDown'] || keys['s']) player.dy = player.speed;
    if (keys['ArrowLeft'] || keys['a']) player.dx = -player.speed;
    if (keys['ArrowRight'] || keys['d']) player.dx = player.speed;

    moveEntity(player);

    const playerScreenX = player.x - camera.x;
    const playerScreenY = player.y - camera.y;
    player.angle = Math.atan2(mouse.y - playerScreenY, mouse.x - playerScreenX);
}

function useItem() {
    if (!player.inventory || player.inventory.length === 0) return;
    if (player.selectedItemType === ITEM_NONE) return;

    const index = player.inventory.indexOf(player.selectedItemType);
    if (index === -1) return;

    playSE("item_use");
    player.activeEffect = player.selectedItemType;
    player.effectTimer = ITEM_DURATIONS[player.activeEffect];

    if (player.activeEffect === ITEM_SPEED) player.speed = player.baseSpeed * 1.8;
    else if (player.activeEffect === ITEM_VISION) player.visibleRadius = 400;
    else if (player.activeEffect === ITEM_CLOAK) player.speed = player.baseSpeed * 0.6;

    createParticles(player.x, player.y, "#fff", 10);

    player.inventory.splice(index, 1);

    if (!player.inventory.includes(player.selectedItemType)) {
        if (player.inventory.length > 0) {
            const unique = [...new Set(player.inventory)].sort(compareItemTypes);
            player.selectedItemType = unique[0];
        } else {
            player.selectedItemType = ITEM_NONE;
        }
    }

    updateHUD();
}

function dropItem() {
    if (!player.inventory || player.inventory.length === 0) return;
    if (player.selectedItemType === ITEM_NONE) return;

    const index = player.inventory.indexOf(player.selectedItemType);
    if (index === -1) return;

    player.inventory.splice(index, 1);
    playSE("item_drop");
    showNotification("ITEM DISCARDED");

    if (!player.inventory.includes(player.selectedItemType)) {
        if (player.inventory.length > 0) {
            const unique = [...new Set(player.inventory)].sort(compareItemTypes);
            player.selectedItemType = unique[0];
        } else {
            player.selectedItemType = ITEM_NONE;
        }
    }
    updateHUD();
}

function selectItemBySlot(slotIndex) {
    if (!player.inventory || player.inventory.length === 0) return;
    const uniqueTypes = [...new Set(player.inventory)].sort(compareItemTypes);

    if (slotIndex < uniqueTypes.length) {
        player.selectedItemType = uniqueTypes[slotIndex];
        updateHUD();
    }
}

function fireStunGun() {
    if (player.stunAmmo > 0) {
        player.stunAmmo--;
        playSE("stun_fire");
        updateHUD();

        projectiles.push({
            x: player.x,
            y: player.y,
            vx: Math.cos(player.angle) * 14,
            vy: Math.sin(player.angle) * 14,
            life: 60,
            type: "STUN"
        });

        createParticles(player.x + Math.cos(player.angle) * 10, player.y + Math.sin(player.angle) * 10, "#0ff", 5);
    }
}

function updateCamera() {
    let targetX = player.x - canvas.width / 2;
    let targetY = player.y - canvas.height / 2;
    const mapWidth = COLS * TILE_SIZE;
    const mapHeight = ROWS * TILE_SIZE;
    targetX = Math.max(0, Math.min(targetX, mapWidth - canvas.width));
    targetY = Math.max(0, Math.min(targetY, mapHeight - canvas.height));
    camera.x = targetX;
    camera.y = targetY;
}

function updateHUD() {
    let inventoryHtml = "";

    const counts = {};
    const uniqueTypes = [];
    let totalItems = 0;

    if (player.inventory) {
        player.inventory.forEach(type => {
            if (!counts[type]) {
                counts[type] = 0;
                uniqueTypes.push(type);
            }
            counts[type]++;
        });
        totalItems = player.inventory.length;
    }

    uniqueTypes.sort(compareItemTypes);

    if (uniqueTypes.length === 0) {
        inventoryHtml = `<div class="hud-item" style="color:#555">EMPTY (${totalItems}/${player.maxInventorySize})</div>`;
    } else {
        uniqueTypes.forEach((type, index) => {
            let name = ITEM_NAMES[type];
            let shortName = name.split(" ")[0];
            if (type === ITEM_SPEED) shortName = "SPEED";
            if (type === ITEM_VISION) shortName = "SONAR";
            if (type === ITEM_CLOAK) shortName = "CLOAK";

            let color = "#aaa";
            if (type === ITEM_SPEED) color = "#0ff";
            if (type === ITEM_VISION) color = "#0f0";
            if (type === ITEM_CLOAK) color = "#f0f";

            const count = counts[type];
            const isSelected = (type === player.selectedItemType);
            const slotNum = index + 1;

            let classNames = "inventory-slot";
            if (isSelected) classNames += " selected";

            inventoryHtml += `
            <div class="${classNames}">
                <div class="slot-key">${slotNum}</div>
                <div style="color:${color}; font-weight:bold;">${shortName}</div>
                <div style="font-size:12px; margin-top:2px;">x${count}</div>
            </div>`;
        });
        inventoryHtml += `<div style="display:flex; align-items:center; font-size:12px; margin-left:10px; color:#aaa;">CAP: ${totalItems}/${player.maxInventorySize}</div>`;
    }

    inventoryDisplay.innerHTML = inventoryHtml;

    if (stunDisplay) {
        stunDisplay.innerHTML = player.stunAmmo > 0
            ? `<span style="color:#0ff">READY x${player.stunAmmo}</span>`
            : `<span style="color:#555">EMPTY</span>`;
    }

    if (keycardDisplay) {
        if (player.hasKeycard) {
            keycardDisplay.innerHTML = `<span style="color:#0ff">CARD: READY</span>`;
        } else {
            keycardDisplay.innerHTML = `CARD: NONE`;
        }
    }
}
