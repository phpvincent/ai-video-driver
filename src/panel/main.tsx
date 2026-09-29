/**
 * 侧边栏 React 挂载入口。
 * 四 Tab（字幕 / 大纲 / 导图 / 问答）由 SPEC-01 子任务 1.5 填充。
 */
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<div />);
}
