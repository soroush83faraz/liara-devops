import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "vazirmatn/Vazirmatn-Variable-font-face.css";
import "./globals.css";
import { fa } from "@/lib/i18n/fa";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: fa.common.appName,
  description: fa.common.appDescription,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl" className="h-full antialiased">
      <body className="min-h-full">
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-accent px-4 py-2 text-accent-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[70]"
        >
          {fa.common.skipToContent}
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
