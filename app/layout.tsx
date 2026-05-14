import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'LINE秘書Bot',
  description: 'AIを活用したLINE秘書Bot',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
