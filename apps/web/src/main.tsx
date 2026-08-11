import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

/**
 * 應用程式進入點：把 React 掛到 index.html 的 #root 上。
 *
 * 之後的 Provider（QueryClient、Auth、Router）會在 Step 2 加在這裡，
 * 本步只先確保建置與渲染管線可運作。
 */
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('找不到 #root 容器，index.html 可能被改動。');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
