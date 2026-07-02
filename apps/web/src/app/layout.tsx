import './globals.css';
import { Providers } from '../components/Providers';

export const metadata = { title: 'KAFIL — Desktop' };

// Apply the saved theme BEFORE first paint so there's no flash of the wrong palette.
// Runs synchronously in <head>; falls back to system (no attribute) on any error.
const noFlashTheme = `(function(){try{var m=localStorage.getItem('kafil.theme');if(m==='light'||m==='dark')document.documentElement.setAttribute('data-theme',m);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ps" dir="rtl">
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
