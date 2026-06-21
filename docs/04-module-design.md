# 04 モジュール詳細設計書

各 JavaScript ファイルの責務、主要関数、参照するグローバル変数を定義する。

---

## 1. js/state.js

**責務:** 定数定義、グローバル状態変数、DOM 参照、共通ユーティリティ

### 1.1 定数

| 定数 | 値 | 説明 |
|---|---|---|
| `TILE_SIZE` | 40 | 1タイルのピクセルサイズ |
| `FPS` | 60 | 想定フレームレート |
| `NAV_ANNOUNCE_SECONDS` | 45 | ナビ表示までの秒数 |
| `TILE_FLOOR` / `TILE_WALL` / `TILE_DOOR` | 0 / 1 / 2 | タイル種別 |
| `ITEM_*` | 0-4 | アイテム種別 ID |
| `ITEM_DURATIONS` | [0,300,600,300,0] | 効果持続フレーム |
| `SECURITY_LAYOUT_LEVEL` | 6 | security レイアウト出現レベル |
| `UPLOAD_LAYOUT_LEVEL` | 6 | upload レイアウト出現レベル |
| `UPLOAD_REQUIRED_TIME` | FPS * 5 | アップロード完了時間 |
| `THEMES` | 5要素配列 | テーマ配色定義 |

### 1.2 グローバル変数

| 変数 | 初期値 | 説明 |
|---|---|---|
| `gameState` | `"START"` | ゲーム状態 |
| `level` | 1 | 現在レベル |
| `COLS`, `ROWS` | 32, 24 | マップサイズ（レベルごとに可変） |
| `map` | [] | 2次元タイル配列 |
| `player` | {} | プレイヤーオブジェクト |
| `goal` | {} | ゴール矩形 |
| `enemies`, `cameras`, `items` | [] | エンティティ配列 |
| `projectiles`, `particles` | [] | 弾・パーティクル |
| `keys`, `mouse` | {}, {x:0,y:0} | 入力状態 |
| `camera` | {x:0,y:0} | 画面オフセット |
| `securityDoor`, `uploadDoor` | null | ドア状態 |
| `uploadTerminal` | null | アップロード端末矩形 |
| `uploadStatus` | object | アップロード進捗 |
| `navActive`, `navMessage` | false, object | ナビ支援 |

### 1.3 関数

| 関数 | 説明 |
|---|---|
| `getItemSortPriority(type)` | インベントリ表示優先度 |
| `compareItemTypes(a, b)` | アイテム種別ソート比較 |
| `showNotification(msg)` | 通知表示（2秒フェード） |
| `dist(x1,y1,x2,y2)` | ユークリッド距離 |

---

## 2. js/audio.js

**責務:** Web Audio API による BGM / SE 再生

### 2.1 状態

| 変数 | 説明 |
|---|---|
| `audioCtx`, `masterGain` | AudioContext とマスターゲイン |
| `isAudioInit` | 初期化済みフラグ |
| `globalVolume` | 音量（0.0-1.0、初期 0.3） |
| `bgmState` | BGM スケジューラ状態（isChase, nextNoteTime 等） |

### 2.2 関数

| 関数 | 説明 |
|---|---|
| `initAudio()` | AudioContext 初期化 |
| `setVolume(val)` | マスター音量設定 |
| `playSE(type)` | 効果音再生 |
| `updateBGM()` | BGM ノートスケジューリング |
| `scheduleNote(time, isChase)` | 1ノート生成・再生 |

### 2.3 SE 種別

`item_get`, `item_use`, `item_drop`, `camera_detect`, `error`, `alert`, `goal`, `gameover`, `stun_fire`, `stun_hit`

---

## 3. js/map.js

**責務:** プロシージャルマップ生成、地形判定、ドア管理（最大モジュール、~800行）

### 3.1 主要関数

