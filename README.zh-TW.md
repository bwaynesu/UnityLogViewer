# Unity Log Viewer

*📖 English version: [README.md](README.md)。*

一款檢視 Unity `Player.log` 的桌面工具。它把日誌解析成有結構的條目，讓你能順利閱讀、搜尋那些會把文字編輯器拖垮的大型日誌。

Player.log 預設沒有時間戳，也沒有等級前綴，用文字編輯器打開就是一整片沒有結構的文字。這個工具會重建每一筆條目和它的堆疊追蹤、判斷嚴重等級、把重複訊息聚合起來，你也可以點一下堆疊幀，直接在 IDE 打開對應的檔案與行號。

> 狀態：v1.0.0，就目標範圍而言功能已完整。  
> 執行環境為 Windows 10/11。

<!-- 正式釋出前可在此放一段 demo GIF，例如 ![demo](docs/demo.gif) -->

## 製作理由

真實遊戲的玩家日誌動輒數百 MB、數十萬行，足以讓一般文字編輯器變得遲鈍。而且這個格式其實帶有編輯器會忽略的結構：呼叫端堆疊幀、例外區塊，還有開頭的系統資訊 banner。把這些結構還原出來，大概就是這個工具最主要的工作。找到錯誤之後，你想看的原始碼那一行也只差一次點擊。

## 功能特色

閱讀
- 用逐行分類的解析器處理沒有時間戳、沒有前綴的 Player.log。用空行切割是行不通的，因為連續的單行條目之間根本沒有空行。
- 依 Unity 寫入的呼叫端堆疊幀判斷等級(Log、Warning、Error、Assert、Exception)。
- 把重複訊息摺疊成群組，標上 ×N 次數。訊息裡的數值(tick、時間戳、座標)會被遮罩，所以只有數字不同的洗版訊息會併成同一群。
- 詳細面板會顯示完整訊息、格式化後的堆疊追蹤，並提供一個複製原始條目的按鈕。

尋找
- 搜尋範圍涵蓋訊息本身和堆疊幀。以空白分隔的關鍵字為 AND 條件，`-term` 為排除，另有大小寫與正規表示式的切換。
- 用 F8/Shift+F8 在錯誤之間導覽，用 1/2/3 切換等級篩選；篩選變動時，你原本選取的位置會保留。
- 原生崩潰傾印偵測：含有 `OUTPUTTING STACK TRACE` 區段的檔案會被標示，並附上一個跳到該處的連結。

IDE 深層連結
- 點擊 `檔案：行號` 堆疊幀，就能零設定在 IDE 打開該行。它的做法比照 Unity 本身：先讀取 Unity 設定的外部指令碼編輯器，再依序退回 Visual Studio(用 `vswhere` 定位)、Rider、VS Code 和 Sublime。另外提供自訂指令範本作為覆寫。

分診面板(Triage)
- 從日誌 banner 整理出來的系統資訊卡(Unity 版本、繪圖 API、GPU、VRAM、驅動程式)，並附一個把摘要複製起來、方便貼進 bug 回報的按鈕。
- 全檔各等級的計數，以及前 10 大重複錯誤清單，每一項都能點擊跳到該條目。

工作流程
- 分頁、最近開啟的檔案，以及一鍵開啟在 LocalLow 下找到的 Player.log，也支援你自己加入的監看資料夾。
- 命令列開檔(`UnityLogViewer <路徑>`)搭配單一實例處理，以及可選的 .log 副檔名關聯。
- 亮、灰、深三種主題，可調整的字體大小(Ctrl+滾輪)，列底色標示，以及其他偏好設定，都保存在本機。

## 效能

解析在 Rust 核心的背景執行緒進行，所以載入檔案時視窗不會卡住。清單採用虛擬化，分頁按需載入，前端不會持有整份日誌。即使日誌到了數百 MB，捲動和篩選也還是順的。

## 隱私

這個 app 是離線的。它只讀取本機檔案，不發任何網路請求：沒有遙測，沒有更新檢查，任何資料都不會離開你的電腦。未來會加入「檢查更新」選項，而且預設關閉。

## 安裝

可以到 [Releases](../../releases) 頁面下載安裝檔，或自行從原始碼建置。建置需要 [Rust](https://www.rust-lang.org/tools/install)(stable，Windows 上需要 MSVC 工具鏈)、[Node.js](https://nodejs.org/) 20+，以及 [Tauri 環境需求](https://tauri.app/start/prerequisites/)。WebView2 隨 Windows 10/11 一起附帶。

```bash
npm install
npm run tauri dev      # 開發模式執行
npm run tauri build    # 建置 UnityLogViewer.exe 與安裝檔
```

執行檔會產生在 `src-tauri/target/release/`，MSI/NSIS 安裝檔在 `src-tauri/target/release/bundle/`。執行檔是自足式的，搬到哪都能跑。

## 快捷鍵

| 按鍵 | 動作 |
| --- | --- |
| `F8` / `Shift+F8` | 下一個 / 上一個錯誤 |
| `1` / `2` / `3` | 切換 Log / Warning / Error 篩選 |
| `Ctrl+F` | 聚焦搜尋框 |
| `Esc` | 清除搜尋 |
| `↑` / `↓` | 移動選取 |
| `Home` / `End` | 跳到頂 / 底 |
| `Ctrl+滾輪`、`Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 縮放文字 |
| `Ctrl+W` / `Ctrl+Tab` | 關閉 / 循環分頁 |

## 平台支援

目前支援並測試過的平台是 Windows 10/11。解析核心本身是跨平台的，但本機日誌掃描、IDE 整合和副檔名關聯目前只支援 Windows。macOS 和 Linux 還沒有對應的建置。

## 技術堆疊

[Tauri 2](https://tauri.app/)、React + TypeScript(Vite)，以及一個無外部相依的 Rust 解析核心(`ulv-core`)。解析邏輯和 Tauri 分開，並以單元測試涵蓋(`cargo test`、`npm test`)。

## 開發說明

開發過程中有借助 [Claude](https://www.anthropic.com/claude)(Claude Code)協助，設計決策與變更都由作者審閱。

## 開發藍圖

- 自動化的 CI 建置
- 書籤
- 可選的更新檢查(預設關閉)

## 授權

Copyright © 2026 bwaynesu。採用 [GNU Affero General Public License v3.0 或更新版本](LICENSE)(AGPL-3.0-or-later)授權。

這是強 copyleft 授權：你可以使用、修改、散布本軟體，但任何經散布或透過網路提供的衍生作品，都必須以 AGPL 授權並附上完整原始碼。它不允許製作閉源的分支或產品。
