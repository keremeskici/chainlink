import type { Metadata } from 'next';
import { Geist_Mono } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { GlobalHeader } from '@/components/GlobalHeader';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'SwarmOracle Protocol',
  description: 'AI-driven resolution simulator for prediction markets',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistMono.variable} antialiased min-h-screen bg-black text-white`}>
        <Providers>
          <GlobalHeader />
          <main className="pt-16 min-h-screen">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
