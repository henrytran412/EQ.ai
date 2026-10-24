import { createRoot } from 'react-dom/client'
import App from './App'
import Staff from './Staff'
import './styles.css'

createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/staff') ? <Staff /> : <App />)
