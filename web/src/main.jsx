import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Play from './Play.jsx'
import Screen from './Screen.jsx'

// Deux pages, pas de routeur : /screen = écran géant projeté, tout le reste = téléphone.
const Page = location.pathname.startsWith('/screen') ? Screen : Play
createRoot(document.getElementById('root')).render(<Page />)
