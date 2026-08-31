import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Closet",
  description:
    "Catalog your wardrobe, build outfits, track what you wear, and see what it actually costs per wear.",
  // Installable as a PWA — the app is mobile-first and intended to live on the home screen.
  appleWebApp: {
    capable: true,
    title: "Closet",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#faf9f7",
  // Full-height layout on mobile without the address bar causing jumps.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
