/**
 * 侧边栏 React 挂载入口（React 18 createRoot）。
 */
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
