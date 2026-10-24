import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Lora, Geist_Mono } from "next/font/google";
import "./globals.css";

// The interface face. Chosen for dense productivity screens: open apertures
// and tabular figures that stay legible at 12–14px.
const ui = Plus_Jakarta_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
});

// The reading face, used only for the body of a note, where you read for
// longer than you scan.
const reading = Lora({
  variable: "--font-reading",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Anamnesis",
  description: "An AI-native personal knowledge and productivity workspace.",
  appleWebApp: { capable: true, title: "Anamnesis", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${reading.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">{children}</body>
    </html>
  );
}
