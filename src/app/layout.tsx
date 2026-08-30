import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sales Branch Report Data Monitoring',
  description:
    'Sistem pelaporan mingguan cabang, rekap nasional otomatis, dan monitoring alasan perubahan data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
