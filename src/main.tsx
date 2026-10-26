import {createRoot} from 'react-dom/client';
import App from './App.tsx';
// Offline-first typography (EXEC-DIR-2023-001 TASK 5): local @fontsource
// bundles guarantee Cairo/Jakarta/Mono on disconnected POS machines.
// Google Fonts CDN links in index.html are progressive enhancement only.
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);
