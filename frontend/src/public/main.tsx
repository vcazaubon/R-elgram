import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicShareApp } from './PublicShareApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode><PublicShareApp /></StrictMode>,
);
