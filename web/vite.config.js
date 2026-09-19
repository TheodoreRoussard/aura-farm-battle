import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ../shared contient le code commun au front, au serveur et aux scripts.
  server: { fs: { allow: ['..'] } },
})
