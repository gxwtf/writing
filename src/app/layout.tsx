import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { AuthProvider } from "@/components/AuthProvider";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#a31f24" },
    { media: "(prefers-color-scheme: dark)", color: "#8a1010" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "作文积累本",
    template: "%s | 作文积累本",
  },
  description:
    "广学五题坊旗下独立的作文积累本：收藏、整理、检索你的英语作文好句好段，支持标签管理、AI 找词与 PDF 导出。",
  applicationName: "作文积累本",
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <main className="flex-1">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
