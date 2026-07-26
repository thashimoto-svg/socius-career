import type { Metadata, Viewport } from "next";
import { Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import "./globals.css";

// Body / UI font.
const zenKaku = Zen_Kaku_Gothic_New({
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
  // CJK subsets are large; skip preloading and let `swap` handle the fallback.
  preload: false,
  variable: "--font-sc-sans",
});

// Display font — headings and the student's own words.
const shippori = Shippori_Mincho({
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-sc-display",
});

export const metadata: Metadata = {
  title: "Socius Career",
  description: "就活生のための、対話型の自己分析。あなたの言葉で、自分史をつくる。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#175E63",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${zenKaku.variable} ${shippori.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Mobile-first column; centered with a subtle frame on wider screens. */}
        <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-sc-paper shadow-[0_0_60px_rgba(34,48,47,0.06)]">
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
