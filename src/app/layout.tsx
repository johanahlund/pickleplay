import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "PicklePlay",
  description: "Pickleball matchmaking & scoring app",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PicklePlay",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#16a34a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <header className="sticky top-0 z-50 bg-primary text-white px-4 py-3 shadow-md">
          <h1 className="text-xl font-bold text-center tracking-tight">
            🏓 PicklePlay
          </h1>
        </header>
        <main className="px-4 py-4">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
