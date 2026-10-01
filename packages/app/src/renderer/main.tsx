import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/cinzel/500.css'
import '@fontsource/cinzel/600.css'
// Order matters: axi.css declares the tokens, accents.css overrides
// --axi-accent per [data-axi-accent], the two theme files restate the whole
// token set per [data-axi-theme], and this app's own stylesheet comes last so
// its remaining local rules win without contesting specificity.
import '@axiapps/axi-design/axi.css'
import '@axiapps/axi-design/accents.css'
import '@axiapps/axi-design/themes/flat.css'
import '@axiapps/axi-design/themes/glass.css'
import { App } from './App.js'
import { bootAppearance } from './appearance.js'
import './styles.css'

// Before createRoot, so the first paint is already the right accent and surface.
bootAppearance()

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
