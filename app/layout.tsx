import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

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
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("marven-theme");if(t==="light")document.documentElement.setAttribute("data-theme","light");}catch{}`,
          }}
        />
      </head>
      <body className={inter.variable}>{children}</body>
    </html>
  );
}
