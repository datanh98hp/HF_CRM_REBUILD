import type { Metadata } from 'next';
import './styles.css';

export const metadata: Metadata = {
  title: 'Finance CRM',
  description: 'CRM nội bộ cho đội ngũ tư vấn tài chính',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
