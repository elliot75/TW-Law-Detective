# 判決指南針（TW Legal RAG Web）

面向一般民眾的繁體中文判決檢索介面。使用者可用白話搜尋台灣法院判決，檢視 TLR Bundle 的來源與審級資訊，並選擇使用自己的 OpenAI、Gemini 或 OpenAI-compatible API 金鑰產生附引用的白話整理。

本專案是非官方 Web 介面，沒有內建判決庫、向量索引或生成模型。判決檢索由瀏覽器直接呼叫 [Taiwan Legal RAG](https://github.com/aa0101181514/tw-legal-rag) 公開端點；AI 功能是選配，且不是法律意見。

## 本機開發

需求：Node.js 22.13 或更新版本。

```bash
npm install
npm run dev
```

開啟 `http://localhost:3000`。可在 `.env.local` 覆寫：

```dotenv
NEXT_PUBLIC_TLR_BASE_URL=https://tlr.dr-lawbot.com
```

專案不需要站方模型金鑰。OpenAI 與 Gemini 金鑰只在單次 `/api/explain` 請求中轉，自訂端點則由瀏覽器直接連線；任何金鑰都不會寫入 cookie、Web Storage 或資料庫。

## 驗證

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

端對端測試使用模擬 TLR 與模型回應，不會消耗真實 API 額度。

## Docker

```bash
docker compose up --build
```

服務預設監聽 `http://localhost:3000`，健康檢查位於 `/api/health`。正式環境必須置於 HTTPS 反向代理後方；自訂模型端點也應使用 HTTPS 並支援 CORS。

## 隱私與限制

- TLR 可能記錄查詢文字、時間與 IP 衍生資訊；請勿輸入姓名、身分證、地址或機密內容。
- AI 輸出只做結構、引用白名單及判決字號檢查，不能證明法律推論正確。
- `case_history` 沒有上級審紀錄只代表資料庫未收錄，不代表判決已確定。
- 本服務不提供勝率、結果保證或具體時效判斷。

詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
