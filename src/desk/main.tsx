import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/600.css';
import '@fontsource/cairo/700.css';
import '@fontsource/cairo/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '../index.css';
import { DeskApp } from './DeskApp';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <DeskApp />
  </React.StrictMode>,
);
