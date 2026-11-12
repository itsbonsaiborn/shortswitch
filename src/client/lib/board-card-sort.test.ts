// @vitest-environment node
import { describe, expect, test } from 'vitest';
import type { PublicBoardCard } from '@/shared/board-types';
import { sortBoardCards } from './board-card-sort.js';

const card = (id: string, title: string, createdAt: string, likes = 0) => ({
  id,
  title,
  createdAt,
  reactions: { likes, dislikes: 0, current: null }
}) as PublicBoardCard;

describe('Board card sorting', () => {
  const cards = [
    card('card-b', 'Bērzs', '2026-11-10T10:00:00.000Z'),
    card('card-a', 'Ābele', '2026-11-10T12:00:00.000Z'),
    card('card-c', 'Aina', '2026-11-10T12:00:00.000Z')
  ];

  test('sorts newest and oldest with stable IDs for equal timestamps', () => {
    expect(sortBoardCards(cards, 'newest', 'en').map((item) => item.id))
      .toEqual(['card-a', 'card-c', 'card-b']);
    expect(sortBoardCards(cards, 'oldest', 'en').map((item) => item.id))
      .toEqual(['card-b', 'card-a', 'card-c']);
  });

  test('uses locale-aware Latvian alphabetical ordering', () => {
    expect(sortBoardCards(cards, 'title_asc', 'lv').map((item) => item.title))
      .toEqual(['Aina', 'Ābele', 'Bērzs']);
    expect(sortBoardCards(cards, 'title_desc', 'lv').map((item) => item.title))
      .toEqual(['Bērzs', 'Ābele', 'Aina']);
  });

  test('keeps equal titles deterministic independently of input order', () => {
    const equal = [card('z', 'Same', '2026-01-01T00:00:00Z'), card('a', 'same', '2026-01-02T00:00:00Z')];
    expect(sortBoardCards(equal, 'title_asc', 'en').map((item) => item.id)).toEqual(['a', 'z']);
    expect(sortBoardCards([...equal].reverse(), 'title_asc', 'en').map((item) => item.id)).toEqual(['a', 'z']);
  });

  test('sorts popularity by likes with deterministic newest and ID fallbacks', () => {
    const popular = [
      card('old-popular', 'Old', '2026-01-01T00:00:00Z', 8),
      card('new-popular-b', 'New B', '2026-01-02T00:00:00Z', 8),
      card('new-popular-a', 'New A', '2026-01-02T00:00:00Z', 8),
      card('less-popular', 'Less', '2026-01-03T00:00:00Z', 2)
    ];
    expect(sortBoardCards(popular, 'popular', 'en').map((item) => item.id)).toEqual([
      'new-popular-a', 'new-popular-b', 'old-popular', 'less-popular'
    ]);
  });
});
