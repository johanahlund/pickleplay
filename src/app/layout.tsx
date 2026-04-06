import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "PickleJ",
  description: "Pickleball matchmaking & scoring app",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PickleJ",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <ToastProvider>
            <Header />
            <main id="main-content" className="px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] max-w-[600px] mx-auto">{children}</main>
            <BottomNav />
          </ToastProvider>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
