import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
const path = location.pathname
// Plain mode (comparison demo) and the advisor view load as their own chunks, so the main chat never runs their code.
if (path.startsWith('/plain')) void import('./PlainChat').then((m) => root.render(<m.default />))
else if (path.startsWith('/advisor')) void import('./AdvisorView').then((m) => root.render(<m.default />))
else root.render(<App />)
