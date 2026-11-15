import "./globals.css";

export const metadata = {
  title: "AETHON - NASA Microgravity Combustion & Fire Safety AI Platform",
  description: "NASA Microgravity Combustion & Fire Safety AI Platform",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#0B0F19",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className="antialiased"
      style={{ colorScheme: "dark", backgroundColor: "#0B0F19" }}
    >
      <body className="min-h-screen bg-[#0B0F19] text-[#eef0ff]">{children}</body>
    </html>
  );
}
