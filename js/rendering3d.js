/**
 * rendering3d.js - Three.js描画。ゲームの(x, y)を3Dの(x, z)へ対応させる。
 */
import * as THREE from 'three';

const scene = new THREE.Scene();
const viewWidth = TILE_SIZE * 12;
const viewHeight = viewWidth * canvas.height / canvas.width;
const view = new THREE.OrthographicCamera(-viewWidth / 2, viewWidth / 2,
    viewHeight / 2, -viewHeight / 2, 1, 4000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(canvas.width, canvas.height, false);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sunlight = new THREE.DirectionalLight(0xffffff, 2.2);
sunlight.position.set(-300, 450, 200);
scene.add(sunlight);
const wallHeight = 40;

const terrain = new THREE.Group();
const actors = new THREE.Group();
scene.add(terrain, actors);
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(1, 12, 8);
const cone = new THREE.ConeGeometry(1, 1, 3);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
const ring = new THREE.TorusGeometry(1, 0.08, 8, 32);
const materials = new Map();
let renderedMap = null;
let doors = [];
let occluders = [];
const actorMeshes = new Map();
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
const ndc = new THREE.Vector2();
const fogCenter = { value: new THREE.Vector2() };
const fogRadius = { value: 180 };
const fogColor = { value: new THREE.Color('#080c12') };

function material(color, opacity = 1, glow = false) {
    const key = `${color}:${opacity}:${glow}`;
    if (!materials.has(key)) {
        const result = new THREE.MeshLambertMaterial({
            color, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
            emissive: glow ? color : '#000000', emissiveIntensity: glow ? 0.7 : 0,
            side: THREE.DoubleSide
        });
        result.onBeforeCompile = shader => {
            shader.uniforms.fogCenter = fogCenter;
            shader.uniforms.fogRadius = fogRadius;
            shader.uniforms.fogColor = fogColor;
            shader.vertexShader = 'varying vec2 groundPosition;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
                '#include <begin_vertex>\ngroundPosition = (modelMatrix * vec4(position, 1.0)).xz;');
            shader.fragmentShader = 'varying vec2 groundPosition;\nuniform vec2 fogCenter;\nuniform float fogRadius;\nuniform vec3 fogColor;\n' + shader.fragmentShader;
            // 線形色空間でテーマの暗色へ滑らかに混ぜ、背景と黒い壁の境目を消す。
            shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>',
                'gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogRadius - 60.0, fogRadius, distance(groundPosition, fogCenter)));\n#include <tonemapping_fragment>');
        };
        materials.set(key, result);
    }
    return materials.get(key);
}

function mesh(group, geometry, color, x, y, height, sx, sy, sz, opacity = 1) {
    const object = new THREE.Mesh(geometry, material(color, opacity));
    object.position.set(x, height, y);
    object.scale.set(sx, sy, sz);
    group.add(object);
    return object;
}

function rebuildTerrain() {
    terrain.clear();
    actors.clear();
    actorMeshes.clear();
    doors = [];
    occluders = [];
    renderedMap = map;
    fogColor.value.set(currentTheme.bgColor).multiplyScalar(0.01);
    scene.background = fogColor.value;
    mesh(terrain, box, currentTheme.floorColor, COLS * TILE_SIZE / 2,
        ROWS * TILE_SIZE / 2, -3, COLS * TILE_SIZE, 6, ROWS * TILE_SIZE);
    // 壁はレベルごとに一度だけ構築する。
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (map[y][x] === TILE_WALL) {
                occluders.push(mesh(terrain, box, currentTheme.wallColor, (x + 0.5) * TILE_SIZE,
                    (y + 0.5) * TILE_SIZE, wallHeight / 2, TILE_SIZE, wallHeight, TILE_SIZE));
            } else if (map[y][x] === TILE_DOOR) {
                const object = mesh(terrain, box, '#00aaff', (x + 0.5) * TILE_SIZE,
                    (y + 0.5) * TILE_SIZE, wallHeight / 2, TILE_SIZE, wallHeight, TILE_SIZE);
                doors.push({ x, y, object });
                occluders.push(object);
            }
        }
    }
    mesh(terrain, box, '#0044ff', goal.x + goal.w / 2,
        goal.y + goal.h / 2, 6, goal.w, 12, goal.h);
    mesh(terrain, cylinder, '#00aaff', goal.x + goal.w / 2,
        goal.y + goal.h / 2, 28, 12, 32, 12);
}

function updateView() {
    // 仰角75度、北を画面上に保った追従。入力と描画で同じ行列を使う。
    view.position.set(player.x, 700, player.y + 700 / Math.tan(75 * Math.PI / 180));
    view.lookAt(player.x, 0, player.y);
    view.updateMatrixWorld();
}