| 関数 | 説明 |
|---|---|
| `chooseLayoutType(level)` | 重み付きランダムでレイアウト選択 |
| `createLevel(attempt)` | レベル全体生成（接続性検証含む） |
| `createCaveLayout()` | ランダムウォーク洞窟生成 |
| `createMazeLayout()` | DFS 迷路 + 部屋 + ループ |
| `createDualFacilityLayout()` | 左右2施設 + セキュリティドア |
| `createUploadVaultLayout()` | 金庫 + アップロード端末 |
| `createSecurityCamera(floorTiles)` | 監視カメラ配置 |
| `validateConnectivity(start, required)` | BFS 接続性検証 |
| `moveEntity(entity)` | 壁・ロックドア考慮移動 |
| `isWall(x, y)` | 壁判定（ロックドア含む） |
| `isLockedDoor(col, row)` | ドア施錠判定 |
| `isTileBlockedForEnemy(col, row)` | 敵通行不可判定 |
| `lineIntersectsWall(x1,y1,x2,y2)` | 視線遮蔽判定 |
| `updateSecurityDoor()` | ドア解錠処理 |

### 3.2 参照グローバル変数

`level`, `map`, `COLS`, `ROWS`, `player`, `goal`, `enemies`, `cameras`, `items`, `securityDoor`, `uploadDoor`, `uploadTerminal`, `uploadStatus`, `currentTheme`, `canvas`

---

## 4. js/pathfinding.js

**責務:** 敵追跡用 A* 経路探索

### 4.1 関数

| 関数 | 説明 |
|---|---|
| `findPath(startGx, startGy, endGx, endGy)` | 4方向 A*、Manhattan ヒューリスティック |
| `reconstructPath(cameFrom, current)` | パス復元 |

### 4.2 パラメータ

| 定数 | 値 | 説明 |
|---|---|---|
| `MAX_LOOPS` | 500 | 計算打ち切り上限 |

### 4.3 依存

- `isTileBlockedForEnemy()` — map.js

---

## 5. js/enemies.js

**責務:** 敵・監視カメラの AI 更新、視界判定

### 5.1 関数

| 関数 | 説明 |
|---|---|
| `createSmartEnemy(gx, gy)` | 巡回ルート付き敵生成 |
| `findLongestPath(gx, gy)` | 4方向最長直線パス |
| `findTurnPath(gx, gy, prevGx, prevGy)` | 折返し禁止の最長パス |
| `updateEnemies()` | 敵 FSM 更新、BGM 連動 |
| `updateCameras()` | カメラスイング・検知 |
| `canSeePlayer(enemy)` | 敵の視界判定 |
| `canCameraSeePlayer(cam)` | カメラの視界判定 |

### 5.2 副作用

- `updateEnemies()` が `bgmState.isChase` を更新

---

## 6. js/player.js

**責務:** プレイヤー入力処理、アイテム、スタンガン、HUD

### 6.1 関数

| 関数 | 説明 |
|---|---|
| `updatePlayer()` | 移動・効果タイマー・照準角度 |
| `useItem()` | アイテム使用・効果適用 |
| `dropItem()` | アイテム廃棄 |
| `selectItemBySlot(index)` | スロット 0-3 選択 |
| `fireStunGun()` | スタンガン発射 |
| `updateCamera()` | プレイヤー追従カメラ |
| `updateHUD()` | DOM HUD 更新 |

### 6.2 依存

- `moveEntity()` — map.js
- `ITEM_*`, `ITEM_DURATIONS`, `ITEM_NAMES` — state.js

---

## 7. js/rendering.js

**責務:** Canvas 2D 描画、Fog of War、UI オーバーレイ

### 7.1 関数

| 関数 | 説明 |
|---|---|
| `drawWall(x, y, theme)` | テーマ別プロシージャル壁描画 |
| `draw()` | メイン描画（全レイヤー） |
| `drawUploadUI()` | アップロード進捗バー |
| `drawCenterText(main, sub, color)` | 中央テキスト（START/GAMEOVER/GOAL） |
| `createParticles(x, y, color, count)` | パーティクル生成 |
| `updateParticles()` | パーティクル更新 |
| `drawParticles()` | パーティクル描画 |

### 7.2 依存

- `ctx`, `canvas`, `camera` — state.js
- `getDoorInfoAt()` — map.js

