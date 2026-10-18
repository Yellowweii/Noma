import type { Metadata } from "next";
import { Inter, Noto_Sans_SC } from "next/font/google";
import { SITE_URL } from "@/lib/seo";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Noma | 越来越懂你的家庭 AI Agent",
  description:
    "一个拥有长期记忆、能够越来越了解你的 AI Agent，并通过智能家居设备主动为你提供个性化家庭服务。",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/favicon.svg?v=continuum-tile", type: "image/svg+xml" }],
    shortcut: [{ url: "/favicon.svg?v=continuum-tile", type: "image/svg+xml" }],
    apple: [{ url: "/noma-logo.svg?v=continuum", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`h-full overflow-hidden ${inter.variable} ${notoSansSC.variable}`}
    >
      <body className="h-full overflow-hidden font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