function screenToWorld(x, y, target) {
    ndc.set(x / canvas.width * 2 - 1, 1 - y / canvas.height * 2);
    raycaster.setFromCamera(ndc, view);
    if (!raycaster.ray.intersectPlane(ground, hit)) return false;
    target.x = hit.x;
    target.y = hit.z;
    return true;
}

function worldToScreen(x, y) {
    const position = new THREE.Vector3(x, 0, y).project(view);
    return { x: (position.x + 1) * canvas.width / 2, y: (1 - position.y) * canvas.height / 2 };
}

function getGroundView() {
    // 描画・照準と同じカメラ行列から、地面上の表示範囲を得る。
    const topLeft = {};
    const bottomRight = {};
    screenToWorld(0, 0, topLeft);
    screenToWorld(canvas.width, canvas.height, bottomRight);
    return { x: Math.min(topLeft.x, bottomRight.x), y: Math.min(topLeft.y, bottomRight.y),
        width: Math.abs(bottomRight.x - topLeft.x), height: Math.abs(bottomRight.y - topLeft.y) };
}

function visibleAt(x, y) {
    return player.activeEffect === ITEM_VISION || dist(player.x, player.y, x, y) <= player.visibleRadius;
}

function isOccluded(x, y, height) {
    const target = new THREE.Vector3(x, height, y);
    const screen = target.clone().project(view);
    ndc.set(screen.x, screen.y);
    raycaster.setFromCamera(ndc, view);
    const distance = raycaster.ray.origin.distanceTo(target);
    // 初回描画直後やドア解錠直後も最新の変換行列で遮蔽を判定する。
    terrain.updateMatrixWorld(true);
    return raycaster.intersectObjects(occluders, false).some(result => result.distance < distance - 1);
}

function actor(entity, geometry, color, height, sx, sy, sz, opacity = 1) {
    let object = actorMeshes.get(entity);
    if (!object) {
        object = mesh(actors, geometry, color, entity.x, entity.y, height, sx, sy, sz, opacity);
        actorMeshes.set(entity, object);
    }
    object.material = material(color, opacity);
    object.position.set(entity.x, height, entity.y);
    object.scale.set(sx, sy, sz);
    object.visible = visibleAt(entity.x, entity.y);
    return object;
}

function createHumanModel(isPlayer) {
    const model = new THREE.Group();
    model.name = isPlayer ? 'AGENT' : 'GUARD';
    const figure = new THREE.Group();
    model.add(figure);
    const parts = [];
    function part(name, parent, geometry, color, x, y, z, sx, sy, sz, uniform = false, glow = false) {
        const object = mesh(parent, geometry, color, x, z, y, sx, sy, sz);
        object.name = name;
        parts.push({ object, color, uniform, glow });
        return object;
    }
    const suit = isPlayer ? '#1b2836' : '#344b73';
    part('torso', figure, box, suit, 0, 25, 0, 11, 16, 16, true);
    part('vest', figure, box, isPlayer ? '#3d5668' : '#7088a8', 5, 25, 0, 2, 12, 13);
    part('head', figure, sphere, isPlayer ? '#27394a' : '#c9a78b', 0, 36, 0, 6, 6, 6);
    if (isPlayer) {
        part('backpack', figure, box, '#101820', -7, 25, 0, 5, 12, 12);
        part('visor', figure, box, '#39e4c8', 5.5, 37, 0, 2, 4, 11, false, true);
        part('goggles-top', figure, box, '#39e4c8', 4, 40, 0, 5, 1.5, 10, false, true);
    } else {
        part('helmet', figure, cylinder, suit, 0, 40, 0, 7, 4, 7, true);
        part('helmet-brim', figure, box, '#26354f', 3, 38, 0, 16, 1.5, 15);
        part('badge', figure, box, '#ffd36b', 6.5, 28, -3, 1, 4, 3);
    }
    function limb(name, y, z, length, width) {
        const pivot = new THREE.Group();
        pivot.name = name;
        pivot.position.set(0, y, z);
        figure.add(pivot);
        part(name + '-suit', pivot, box, suit, 0, -length / 2, 0, width, length, width, true);
        return pivot;
    }
    const leftLeg = limb('left-leg', 17, -5, 14, 6);
    const rightLeg = limb('right-leg', 17, 5, 14, 6);
    part('left-boot', leftLeg, box, '#101820', 2, -15, 0, 12, 4, 7);
    part('right-boot', rightLeg, box, '#101820', 2, -15, 0, 12, 4, 7);
    const leftArm = limb('left-arm', 30, -11, 12, 5);
    const rightArm = limb('right-arm', 30, 11, 12, 5);
    part('left-glove', leftArm, sphere, '#101820', 0, -12, 0, 3, 3, 3);
    part('right-glove', rightArm, sphere, '#101820', 0, -12, 0, 3, 3, 3);
    if (isPlayer) {
        // ローカル+Xが前方。腕と銃を照準の方向へ向ける。
        part('stun-gun', rightArm, box, '#14252b', 0, -16, 0, 4, 13, 5);
        part('gun-muzzle', rightArm, box, '#39e4c8', 0, -23, 0, 4, 1, 4, false, true);
    }
    const stunMark = new THREE.Group();
    model.add(stunMark);
    part('stun-ring', stunMark, ring, '#ffe45c', 20, 24, 0, 9, 9, 9, false, true).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
        const angle = i * Math.PI * 2 / 3;
        part('stun-star-' + i, stunMark, sphere, '#ffe45c',
            20 + Math.cos(angle) * 9, 24, Math.sin(angle) * 9, 2, 2, 2, false, true);
    }
    stunMark.visible = false;
    model.userData = { figure, parts, leftLeg, rightLeg, leftArm, rightArm, stunMark,
        lastX: null, lastY: null, lastFrame: -1, phase: 0, swing: 0 };
    return model;
}

