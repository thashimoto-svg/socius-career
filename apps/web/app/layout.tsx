import type { Metadata, Viewport } from "next";
import { Shippori_Mincho, Zen_Kaku_Gothic_New } from "next/font/google";
import { AuthProvider } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/app-shell";
import { Preconnect } from "@/components/preconnect";
import { SettingsProvider } from "@/components/settings-provider";
import { ViewportHeight } from "@/components/viewport-height";
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
  // Lets the app paint into the notch and the home-indicator strip, which is
  // also what makes env(safe-area-inset-*) report anything other than zero.
  // The header and the tab bar pad themselves back out of those areas.
  viewportFit: "cover",
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
        {/* Renders nothing. Hoisted into <head>, so the handshakes with
            Firebase's hosts start while the SDK is still downloading. */}
        <Preconnect />
        <ViewportHeight />
        {/*
          Mobile-first column; centered with a subtle frame on wider screens,
          and uncapped on the signed-in screens from 768px up so the sidebar
          has somewhere to be. AppShell decides which, from the route.

          min-height rather than height, because the legal pages are longer
          than a screen and have to be allowed to grow. The (main) shell pins
          itself to exactly this height instead, so the app screens never
          scroll the document — only the panel inside them that should.
        */}
        <AppShell>
          {/* Inside AuthProvider — settings are per student, so there is
              nobody to read them for until there is a student. */}
          <AuthProvider>
            <SettingsProvider>{children}</SettingsProvider>
          </AuthProvider>
        </AppShell>
      </body>
    </html>
  );
}
