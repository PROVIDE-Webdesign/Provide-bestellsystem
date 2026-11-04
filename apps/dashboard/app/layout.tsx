import type { ReactNode } from "react";

import "./styles.css";

export const metadata = {
  description: "Sicherer Restaurantzugang für das PROVIDE Bestellsystem",
  manifest: "/dashboard.webmanifest",
  appleWebApp: { capable: true, title: "PROVIDE" },
  icons: { apple: "/dashboard-icon-192.png" },
  robots: { follow: false, index: false },
  title: "PROVIDE – Restaurant-Dashboard",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
