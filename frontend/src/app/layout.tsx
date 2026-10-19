import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppProvider } from '@/lib/store';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Node Microservices Shop',
  description: 'Storefront and admin console for the node-microservices backend',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>
          <Nav />
          <main>{children}</main>
        </AppProvider>
      </body>
    </html>
  );
}
