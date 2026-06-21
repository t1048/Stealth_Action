/**
 * state.js - グローバル定数・状態
 */
const TILE_SIZE = 40;
let COLS = 32;
let ROWS = 24;
const FPS = 60;

const NAV_ANNOUNCE_SECONDS = 45;

const TILE_FLOOR = 0;
const TILE_WALL = 1;
const TILE_DOOR = 2;

const ITEM_NONE = 0;
const ITEM_SPEED = 1;
const ITEM_VISION = 2;
const ITEM_CLOAK = 3;
const ITEM_KEYCARD = 4;

const ITEM_NAMES = ["NONE", "SPEED BOOST", "WIDE SONAR", "OPTICAL CLOAK", "KEYCARD"];
const ITEM_DURATIONS = [0, 300, 600, 300, 0];

const SECURITY_LAYOUT_LEVEL = 6;
const UPLOAD_LAYOUT_LEVEL = 6;
const UPLOAD_REQUIRED_TIME = FPS * 5;
const UPLOAD_COMPLETE_DISPLAY = FPS * 5;

function getItemSortPriority(type) {
    if (type === ITEM_CLOAK) return 0;
    if (type === ITEM_SPEED) return 1;
    if (type === ITEM_VISION) return 2;
    return 99;
}

function compareItemTypes(a, b) {
    return getItemSortPriority(a) - getItemSortPriority(b);
}

const THEMES = [
    { name: "LABORATORY", bgColor: "#e0e4e8", floorColor: "#f0f4f8", wallColor: "#bdc3c7", wallSideColor: "#95a5a6", gridColor: "#dce1e6", wallBorder: "#34495e" },
    { name: "FOREST RUINS", bgColor: "#1e3318", floorColor: "#3d5735", wallColor: "#5d4037", wallSideColor: "#3e2723", gridColor: "#35572d", wallBorder: "#281a14" },
    { name: "RED FORTRESS", bgColor: "#2c0e0e", floorColor: "#4f2a2a", wallColor: "#8c2d2d", wallSideColor: "#581212", gridColor: "#4f1f1f", wallBorder: "#1e0808" },
    { name: "DEEP OCEAN", bgColor: "#000510", floorColor: "#001025", wallColor: "#00e0ff", wallSideColor: "#0080a0", gridColor: "#003040", wallBorder: "#ffffff" },
    { name: "GOLDEN VAULT", bgColor: "#100500", floorColor: "#201000", wallColor: "#ffd700", wallSideColor: "#b8860b", gridColor: "#503000", wallBorder: "#ffffe0" }
];

const PLAYER_COLOR = "#008000";
const PLAYER_BORDER_COLOR = "#000000";

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const levelDisplay = document.getElementById('level-display');
const inventoryDisplay = document.getElementById('inventory-display');
const stunDisplay = document.getElementById('stun-display');
const volumeSlider = document.getElementById('volume-slider');
const notificationArea = document.getElementById('notification-area');
const keycardDisplay = document.getElementById('keycard-display');

// ゲーム状態
let gameState = "START";
let level = 1;
let currentTheme = THEMES[0];
let map = [];
let player = {};
let goal = {};
let enemies = [];
let cameras = [];
let items = [];
let particles = [];
let projectiles = [];
let keys = {};
let mouse = { x: 0, y: 0 };
let frameCount = 0;
let camera = { x: 0, y: 0 };
let securityDoor = null;
let uploadDoor = null;
let uploadTerminal = null;

let levelTime = 0;
let navActive = false;
let navMessage = {
    active: false,
    text: "＞＞ 衛星リンク確立... 目標地点ヲ特定シマシタ ＜＜",
    currentText: "",
    index: 0,
    timer: 0
};

let notificationTimer = null;
let uploadStatus = {
    active: false,
    complete: false,
    progress: 0,
    currentText: "",
    currentTarget: "",
    targetText: "＞＞ 衛星リンク確立... データ送信チュウ ＜＜",
    completeText: "＞＞ アップロード完了シマシタ ＜＜",
    timer: 0,
    completeTimer: 0
};

function showNotification(msg) {
    notificationArea.innerText = msg;
    notificationArea.style.opacity = 1;
    if (notificationTimer) clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        notificationArea.style.opacity = 0;
    }, 2000);
}

function dist(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
