import type { Metadata } from "next";
import { Inter, Jost, Libre_Caslon_Display } from "next/font/google";
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

// Editorial display serif for artist names in the review feed. Google
// ships Libre Caslon Display in a single 400 weight only — that is the
// intended weight for a display cut, so artist names set in it use 400
// rather than the 700 the sans-serif headline used to carry.
// Self-hosted by next/font at build time: no request leaves the browser.
const caslon = Libre_Caslon_Display({
  variable: "--font-editorial",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
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
      className={`${inter.variable} ${jost.variable} ${caslon.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PendingDeletionBanner />
        <VerifyEmailBanner />
        {children}
      </body>
    </html>
  );
}
