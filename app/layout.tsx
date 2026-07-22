import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host ? `${protocol}://${host}` : null;
  return {
    title: "Drift — A calmer task board",
    description: "A polished Kanban workspace for focused teams, with private guest sessions, comments, activity, labels, assignees, and realtime Supabase sync.",
    applicationName: "Drift",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Drift — A calmer task board",
      description: "Move work forward with a focused, collaborative Kanban workspace.",
      type: "website",
      ...(origin ? { url: origin, images: [{ url: `${origin}/og.png`, width: 1536, height: 1024, alt: "Drift task board preview" }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: "Drift — A calmer task board",
      description: "Move work forward with a focused, collaborative Kanban workspace.",
      ...(origin ? { images: [`${origin}/og.png`] } : {}),
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f2ed",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
