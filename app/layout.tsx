import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SourceDesk · Laptop Sales",
  description: "From the first enquiry to the final dispatch. A laptop sales workspace with sample data.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
