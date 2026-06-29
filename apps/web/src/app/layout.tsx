import './globals.css';

export const metadata = { title: 'KAFIL — Desktop' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ps" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
