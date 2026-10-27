import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {AdminApp} from './AdminApp';
import '../../web/src/styles/tokens.css';
import '../../web/src/ui/components.css';
import '../../web/src/styles/styles.css';
import '../../web/src/styles/core.css';
import '../../web/src/live/ux02.css';

createRoot(document.getElementById('root')!).render(<StrictMode><AdminApp/></StrictMode>);
