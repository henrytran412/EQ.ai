import { createRoot } from 'react-dom/client'
import App from './App'
import Staff from './Staff'
import './styles.css'

const root = createRoot(document.getElementById('root')!)
// Plain mode (comparison demo) loads as its own chunk, so the main chat never runs its code.
if (location.pathname.startsWith('/plain')) void import('./PlainChat').then((m) => root.render(<m.default />))
else root.render(location.pathname.startsWith('/staff') ? <Staff /> : <App />)