function drawHuman(entity, isPlayer) {
    let model = actorMeshes.get(entity);
    if (!model) {
        model = createHumanModel(isPlayer);
        actors.add(model);
        actorMeshes.set(entity, model);
    }
    const pose = model.userData;
    const stunned = !isPlayer && entity.state === 'STUNNED';
    const opacity = isPlayer && entity.activeEffect === ITEM_CLOAK ? 0.4 : 1;
    const suit = isPlayer ? '#1b2836' : stunned ? '#555b67' :
        entity.state === 'CHASE' ? '#a32e35' : entity.state === 'ALERT' ? '#b37624' : '#344b73';
    pose.parts.forEach(({ object, color, uniform, glow }) => {
        object.material = material(uniform ? suit : color, opacity, glow);
    });
    // 実際の座標差だけで歩行する。壁に阻まれた入力や古いdx/dyでは動かさない。
    if (pose.lastFrame !== frameCount) {
        const distance = pose.lastX === null ? 0 : dist(pose.lastX, pose.lastY, entity.x, entity.y);
        if (gameState === 'PLAYING' && !stunned && distance > 0.001) {
            pose.phase += Math.min(distance, 5) * 0.35;
            pose.swing = Math.sin(pose.phase) * 0.45;
        } else {
            pose.swing = 0;
        }
        pose.lastX = entity.x;
        pose.lastY = entity.y;
        pose.lastFrame = frameCount;
    }
    if (stunned || gameState !== 'PLAYING') pose.swing = 0;
    pose.leftLeg.rotation.z = pose.swing;
    pose.rightLeg.rotation.z = -pose.swing;
    pose.leftArm.rotation.z = -pose.swing * 0.7;
    pose.rightArm.rotation.z = isPlayer ? Math.PI / 2 + pose.swing * 0.1 : pose.swing * 0.7;
    pose.figure.rotation.z = stunned ? -Math.PI / 2 : 0;
    pose.figure.position.y = stunned ? 9 : 0;
    pose.stunMark.visible = stunned;
    model.position.set(entity.x, 0, entity.y);
    model.rotation.y = -entity.angle;
    model.visible = visibleAt(entity.x, entity.y);
}

