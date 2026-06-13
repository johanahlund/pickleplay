import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { ToastProvider } from "@/components/Toast";
import { RoleProvider, RoleTogglePill } from "@/components/RoleToggle";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HeaderBackProvider } from "@/components/HeaderBack";
import { CurrentEventFab } from "@/components/CurrentEventFab";

export const metadata: Metadata = {
  title: "FriendlyBall",
  description: "Organized play for racquet sports",
  manifest: "/manifest.json",
  icons: {
    // Versioned URLs so browsers fetch the new pickleball-glyph icon
    // instead of serving the legacy paddle favicon from their (very
    // aggressive) icon cache. Bump the `?v=` when icons change again.
    icon: "/favicon.png?v=2",
    apple: "/apple-touch-icon.png?v=2",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FriendlyBall",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#15803d",
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
          <RoleProvider>
            <ToastProvider>
              <ConfirmProvider>
                <HeaderBackProvider>
                  <Header />
                  <RoleTogglePill />
                  <main id="main-content" className="px-4 pb-[calc(6.75rem+env(safe-area-inset-bottom))] max-w-[600px] mx-auto">{children}</main>
                  <CurrentEventFab />
                  <BottomNav />
                </HeaderBackProvider>
              </ConfirmProvider>
            </ToastProvider>
          </RoleProvider>
        </Providers>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
