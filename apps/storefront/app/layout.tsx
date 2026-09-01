import type { ReactNode } from "react";

import "./styles.css";

export const metadata = {
  description: "Technischer Cloudflare-Laufzeitnachweis des PROVIDE-Bestellsystems",
  robots: {
    follow: false,
    index: false,
  },
  title: "PROVIDE Bestellsystem – Technik-Spike",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
