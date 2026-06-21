# Stealth_Action 設計書

**正式タイトル:** Stealth Rogue: Blind Spot  
**リポジトリ名:** Stealth_Action

ブラウザ向けローグライト・ステルスアクションゲームの開発者向け設計ドキュメントです。プレイヤー向けの概要・操作方法は [README.md](../README.md) を参照してください。

---

## ドキュメント一覧

| ドキュメント | 内容 | 主な対象読者 |
|---|---|---|
| [01-overview.md](./01-overview.md) | 概要設計（目的・技術スタック・構成・制約） | 全体把握 |
| [02-architecture.md](./02-architecture.md) | アーキテクチャ設計（モジュール依存・状態遷移・データフロー） | 開発者 |
| [03-game-specification.md](./03-game-specification.md) | ゲーム仕様（操作・ルール・アイテム・レベル進行） | 開発者 / 企画確認 |
| [04-module-design.md](./04-module-design.md) | モジュール詳細設計（各 JS ファイルの責務・関数・データ構造） | 開発者 |
| [05-algorithms.md](./05-algorithms.md) | アルゴリズム設計（マップ生成・A*・敵 AI・カメラ） | 開発者 |

---

## ソースコードとの対応表

| ソースファイル | 関連設計書 |
|---|---|
| [index.html](../index.html) | 01-overview, 02-architecture |
| [css/Stealth_Action.css](../css/Stealth_Action.css) | 01-overview, 04-module-design |
| [js/state.js](../js/state.js) | 02-architecture, 04-module-design |
| [js/audio.js](../js/audio.js) | 04-module-design |
| [js/map.js](../js/map.js) | 04-module-design, 05-algorithms |
| [js/pathfinding.js](../js/pathfinding.js) | 04-module-design, 05-algorithms |
| [js/enemies.js](../js/enemies.js) | 03-game-specification, 04-module-design, 05-algorithms |
| [js/player.js](../js/player.js) | 03-game-specification, 04-module-design |
| [js/rendering.js](../js/rendering.js) | 03-game-specification, 04-module-design |
| [js/game.js](../js/game.js) | 02-architecture, 03-game-specification, 04-module-design |

---

## 読み方の目安

1. **初めて触る場合:** 01-overview → 02-architecture の順
2. **ゲーム挙動を確認したい場合:** 03-game-specification
3. **機能追加・修正する場合:** 04-module-design → 05-algorithms
4. **マップ生成や AI を変更する場合:** 05-algorithms を中心に map.js / enemies.js を参照

---

## 設計書の前提

- 設計書の内容は **実装済みコードを正** とする
- [README.md](../README.md) に記載の「足音・物音による警戒」は現時点で未実装（[03-game-specification.md](./03-game-specification.md) 参照）
