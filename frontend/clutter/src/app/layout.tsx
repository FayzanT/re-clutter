// app/layout.tsx

import Script from "next/script";
import GoogleAuthProvider from "../providers/GoogleAuthProvider";
import "./globals.css";
import { Providers } from "./providers";

// You can add metadata here if you want
export const metadata = {
  title: "Re-Clutter",
  description:
    "Design and deploy cloud infrastructure visually with Re-Clutter.",
  icons: { icon: "/logos/re-cl.svg", apple: "/logos/re-cl.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t;try{t=localStorage.getItem('clutter-theme')}catch(e){}document.documentElement.classList.toggle('dark',t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches))})()`,
          }}
        />
        {/* Google Identity Services Script (Required for GSI login) */}
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
        />
      </head>

      <body>
        {/*  */}
        <Providers>
          <GoogleAuthProvider>{children}</GoogleAuthProvider>
        </Providers>
      </body>
    </html>
  );
}