function createItemModel(type) {
    const group = new THREE.Group();
    group.name = ITEM_NAMES[type];
    function part(name, geometry, color, x, y, z, sx, sy, sz, opacity = 1, glow = false) {
        const object = mesh(group, geometry, color, x, z, y, sx, sy, sz, opacity);
        object.name = name;
        object.material = material(color, opacity, glow);
        return object;
    }
    if (type === ITEM_SPEED) {
        part('sole', box, '#ff8c00', 0, -7, 3, 12, 5, 22, 1, true);
        part('boot', box, '#ffcf33', 0, 1, -3, 10, 12, 9, 1, true);
        part('toe', box, '#ffcf33', 0, -3, 10, 12, 7, 10, 1, true);
        part('left-wing', cone, '#fff19a', -8, 4, -3, 3, 13, 4, 1, true).rotation.z = 0.8;
        part('right-wing', cone, '#fff19a', 8, 4, -3, 3, 13, 4, 1, true).rotation.z = -0.8;
    } else if (type === ITEM_VISION) {
        part('core', sphere, '#64eaff', 0, 0, 0, 7, 7, 7, 1, true);
        part('inner-wave', ring, '#00dfff', 0, 0, 0, 12, 12, 12, 0.85, true).rotation.x = Math.PI / 2;
        part('outer-wave', ring, '#8af6ff', 0, 0, 0, 17, 17, 17, 0.5, true).rotation.x = Math.PI / 2;
    } else if (type === ITEM_CLOAK) {
        part('shield', sphere, '#943dff', 0, 0, 0, 13, 3, 17, 0.4);
        part('shield-rim', ring, '#c28aff', 0, 0, 0, 13, 17, 13, 0.7, true).rotation.x = Math.PI / 2;
        part('shield-core', sphere, '#d2aaff', 0, 3, 0, 4, 4, 4, 0.6, true);
    } else if (type === ITEM_KEYCARD) {
        // 板を分割し、上端のストラップ穴を実際に抜く。
        part('card', box, '#c0f5ff', 0, 0, 4, 22, 2, 24);
        part('top-edge', box, '#c0f5ff', 0, 0, -15, 22, 2, 2);
        part('left-edge', box, '#c0f5ff', -7.5, 0, -11, 7, 2, 6);
        part('right-edge', box, '#c0f5ff', 7.5, 0, -11, 7, 2, 6);
        part('magnetic-stripe', box, '#15202c', 0, 1.2, -4, 20, 0.4, 3);
        part('chip', box, '#ffcf33', -5, 1.3, 5, 5, 0.6, 5);
    }
    return group;
}

function drawItem(item) {
    let object = actorMeshes.get(item);
    if (!object) {
        object = createItemModel(item.type);
        actors.add(object);
        actorMeshes.set(item, object);
    }
    const time = frameCount / FPS;
    const bob = item.type === ITEM_CLOAK ? 4 : 2;
    object.position.set(item.x, 24 + Math.sin(time * 2 + item.type) * bob, item.y);
    object.rotation.y = time * (item.type === ITEM_KEYCARD ? 0.3 : 0.8);
    object.visible = visibleAt(item.x, item.y);
    if (item.type === ITEM_VISION) {
        object.children[1].rotation.x = Math.PI / 2 + Math.sin(time) * 0.3;
        object.children[2].rotation.x = Math.PI / 2 - Math.sin(time) * 0.3;
    } else if (item.type === ITEM_CLOAK || item.type === ITEM_KEYCARD) {
        object.rotation.x = Math.sin(time) * 0.15;
    }
}

function draw3D() {
    if (gameState === 'START') {
        scene.background = new THREE.Color('#111111');
        renderer.render(scene, view);
        return;
    }
    if (renderedMap !== map) rebuildTerrain();
    updateView();
    // 既存の視界半径を床と壁にも適用する（ゲームの判定は変更しない）。
    fogCenter.value.set(player.x, player.y);
    fogRadius.value = player.activeEffect === ITEM_VISION ? 100000 : player.visibleRadius;
    doors.forEach(({ x, y, object }) => {
        const info = getDoorInfoAt(x, y);
        object.scale.y = info && info.locked ? wallHeight : 2;
        object.position.y = object.scale.y / 2;
        object.material = material(info && info.type === 'UPLOAD' ? '#c800ff' : '#00aaff');
    });
    const live = new Set([player, ...enemies, ...cameras, ...items.filter(item => item.active),
        ...projectiles, ...particles]);
    if (uploadTerminal) live.add(uploadTerminal);
    actorMeshes.forEach((object, entity) => {
        if (!live.has(entity)) { actors.remove(object); actorMeshes.delete(entity); }
    });
    drawHuman(player, true);
    enemies.forEach(enemy => drawHuman(enemy, false));
    cameras.forEach(cam => {
        const object = actor(cam, box, cam.state === 'DISABLED' ? '#555555' : '#00ff00', 38, 20, 18, 14);
        object.rotation.y = -cam.currentAngle;
    });
    items.filter(item => item.active).forEach(drawItem);
    projectiles.forEach(p => actor(p, sphere, '#00ffff', 9, 4, 4, 4));
    particles.forEach(p => actor(p, sphere, p.color, 5, 2, 2, 2, Math.max(0.05, p.life / 30)));
    if (uploadTerminal) {
        const object = actor(uploadTerminal, box, uploadStatus.complete ? '#00ffff' : '#c800ff',
            3, uploadTerminal.w, 6, uploadTerminal.h);
        object.position.x += uploadTerminal.w / 2;
        object.position.z += uploadTerminal.h / 2;
    }
    renderer.render(scene, view);
}

renderer3D = { draw: draw3D, updateCamera: updateView, screenToWorld, worldToScreen, isOccluded, getGroundView };
gameLoop();
