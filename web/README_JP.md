# iPhone / iPad向けWASM版

GBA / GB / GBCコアをWebAssemblyへビルドし、Safariで使うフロントエンドです。
デスクトップのQt画面ではなく、タッチ操作対応のWeb画面を使用します。

## ビルド

Emscripten 4.0.23、CMake、Ninjaが必要です。
WindowsではEmscriptenの環境を有効にしてから、プロジェクト直下で実行します。

```powershell
./web/build.ps1 -Emsdk C:/path/to/emsdk
```

macOS / Linux:

```sh
emcmake cmake -S web -B build-web -G Ninja -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build build-web --parallel
```

## iOSで起動

1. `build-web`の`index.html`、`app.js`、`mgba.js`、`mgba.wasm`、`manifest.webmanifest`、`sw.js`、`icon-256.png`、`icon-512.png`をHTTPSの静的Webサーバーへ配置します。
2. iPhone / iPadのSafariでそのURLを開きます。
3. 共有メニュー →「ホーム画面に追加」で起動アイコンを作れます。
4. 「ROMを開く」で「ファイル」からROMを選びます。ボタン操作後に音声が有効になります。

iOSの「ショートカット」アプリからも起動できます。「URL」に配信先のURLを指定し、「URLを開く」アクションを追加してください。Siriやホーム画面からそのショートカットを実行できます。配信URLが決まるまでURLの設定はできません。

初回読み込みとオフラインキャッシュにはHTTPSが必要です。Windows上のファイルをiPhoneへコピーして直接開くだけでは動作しません。オフライン時もROMは毎回「ファイル」から選択します。

## 操作とセーブ

画面のボタンは複数同時タッチに対応しています。別アプリに移動すると一時停止します。
ゲームのセーブは「セーブを書き出す」で`.sav`として保存してください。「セーブを読み込む」で復元できます。タブ終了後の自動復元はありません。

外付けキーボード: 方向キー、Z=A、X=B、A=L、S=R、Enter=Start、Shift=Select。
Ctrl/Cmd+O=ROM、Space=一時停止、Ctrl/Cmd+R=リセット、Ctrl/Cmd+S=セーブ書き出し、Ctrl/Cmd+Shift+O=セーブ読込、F=全画面。
OS / Safariが優先する組み合わせは画面のボタンで操作してください。

本版はROM、画面、音声、入力、通常セーブの基本機能を対象としています。Qt固有のUI、スクリプト、デバッガー、通信機能は含みません。

## 検証

`node web/test-smoke.cjs`で、生成済みWASMを使ってテスト用GBA / GB / GBC ROMのフレーム実行、音声データ生成、リセット、GB / GBCセーブ入出力を確認できます。

2026年10月8日: Emscripten 4.0.23でReleaseビルド成功。WebKit 26.5のiPhone相当画面サイズで、ROM読み込み、描画、実行ループ、音声処理、キー操作、タッチイベント、セーブのダウンロードと読込、PWA設定、通信切断後の再読み込みとROM実行を確認しました。iPhone / iPad実機、Siri、ホーム画面への追加操作そのものは未検証です。

## PokemonStart v0.27・64MB対応

従来の32MBでの切り詰めを修正しました。64MB ROMの後半を0x0A000000〜0x0BFFFFFFへ配置する配布元rom64ブランチの処理を取り込んでいます（元コミット770ab0bb8a19fdd11303ea4c42be0f9b81fb6959）。通常の32MB以下のROMは従来どおりです。

指定のPokemonStart_v0.27.gba（64MB）で、WebKit上の読込、起動アニメーション、START/A入力後の操作説明画面、1,600フレーム以上の実行を確認しました。縦向き・横向きとも横にはみ出さないことを確認しています。ゲーム全編とiOS実機での性能は未検証です。

UIは十字キー・A/B・L/R・START/SELECTを配置し、セーブ・リセット・全画面・説明を「セーブ・設定・使い方」にまとめました。キャッシュをv2へ更新しています。
