/**
 * background Service Worker：薄路由、tab → videoId 映射、侧边栏启用。
 * 占位监听骨架，业务逻辑由 SPEC-01 子任务 1.4 填充（TECH-DESIGN §3.2：只做薄路由，不承载长任务）。
 */
chrome.runtime.onMessage.addListener(() => {
  // 消息路由由子任务 1.4 实现
  return false;
});

export {};
