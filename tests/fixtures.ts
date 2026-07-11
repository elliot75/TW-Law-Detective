import type { LegalExplanation, TLRBundle } from "@/lib/contracts";

export const validBundle: TLRBundle = {
  schema: "twlegalrag.bundle/v1",
  query: "房東不退押金",
  source: "Taiwan Legal RAG (TLR) retrieval endpoint",
  retrieval_only: true,
  allowed_citations: ["J1", "J2"],
  judgments: [
    {
      citation_id: "J1",
      doc_id: "TEST,112,訴,1,20230101,1",
      citation_text: "臺灣測試地方法院 112 年度訴字第 1 號（民事）",
      citation_url: "https://dr-lawbot.com/fullview/TEST1",
      court_name: "臺灣測試地方法院",
      jdate: "2023-01-01",
      case_category: "民事",
      cited_articles: ["民法第421條"],
      listing: "〔返還押租金〕 | 判決結果: 原告勝訴",
      fulltext_excerpt: "法院認為租約終止且無欠費時，出租人應返還押租金。",
      fulltext_available: true,
      fulltext_truncated: false,
      case_history: null,
    },
    {
      citation_id: "J2",
      doc_id: "TEST,111,簡,2,20220101,1",
      citation_text: "臺灣測試地方法院 111 年度簡字第 2 號（民事）",
      citation_url: "https://dr-lawbot.com/fullview/TEST2",
      court_name: "臺灣測試地方法院",
      jdate: "2022-01-01",
      case_category: "民事",
      cited_articles: ["民法第430條"],
      listing: "〔返還押租金〕 | 判決結果: 原告敗訴",
      fulltext_excerpt: "法院認為承租人仍有欠費，押金抵銷後已無餘額。",
      fulltext_available: true,
      fulltext_truncated: false,
      case_history: {
        upper: [
          {
            citation_text: "上級審測試判決",
            main_flag: "主文含『廢棄』",
          },
        ],
      },
    },
  ],
  unread_candidates: [],
  verification_instructions: { required: true },
};

export const validExplanation: LegalExplanation = {
  sufficiency: "partial",
  summary: "是否能取回押金，通常取決於租約是否終止及是否仍有欠費。",
  summaryCitationIds: ["J1", "J2"],
  legalIssues: [
    {
      title: "租賃關係是否已結束",
      explanation: "法院會先確認房屋是否返還，以及雙方是否仍有租賃債務。",
      citationIds: ["J1", "J2"],
    },
  ],
  caseComparisons: [
    {
      title: "有無欠費會影響結果",
      explanation: "一件資料顯示無欠費時返還，另一件則因抵銷而無餘額。",
      citationIds: ["J1", "J2"],
    },
  ],
  evidenceChecklist: ["租賃契約", "點交紀錄", "租金與水電費收據"],
  uncertainties: ["實際欠費金額與修繕責任仍需個案證據確認。"],
  nextSteps: ["整理付款及點交資料", "必要時尋求正式法律諮詢"],
};
