import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import { routes } from './router';
import './styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes
});

const app = createApp(App);
app.use(router);

// Resolve the initial URL before App's auth watcher is mounted. Otherwise a
// cold load of a public `/:slug` route can briefly look protected and redirect
// an unauthenticated participant to /login.
void router.isReady().then(() => app.mount('#app'));
