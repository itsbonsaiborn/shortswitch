import { ref } from 'vue';
import { api } from '../lib/api';
import type { PublicAppConfig } from '@/shared/types';
import { useDisplayPreferences } from './useDisplayPreferences';

const appName = ref('ShortSwitch');
const appDescription = ref('Privacy-aware self-hosted URL shortener with secure links and lightweight analytics.');
let loadPromise: Promise<void> | null = null;

export const useAppConfig = () => {
  const { setPublicDisplayPreferences } = useDisplayPreferences();
  const loadAppConfig = async () => {
    if (!loadPromise) {
      loadPromise = api<PublicAppConfig>('/api/public/config')
        .then((config) => {
          appName.value = config.appName;
          appDescription.value = config.appDescription;
          setPublicDisplayPreferences(config.publicDisplayPreferences);
        })
        .catch(() => {
          loadPromise = null;
        });
    }
    await loadPromise;
  };

  return {
    appName,
    appDescription,
    loadAppConfig
  };
};