---

## 8. js/game.js

**責務:** メインループ、衝突判定、入力イベント、ゲーム状態遷移

### 8.1 関数

| 関数 | 説明 |
|---|---|
| `initGame()` | ゲーム初期化（level=1） |
| `startGame()` | レベル開始 |
| `gameLoop()` | RAF ループ |
| `update()` | 全サブシステム更新 |
| `updateProjectiles()` | 弾丸移動・消滅 |
| `updateUploadTask()` | アップロード進捗 |
| `tickUploadMessage(target)` | タイプライター表示 |
| `checkCollisions()` | 弾・ゴール・アイテム・敵接触 |
| `levelComplete()` | レベルクリア処理 |
| `gameOver()` | ゲームオーバー処理 |

### 8.2 イベントリスナー

- `keydown` / `keyup` — キー入力
- `mousemove` / `mousedown` — マウス
- `wheel` — アイテム切替
- `volumeSlider input` — 音量

---

## 9. 主要データ構造

### 9.1 player

```javascript
{
    x, y,              // ワールド座標（px）
    radius: 12,
    speed: 1.62,
    baseSpeed: 1.62,
    dx, dy,            // 移動ベクトル
    angle,             // 照準角度（rad）
    inventory: [],     // アイテム type ID の配列
    maxInventorySize: 8,
    selectedItemType,
    activeEffect,      // 発動中効果 ID
    effectTimer,
    visibleRadius: 180,
    stunAmmo: 3,
    hasKeycard: false
}
```

### 9.2 enemy

```javascript
{
    x, y,
    radius: 12,
    speed,             // レベル依存
    angle,
    state,             // "PATROL"|"CHASE"|"ALERT"|"STUNNED"
    waypoints: [],     // 巡回点 {x,y,gx,gy}
    currentWpIndex,
    waitTimer,
    viewDistance: 160,
    viewAngle: Math.PI/4,
    targetX, targetY,  // 最終目撃位置
    lostSightTimer,
    color: "#ff3333",
    path: [],          // A* パス {x,y}
    pathTimer,
    dx, dy             // 移動ベクトル（更新時に設定）
}
```

### 9.3 camera（監視カメラ）

```javascript
{
    x, y,
    baseAngle,
    currentAngle,
    viewDistance: 130,
    blindRadius: 40,
    viewAngle: Math.PI/6,
    swingSpeed,
    swingRange: Math.PI/3,
    phase,
    state,             // "ACTIVE"|"DISABLED"
    disableTimer
}
```

### 9.4 item

```javascript
{
    x, y,
    type,              // ITEM_* ID
    active: true
}
```

### 9.5 projectile

```javascript
{
    x, y,
    vx, vy,            // 速度 14
    life: 60,
    type: "STUN"
}
```

### 9.6 securityDoor / uploadDoor

```javascript
{ x, y, locked: true }  // グリッド座標
```

### 9.7 uploadStatus

```javascript
{
    active, complete,
    progress,          // 0 ~ UPLOAD_REQUIRED_TIME
    currentText, currentTarget,
    targetText, completeText,
    timer, completeTimer
}
```

### 9.8 goal / uploadTerminal

```javascript
{ x, y, w, h }  // 矩形（px）
```

---

## 10. css/Stealth_Action.css

**責務:** ダークテーマ UI スタイル

| 要素 | 説明 |
|---|---|
| `#ui-layer` | HUD コンテナ（画面上部） |
| `.hud-item` | レベル・スタン・キーカード表示 |
| `.inventory-slot` | インベントリスロット（`.selected` で選択中） |
| `#notification-area` | 通知（opacity トランジション） |
| `.volume-control` | 音量スライダー |
| `.status-msg` | 操作説明（画面下部） |

---

## 11. index.html

**責務:** ページ構造、Canvas/HUD 要素、スクリプト読み込み順序の定義

---

## 12. 関連ドキュメント

- [02-architecture.md](./02-architecture.md) — モジュール依存関係
- [05-algorithms.md](./05-algorithms.md) — map.js / enemies.js のアルゴリズム詳細
