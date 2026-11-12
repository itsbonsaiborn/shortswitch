import type { PublicBoardCard } from '@/shared/board-types';

export type BoardCardSortMode = 'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'popular';

const stableIdOrder = (left: PublicBoardCard, right: PublicBoardCard) => left.id.localeCompare(right.id);

export const sortBoardCards = (
  cards: readonly PublicBoardCard[],
  mode: BoardCardSortMode,
  locale: string
) => {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return [...cards].sort((left, right) => {
    if (mode === 'popular') {
      const likeDifference = right.reactions.likes - left.reactions.likes;
      if (likeDifference !== 0) return likeDifference;
      const createdDifference = Date.parse(right.createdAt) - Date.parse(left.createdAt);
      if (createdDifference !== 0) return createdDifference;
      return stableIdOrder(left, right);
    }
    if (mode === 'newest' || mode === 'oldest') {
      const difference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (difference !== 0) return mode === 'newest' ? -difference : difference;
      return stableIdOrder(left, right);
    }
    const titleOrder = collator.compare(left.title.trim(), right.title.trim());
    if (titleOrder !== 0) return mode === 'title_asc' ? titleOrder : -titleOrder;
    return stableIdOrder(left, right);
  });
};
