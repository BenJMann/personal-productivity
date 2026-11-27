import { createRoot } from 'react-dom/client';
import { StoreProvider } from './store';
import { UIProvider } from './ui';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StoreProvider>
    <UIProvider>
      <App />
    </UIProvider>
  </StoreProvider>,
);
