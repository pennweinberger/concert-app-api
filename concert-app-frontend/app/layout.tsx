import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Masthead from "./components/Masthead";
import VerifyEmailBanner from "./components/VerifyEmailBanner";
import PendingDeletionBanner from "./components/PendingDeletionBanner";
import SiteFooter from "./components/SiteFooter";

// One family for everything: display headlines lean on weight and tight
// tracking rather than a second typeface.
const geist = Geist({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Afterset",
  description: "Review concerts. Discover the best live shows.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <PendingDeletionBanner />
        <VerifyEmailBanner />
        {/* Site-wide header. Rendered here rather than per page so every
            route — including auth and legal pages — gets the same chrome. */}
        <Masthead />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
