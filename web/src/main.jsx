import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Deux pages, pas de routeur : /screen = écran géant projeté (classement + régie), tout le reste = téléphone.
// /sprites = galerie des personnages (contrôle des dessins et des PNG de remplacement).
// Import dynamique : chaque page démarre ses stores en se chargeant. Importer Play.jsx sur /screen y créerait
// un wallet joueur qui réclamerait une dotation de MON pour rien.
const path = location.pathname
const page = path.startsWith('/screen') ? import('./Screen.jsx') : path.startsWith('/sprites') ? import('./Sprites.jsx') : import('./Play.jsx')
page.then(({ default: Page }) => createRoot(document.getElementById('root')).render(<Page />))
