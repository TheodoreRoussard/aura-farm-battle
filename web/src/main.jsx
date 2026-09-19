import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Play from './Play.jsx'
import Screen from './Screen.jsx'
import Sprites from './Sprites.jsx'

// Deux pages, pas de routeur : /screen = écran géant projeté, tout le reste = téléphone.
// /sprites = galerie des personnages (contrôle des dessins et des PNG de remplacement).
const path = location.pathname
const Page = path.startsWith('/screen') ? Screen : path.startsWith('/sprites') ? Sprites : Play
createRoot(document.getElementById('root')).render(<Page />)
