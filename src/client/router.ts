import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./pages/LoginPage.vue') },
  { path: '/', redirect: '/app/links' },
  { path: '/app', redirect: '/app/links' },
  { path: '/app/links', component: () => import('./pages/LinksPage.vue') },
  { path: '/app/links/:id', component: () => import('./pages/LinkAnalyticsPage.vue'), props: true },
  { path: '/app/analytics', component: () => import('./pages/GlobalAnalyticsPage.vue') },
  { path: '/app/settings', component: () => import('./pages/SettingsPage.vue') }
];
