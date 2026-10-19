import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { BRAND } from "@/lib/brand";

import "./globals.css";

const geistSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

// Thai glyphs; Latin text and numbers stay in Geist.
const notoSansThai = localFont({
  src: "./fonts/noto-sans-thai.woff2",
  variable: "--font-noto-thai",
  weight: "100 900",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} · ${BRAND.product}`,
    template: `%s · ${BRAND.name}`,
  },
  description: `${BRAND.product} — ${BRAND.name} ${BRAND.tagline}`,
  applicationName: BRAND.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: BRAND.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansThai.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
