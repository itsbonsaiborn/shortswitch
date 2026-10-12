import type { RouteRecordRaw } from 'vue-router';

export const routes: RouteRecordRaw[] = [
  { path: '/login', component: () => import('./pages/LoginPage.vue'), meta: { title: 'Sign in' } },
  { path: '/', redirect: '/app/links' },
  { path: '/app', redirect: '/app/links' },
  { path: '/app/links', component: () => import('./pages/LinksPage.vue'), meta: { title: 'Links' } },
  { path: '/app/links/:id', component: () => import('./pages/LinkAnalyticsPage.vue'), props: true, meta: { title: 'Link analytics' } },
  { path: '/app/live', component: () => import('./pages/LivePage.vue'), meta: { title: 'Live' } },
  { path: '/app/live/:id', component: () => import('./pages/LiveActivityPage.vue'), meta: { title: 'Live results' } },
  { path: '/app/pages', component: () => import('./pages/PagesPage.vue'), meta: { title: 'Pages' } },
  { path: '/app/pages/new', component: () => import('./pages/PageEditorPage.vue'), meta: { title: 'Create Page' } },
  { path: '/app/pages/:id', component: () => import('./pages/PageEditorPage.vue'), meta: { title: 'Edit Page' } },
  { path: '/app/pages/:id/analytics', component: () => import('./pages/PageAnalyticsPage.vue'), meta: { title: 'Page analytics' } },
  { path: '/app/analytics', component: () => import('./pages/GlobalAnalyticsPage.vue'), meta: { title: 'Analytics' } },
  { path: '/app/settings', component: () => import('./pages/SettingsPage.vue'), meta: { title: 'Settings' } },
  { path: '/present/:slug', component: () => import('./pages/LivePresentationPage.vue'), meta: { public: true } },
  { path: '/:slug', component: () => import('./pages/PublicSlugPage.vue'), meta: { public: true } }
];
