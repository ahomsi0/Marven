import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LANGUAGE_BOOT_SCRIPT } from "@/lib/i18n/boot";
import { LanguageBoot } from "@/app/components/marven/LanguageBoot";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Marven",
  description: "Marven helps you chat, think, and get things done.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // lang/dir and data-theme are set from localStorage before hydration.
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("marven-theme");if(t&&t!=="dark")document.documentElement.setAttribute("data-theme",t);}catch{}`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: LANGUAGE_BOOT_SCRIPT }} />
      </head>
      <body className={inter.variable}>
        <LanguageBoot />
        {children}
      </body>
    </html>
  );
}
