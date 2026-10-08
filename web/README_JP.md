# mGBA celio Web — iPhone / iPad向けWASM版

起動: https://liru55.github.io/mgba-celio-web/
使い方: https://liru55.github.io/mgba-celio-web/help.html

## 使う

Safariで開き、端末内のGBA / GB / GBC ROMを選びます。64MBまで対応します。ROMは端末内だけで処理し、サーバーに送信しません。ROM・個人のセーブは同梱していません。

ゲーム内で通常セーブをしてから、このブラウザへ保存します。約10秒ごとの自動保存と手動保存、同じROM選択時の復元に対応します。ROM本体は保存しないため、再読み込み後は選び直してください。ファイルの書き出し・差し替えも可能です。重要なセーブはファイルにもバックアップしてください。

メイン画面の「使い方・よくある質問」と設定内の「使い方」から説明ページを開けます。説明ページもオフラインキャッシュに含まれます。

## 主な機能

- 縦・横向き、全画面内の戻るボタン
- 複数同時タッチ、縦横別のボタン位置・大きさ・透明度
- コントローラーの接続表示・ボタン割り当て・A/B配置・スティックの遊び
- キーボードとショートカット
- 音量・ミュート（端末に設定保存）
- ボタンを隠してタップ復帰、ゲーム画面だけのPNG書き出し
- mGBAのチート追加・有効無効・削除（今回の起動中だけ保持）
- ブラウザ保存とファイルのセーブ入出力
- ホーム画面への追加とオフライン起動

通常は設定を開くとゲームを一時停止します（通信中は進みます）。ブラウザのデータ削除・容量制限・プライベートブラウズなどでセーブが失われることがあります。チートは対応ROM用のコードを使用してください。変更済みのデータは無効化しても元に戻りません。

## ビルド

Emscripten 4.0.23、CMake、Ninjaを使用しています。

Windows（Emscriptenの環境を有効にした状態）:

```powershell
./web/build.ps1 -Emsdk C:/path/to/emsdk
```

macOS / Linux:

```sh
emcmake cmake -S web -B build-web -G Ninja -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build build-web --parallel
```

`build-web`内のHTML・CSS・JS・WASM・manifest・アイコン・service workerをHTTPSの静的サーバーで配信します。ソースはmain、変更前の元ソースはupstream-source、配信ファイルはgh-pagesです。

## 構成

- `bridge.c`: mGBAコアのROM・描画・入力・セーブ・チートとの接続
- `app.js`: ゲームの実行、タッチ、表示、音声、設定の連携
- `controller.js`: コントローラー入力と割り当て
- `storage.js`: IndexedDBによるブラウザ保存
- `styles.css`: メイン画面のスタイル
- `help.html`: 利用者向け説明と困ったときの対処
- `sw.js`: 配信ファイルと説明ページのオフラインキャッシュ

## 検証

`node web/test-smoke.cjs`でコアの基本機能、Playwrightを用意して`node web/test-browser.cjs`でブラウザの入力・保存・UIを検証できます。生成済みの`build-web`が必要です。

WebKitでROM実行、入力・仮想コントローラー、セーブ入出力、ブラウザ保存・再読み込み後の復元、全画面の実APIと代替拡大の終了、縦横表示、チートのRAM効果、PNG保存、音量・ミュート、説明ページ、オフライン起動を検証しています。

iPhone実機、実物のパッド、ゲーム全編、個別ROM向けチートコードの効果は未検証です。

## 元ソースとライセンス

元ソース: https://github.com/onikoro334274-cell/mGBA_celio_edition
64MB対応の元実装: rom64ブランチ、770ab0bb8a19fdd11303ea4c42be0f9b81fb6959

Mozilla Public License 2.0。元の著作権表示と第三者ライセンスを保持しています。
任天堂（Nintendo）とは関係のない非公式プロジェクトです。任天堂の承認・提供・運営によるサービスではありません。

画面倍率は表示設定で50〜200%。offline.jsとsw.jsで準備状況、明示的再保存、アプリキャッシュ削除に対応。キャッシュは期限なし（OSによる削除はあり）、セーブ用IndexedDBと設定は削除しません。

追加機能：WebGLのスキャンライン・LCD・CRTとlibretroのxBRZ Freescale Multipass（原版2パス、shaders内に出典・ライセンス）。十字キーはスライドと斜めに対応し操作設定で従来配置に戻せます。倍速1〜4倍は音声のplaybackRateも同期。画面上の倍速とクイック保存／ロードは設定で表示切替。クイック状態はROMハッシュごとのstate:キーでIndexedDBに保存し、CPU・RAM・通常セーブRAM・RTCを復元します。通常セーブと別枠で1つずつ保持し、ロードは通常セーブRAMも戻します。

倍速・クイック保存／ロードも「操作」→「ボタンの位置を調整」で移動できます。縦横別に端末へ保存し、全画面やサイズ変更時は画面内に収めます。「配置を初期化」で元に戻せます。

## Celio通信（ROMの改造不要）

指定された上流 onikoro334274-cell/mGBA_celio_edition の rom64 / dee555365 を取り込み、Windows用 CelioNet.cpp のデバイス・ハンドシェイク・CRC・タイマー処理を celio-device.cpp に移植しました。JSはWindowsのWinHTTPに代わりブラウザのWebSocketで同じEngine.IO 4 / Socket.IOのメッセージを送受信します。中継先は上流と同じCelioサーバーです。独自Celio-ServerのURLも指定できます。

以前のPeerJS・途中状態共有・入力同期方式は削除しました。オンラインは自分のコアだけを動かし、32語のケーブルパケットを中継します。ROMとセーブファイル全体は送信しません。部屋番号は4桁で、合言葉認証はありません。同じ端末内では2つのCelioデバイスを直接接続して外部通信なしで動かします。

通信前は状態とセーブを端末内にバックアップし、切断時は復元します。通常終了は自分のセーブを保存、端末内接続の2人目セーブは link2: の別枠に保存します。GBAのCelioケーブル方式に対応し、無線アダプター・GB/GBC通信は対象外です。

倍速・クイック保存・ロードはそれぞれ独立して、設定 → 操作 → ボタンの位置を調整から動かせます。縦・横の位置を別々に保持し、従来の一括位置も移行します。

検証: `node web/test-celio-core.cjs` はCelioデバイスのハンドシェイク・CRC・パケット・再接続を確認。`node web/test-quick-layout.cjs` は独立配置と端末内通信UIを確認。`CELIO_ONLINE=1` で同じテストを実行すると公開Celioサーバーへ合成ROMだけで2クライアント接続し、ケーブルパケットの到達を確認します。Playwrightが必要です。
