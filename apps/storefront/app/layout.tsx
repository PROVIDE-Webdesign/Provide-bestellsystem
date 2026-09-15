import type { ReactNode } from "react";

import "./styles.css";

export const metadata = {
  description: "Speisekarte, Warenkorb und sicherer Abhol-Checkout direkt beim Restaurant",
  robots: {
    follow: false,
    index: false,
  },
  title: "PROVIDE – Online bestellen",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
