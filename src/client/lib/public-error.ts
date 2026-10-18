import { ApiError } from './api';

type PublicErrorContext = 'live' | 'page' | 'presentation';
type Translate = (key: string, params?: Record<string, string | number>) => string;

const exactKeys: Record<string, string> = {
  'Activity not found.': 'public.activityNotFound',
  'This activity has expired.': 'public.activityExpired',
  'This activity is closed.': 'public.activityClosed',
  'Results are not public.': 'public.resultsPrivate',
  'Response limit reached for this activity.': 'public.responseLimit',
  'A valid participant identifier is required.': 'public.participantRequired',
  'Participant name must contain between 1 and 80 characters.': 'public.participantNameLength',
  'Select a valid answer option.': 'public.validOption',
  'Only one option can be selected.': 'public.singleOption',
  'Select a valid scale value.': 'public.validScale',
  'Invalid pagination cursor.': 'public.invalidPagination',
  'Invalid page limit.': 'public.invalidPagination',
  'This result view is not available for the activity type.': 'public.resultUnavailable',
  'Too many responses. Please try again later.': 'public.tooManyRequests',
  'Page not found.': 'public.pageUnavailable'
};

export const localizePublicError = (
  error: unknown,
  translate: Translate,
  context: PublicErrorContext
) => {
  const message = error instanceof Error ? error.message : '';
  const exactKey = exactKeys[message];
  if (exactKey) return translate(exactKey);

  const answerLength = /^Answer must contain between 1 and (\d+) characters\.$/.exec(message);
  if (answerLength) return translate('public.answerLength', { max: Number(answerLength[1]) });

  if (error instanceof ApiError) {
    if (error.status === 410) return translate('public.activityExpired');
    if (error.status === 429) return translate('public.tooManyRequests');
    if (error.status === 403) return translate('public.accessDenied');
    if (error.status === 404) {
      if (context === 'page') return translate('public.pageUnavailable');
      if (context === 'presentation') return translate('public.presentationUnavailable');
      return translate('public.activityNotFound');
    }
  }

  if (context === 'page') return translate('public.pageUnavailable');
  if (context === 'presentation') return translate('public.presentationUnavailable');
  return translate('public.requestFailed');
};
