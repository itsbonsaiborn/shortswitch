import { reactive } from 'vue';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  tone: 'success' | 'error';
}

const state = reactive<{
  items: ToastItem[];
}>({
  items: []
});

const removeToast = (id: string) => {
  state.items = state.items.filter((item) => item.id !== id);
};

const pushToast = (input: Omit<ToastItem, 'id'>) => {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.items = [...state.items.slice(-3), { id, ...input }];
  window.setTimeout(() => removeToast(id), 3600);
};

export const useToast = () => ({
  toasts: state,
  pushToast,
  removeToast
});
