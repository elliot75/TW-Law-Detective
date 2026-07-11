import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "判決指南針｜用白話搜尋台灣法院判決";
const description =
  "免安裝、免登入，用自然語言搜尋台灣法院判決，並以自己的 AI 模型金鑰產生附來源的白話整理。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    metadataBase,
    title,
    description,
    openGraph: {
      type: "website",
      locale: "zh_TW",
      title,
      description,
      images: [{ url: "/og.png", width: 1792, height: 933 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <body>{children}</body>
    </html>
  );
}
