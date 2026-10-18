import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { resolveDocumentWorld } from './world/documentWorld.js';
import './styles.css';

// Resolve once before React; StrictMode and ordinary rerenders must not reroll it.
const documentWorld = resolveDocumentWorld(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App documentWorld={documentWorld} />
  </StrictMode>,
);
