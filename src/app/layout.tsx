import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { AuthProvider } from "@/components/AuthProvider";
import { WebAppManager } from "@/components/WebAppManager";

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
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "作文积累本",
    statusBarStyle: "black-translucent",
    startupImage: [
      {
        url: "/splash/apple-splash-1290x2796.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-1179x2556.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-1170x2532.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-1284x2778.png",
        media:
          "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-1242x2688.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-1125x2436.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)",
      },
      {
        url: "/splash/apple-splash-828x1792.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-750x1334.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-640x1136.png",
        media:
          "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-2048x2732.png",
        media:
          "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-1668x2388.png",
        media:
          "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-1620x2160.png",
        media:
          "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2)",
      },
      {
        url: "/splash/apple-splash-1536x2048.png",
        media:
          "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)",
      },
    ],
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* apple-mobile-web-app-* 与启动图由 metadata.appleWebApp 生成，这里只补其余平台 */}
        <meta name="msapplication-TileColor" content="#a31f24" />
        <meta name="msapplication-tap-highlight" content="no" />
        <link rel="mask-icon" href="/icon-512.png" color="#a31f24" />
      </head>
      <body className="antialiased flex flex-col min-h-screen">
        <AuthProvider>
          <main className="flex-1">{children}</main>
          <Footer />
          <WebAppManager />
        </AuthProvider>
      </body>
    </html>
  );
}
