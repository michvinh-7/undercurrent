import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Undercurrent",
  description: "The Hollow's network the Directorate can't shut off.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
