import type { Metadata } from "next";
import { Inter, Jost } from "next/font/google";
import "./globals.css";
import VerifyEmailBanner from "./components/VerifyEmailBanner";
import PendingDeletionBanner from "./components/PendingDeletionBanner";

// Workhorse sans for body, UI, secondary headings, and stats.
const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Bold geometric display sans for primary page-level h1 moments
// (Futura-family DNA: open-sourced as a Futura alternative).
// Streetwear / event-poster voice, not editorial.
const jost = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Afterset",
  description: "Review concerts. Discover the best live shows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jost.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PendingDeletionBanner />
        <VerifyEmailBanner />
        {children}
      </body>
    </html>
  );
}
