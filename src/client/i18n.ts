import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import lv from './locales/lv.json';
import type { Locale } from '@/shared/types';
import { isPublicClientPath, resolvePublicLocale } from '@/shared/public-locale';

const initialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  if (isPublicClientPath(window.location.pathname)) {
    return resolvePublicLocale(window.navigator.language);
  }
  try {
    const cached = JSON.parse(window.localStorage.getItem('ss_preferences_active') ?? 'null') as { locale?: unknown } | null;
    return cached?.locale === 'lv' ? 'lv' : 'en';
  } catch {
    return 'en';
  }
};

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: {
    en: { ...en, boards: { ...en.boards, requireCardTitle: en.boardCards.requireTitle, addCard: en.boardCards.add, editCard: en.boardCards.edit, cardDialog: en.boardCards.dialog, cardTitle: en.boardCards.title, cardBody: en.boardCards.body, cardLayout: en.boardCards.layout, layoutText: en.boardCards.layoutText, layoutImageText: en.boardCards.layoutImageText, layoutCompact: en.boardCards.layoutCompact, imageUrl: en.boardCards.imageUrl, displayName: en.boardCards.displayName, cardImage: en.boardCards.image, pinTitle: en.boardCards.pinTitle, pinDescription: en.boardCards.pinDescription, recoveryPin: en.boardCards.recoveryPin, recoverAccess: en.boardCards.recover, recoverDescription: en.boardCards.recoverDescription, restoreEditing: en.boardCards.restore, deleteCardTitle: en.boardCards.deleteTitle, deleteCardDescription: en.boardCards.deleteDescription, approved: en.boardCards.approved, rejected: en.boardCards.rejected, manageCards: en.boardCards.manage, manageCardsDescription: en.boardCards.manageDescription, approve: en.boardCards.approve, reject: en.boardCards.reject, resetOwnership: en.boardCards.resetOwnership, resetOwnershipConfirm: en.boardCards.resetConfirm, newRecoveryPin: en.boardCards.newPin, untitledCard: en.boardCards.untitled, cardSaved: en.boardCards.saved, sortBy: en.boardCards.sortBy, sortNewest: en.boardCards.sortNewest, sortOldest: en.boardCards.sortOldest, sortTitleAsc: en.boardCards.sortTitleAsc, sortTitleDesc: en.boardCards.sortTitleDesc, likeCard: en.boardCards.likeCard, dislikeCard: en.boardCards.dislikeCard } },
    lv: { ...lv, boards: { ...lv.boards, requireCardTitle: lv.boardCards.requireTitle, addCard: lv.boardCards.add, editCard: lv.boardCards.edit, cardDialog: lv.boardCards.dialog, cardTitle: lv.boardCards.title, cardBody: lv.boardCards.body, cardLayout: lv.boardCards.layout, layoutText: lv.boardCards.layoutText, layoutImageText: lv.boardCards.layoutImageText, layoutCompact: lv.boardCards.layoutCompact, imageUrl: lv.boardCards.imageUrl, displayName: lv.boardCards.displayName, cardImage: lv.boardCards.image, pinTitle: lv.boardCards.pinTitle, pinDescription: lv.boardCards.pinDescription, recoveryPin: lv.boardCards.recoveryPin, recoverAccess: lv.boardCards.recover, recoverDescription: lv.boardCards.recoverDescription, restoreEditing: lv.boardCards.restore, deleteCardTitle: lv.boardCards.deleteTitle, deleteCardDescription: lv.boardCards.deleteDescription, approved: lv.boardCards.approved, rejected: lv.boardCards.rejected, manageCards: lv.boardCards.manage, manageCardsDescription: lv.boardCards.manageDescription, approve: lv.boardCards.approve, reject: lv.boardCards.reject, resetOwnership: lv.boardCards.resetOwnership, resetOwnershipConfirm: lv.boardCards.resetConfirm, newRecoveryPin: lv.boardCards.newPin, untitledCard: lv.boardCards.untitled, cardSaved: lv.boardCards.saved, sortBy: lv.boardCards.sortBy, sortNewest: lv.boardCards.sortNewest, sortOldest: lv.boardCards.sortOldest, sortTitleAsc: lv.boardCards.sortTitleAsc, sortTitleDesc: lv.boardCards.sortTitleDesc, likeCard: lv.boardCards.likeCard, dislikeCard: lv.boardCards.dislikeCard } }
  }
});

export const setDocumentLocale = (locale: Locale) => {
  i18n.global.locale.value = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
};
