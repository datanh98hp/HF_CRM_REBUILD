import type { Metadata } from 'next';
import './styles.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { CrmSessionProvider } from '@/components/crm-session';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });

export const metadata: Metadata = {
  title: 'Finance CRM',
  description: 'CRM nội bộ cho đội ngũ tư vấn tài chính',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={cn('font-sans', geist.variable)}>
      <body><CrmSessionProvider>{children}</CrmSessionProvider></body>
    </html>
  );
}
