import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'حسّنها قبل الإرسال',
  description: 'أداة ذكية لتحسين نبرة الرسائل مع الحفاظ على الرأي والمعنى.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
