import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { LANGUAGE_BOOT_SCRIPT } from "@/lib/i18n/boot";
import { LanguageBoot } from "@/app/components/marven/LanguageBoot";

// Inter ships with the app (npm @fontsource-variable/inter, OFL-1.1) rather than
// next/font/google, which downloads it from Google Fonts on every build — a
// flaky fetch there failed CI, and offline builds couldn't work at all.
const inter = localFont({
  src: "../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
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
