export type ActivityStatus = 'active' | 'closed';
export type ActivityLifecycleState = 'draft' | 'published' | 'disabled' | 'archived';
export type ActivityIdentityMode = 'anonymous' | 'named';
export type ActivityRequiredAnswerBehavior = 'require_all' | 'allow_incomplete';
export type ActivityNavigationPolicy = 'linear' | 'free';
export type ActivityResultVisibility = 'never' | 'after_submission' | 'after_close';
export type ActivityFeedbackPolicy = 'none' | 'total_points' | 'points_per_question' | 'correct_answers' | 'manual_release';
export type ActivityTheme = 'classic_cream' | 'forest_dark' | 'soft_lavender' | 'ocean_blue' | 'minimal_light';
export type ActivityLayout = 'classic' | 'minimal' | 'soft' | 'bold';
export type ActivityBackgroundPattern = 'none' | 'dots' | 'grid' | 'soft_glow' | 'crosses';
export type ActivityGradingState = 'in_progress' | 'submitted' | 'expired' | 'awaiting_manual_grading' | 'fully_graded';

export type ActivityQuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'open_answer'
  | 'word_cloud'
  | 'ordering'
  | 'matching'
  | 'image_labeling';

export interface ActivitySettings {
  title: string;
  description: string;
  slug: string;
  status: ActivityStatus;
  identityMode: ActivityIdentityMode;
  requiredAnswerBehavior: ActivityRequiredAnswerBehavior;
  navigationPolicy: ActivityNavigationPolicy;
  resultVisibility: ActivityResultVisibility;
  feedbackPolicy: ActivityFeedbackPolicy;
  theme: ActivityTheme;
  layout: ActivityLayout;
  backgroundPattern: ActivityBackgroundPattern;
  patternIntensity: number;
  gradingEnabled: boolean;
  defaultQuestionPoints: number;
  maximumAttempts: number;
  attemptTimeLimitSeconds: number | null;
  availabilityStartAt: string | null;
  submissionDeadlineAt: string | null;
  submissionDeadlineTimezone: string;
  lowTimeWarningSeconds: number | null;
  shuffleQuestionOptions: boolean;
  shuffleSlides: boolean;
  allowBackNavigation: boolean;
}

export interface ActivityChoiceOption {
  id: string;
  label: string;
}

export type ActivityMultipleChoiceGradingMode = 'all_or_nothing' | 'partial';
export type ActivityPositionGradingMode = 'all_or_nothing' | 'partial';
export type ActivityOpenAnswerGradingMode = 'manual' | 'exact' | 'normalized' | 'ungraded';
export type ActivityWordCloudModerationMode = 'off' | 'filter_only' | 'review_all';
export type ActivityWordCloudGradingMode = 'ungraded' | 'participation';

export interface ActivityMatchItem {
  id: string;
  label: string;
}

export interface ActivityImageMarker {
  id: string;
  x: number;
  y: number;
  label?: string;
}

export type ActivityQuestionPublicConfig =
  | {
      questionType: 'single_choice';
      prompt: string;
      description: string;
      options: ActivityChoiceOption[];
      shuffleOptions: boolean;
    }
  | {
      questionType: 'multiple_choice';
      prompt: string;
      description: string;
      options: ActivityChoiceOption[];
      minimumSelections: number;
      maximumSelections: number;
      shuffleOptions: boolean;
      gradingMode: ActivityMultipleChoiceGradingMode;
    }
  | {
      questionType: 'open_answer';
      prompt: string;
      instructions: string;
      responseMode: 'single_line' | 'multiline';
      minimumLength: number;
      maximumLength: number;
      gradingMode: ActivityOpenAnswerGradingMode;
      ignoreCase: boolean;
      normalizeWhitespace: boolean;
    }
  | {
      questionType: 'word_cloud';
      prompt: string;
      instructions: string;
      maximumLength: number;
      allowMultipleResponses: boolean;
      maximumResponses: number;
      moderationMode: ActivityWordCloudModerationMode;
      showResults: boolean;
      showParticipantNames: boolean;
      gradingMode: ActivityWordCloudGradingMode;
    }
  | {
      questionType: 'ordering';
      prompt: string;
      items: ActivityChoiceOption[];
      shuffleItems: boolean;
      gradingMode: ActivityPositionGradingMode;
    }
  | {
      questionType: 'matching';
      prompt: string;
      leftItems: ActivityMatchItem[];
      rightItems: ActivityMatchItem[];
      shuffleLeftItems: boolean;
      shuffleRightItems: boolean;
      gradingMode: ActivityPositionGradingMode;
    }
  | {
      questionType: 'image_labeling';
      prompt: string;
      imageUrl: string;
      imageAlt: string;
      markers: ActivityImageMarker[];
      labels: ActivityChoiceOption[];
      oneToOne: boolean;
      gradingMode: ActivityPositionGradingMode;
    };

export type ActivityContentBlock = (
  | { id: string; type: 'heading'; config: { text: string; level: 1 | 2 | 3 } }
  | { id: string; type: 'text'; config: { text: string } }
  | { id: string; type: 'image'; config: { url: string; alt: string; caption: string } }
  | { id: string; type: 'divider'; config: { style: 'solid' | 'dashed' | 'dotted' } }
) & { stableId?: string };

export interface ActivityQuestionBlock {
  id: string;
  stableId?: string;
  type: 'question';
  questionType: ActivityQuestionType;
  graded: boolean;
  points: number;
  required: boolean;
  config: ActivityQuestionPublicConfig;
}

export type SlideBlock = ActivityContentBlock | ActivityQuestionBlock;

export interface ActivitySlide {
  id: string;
  stableId?: string;
  position: number;
  title: string;
  description: string;
  blocks: SlideBlock[];
}

export interface ActivityDraft {
  activityId: string;
  revision: number;
  slides: ActivitySlide[];
  createdAt: string;
  updatedAt: string;
}

export interface PublishedActivityVersion {
  id: string;
  activityId: string;
  versionNumber: number;
  settings: ActivitySettings;
  slides: ActivitySlide[];
  contentHash: string;
  publishedAt: string;
}

export interface Activity {
  id: string;
  publicUrl: string;
  completedAttemptCount: number;
  lifecycleState: ActivityLifecycleState;
  archivedAt: string | null;
  settings: ActivitySettings;
  draftRevision: number;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityPublishValidationItem {
  code: 'title' | 'slides' | 'content' | 'availability' | 'access';
  valid: boolean;
  message: string;
}

export interface ActivityPublishValidation {
  valid: boolean;
  items: ActivityPublishValidationItem[];
}

export type ActivityAttemptStatus = 'in_progress' | 'submitted' | 'auto_submitted' | 'expired';
export type ActivityResponseGradingStatus = 'pending' | 'graded' | 'manual_review';

export interface ActivityAttempt {
  id: string;
  activityId: string;
  publishedVersionId: string;
  status: ActivityAttemptStatus;
  startedAt: string;
  deadlineAt: string | null;
  submittedAt: string | null;
  submissionReason: 'manual' | 'deadline' | null;
  revision: number;
  score: number | null;
  maximumScore: number;
}

export type ActivitySupportedAnswer =
  | { questionType: 'single_choice'; optionId: string | null }
  | { questionType: 'multiple_choice'; optionIds: string[] }
  | { questionType: 'open_answer'; text: string }
  | { questionType: 'word_cloud'; responses: string[] }
  /** Backward-compatible shape for attempts created before Activities Segment 05. */
  | { questionType: 'word_cloud'; text: string }
  | { questionType: 'ordering'; orderedItemIds: string[] }
  | { questionType: 'matching'; pairs: Array<{ leftId: string; rightId: string }> }
  | { questionType: 'image_labeling'; assignments: Array<{ markerId: string; labelId: string }> };

export interface PublicActivityLanding {
  slug: string;
  title: string;
  description: string;
  status: ActivityStatus;
  identityMode: ActivityIdentityMode;
  maximumAttempts: number;
  attemptTimeLimitSeconds: number | null;
  availabilityStartAt: string | null;
  submissionDeadlineAt: string | null;
  submissionDeadlineTimezone: string;
  serverNow: string;
  publishedVersionNumber: number;
  slideCount: number;
  theme: ActivityTheme;
  layout: ActivityLayout;
  backgroundPattern: ActivityBackgroundPattern;
  patternIntensity: number;
}

export interface PublicActivityAttempt {
  id: string;
  activityId: string;
  slug: string;
  publishedVersionId: string;
  publishedVersionNumber: number;
  status: ActivityAttemptStatus;
  participantName: string | null;
  startedAt: string;
  serverNow: string;
  deadlineAt: string | null;
  individualDeadlineAt: string | null;
  globalDeadlineAt: string | null;
  lowTimeWarningSeconds: number | null;
  submittedAt: string | null;
  submissionReason: 'manual' | 'deadline' | null;
  currentSlideId: string | null;
  revision: number;
  gradingState: ActivityGradingState;
  resultsReleasedAt: string | null;
  settings: Pick<ActivitySettings, 'title' | 'description' | 'navigationPolicy' | 'requiredAnswerBehavior' | 'resultVisibility' | 'feedbackPolicy' | 'theme' | 'layout' | 'backgroundPattern' | 'patternIntensity' | 'allowBackNavigation'>;
  slides: ActivitySlide[];
  responses: Array<{ questionBlockId: string; answer: ActivitySupportedAnswer; clientRevision: number; serverRevision: number; savedAt: string }>;
  result: {
    score: number | null;
    maximumScore: number;
    questions: Array<{
      questionBlockId: string;
      awardedPoints: number | null;
      maximumPoints: number;
      correct: boolean | null;
      feedback: string;
      correctAnswer?: unknown;
    }>;
    wordClouds: Array<{
      questionBlockId: string;
      totalResponses: number;
      uniqueResponses: number;
      items: Array<{ text: string; count: number; participantNames?: string[] }>;
    }>;
  } | null;
}

export interface ActivityAdminAttempt {
  id: string;
  participantName: string | null;
  attemptNumber: number;
  status: ActivityAttemptStatus;
  startedAt: string;
  individualDeadlineAt: string | null;
  globalDeadlineAt: string | null;
  effectiveDeadlineAt: string | null;
  deadlineExtendedAt: string | null;
  deadlineExtendedSeconds: number;
  submittedAt: string | null;
  submissionReason: 'manual' | 'deadline' | null;
  lastSavedAt: string | null;
  score: number | null;
  maximumScore: number;
  gradingState: ActivityGradingState;
  pendingManualGrading: number;
  resultsReleasedAt: string | null;
  durationSeconds: number;
}

export interface ActivityResultsOverview {
  totalAttempts: number;
  submittedAttempts: number;
  expiredAttempts: number;
  inProgressAttempts: number;
  awaitingManualGrading: number;
  averageScore: number | null;
  medianScore: number | null;
  averagePercentage: number | null;
  completionRate: number;
}

export interface ActivityQuestionAnalytics {
  questionId: string;
  questionType: ActivityQuestionType;
  prompt: string;
  attempts: number;
  answered: number;
  unanswered: number;
  fullyCorrect: number;
  correctnessRate: number;
  averageAwardedPoints: number | null;
  maximumPoints: number;
}

export interface ActivityWordCloudAnalytics {
  questionId: string;
  prompt: string;
  totalResponses: number;
  uniqueResponses: number;
  items: Array<{ text: string; count: number }>;
}

export interface ActivityAdminResults {
  overview: ActivityResultsOverview;
  attempts: ActivityAdminAttempt[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  questions: ActivityQuestionAnalytics[];
  wordClouds: ActivityWordCloudAnalytics[];
}

export interface ActivityAdminAttemptResponse {
  questionBlockId: string;
  questionType: ActivityQuestionType;
  prompt: string;
  questionConfig: ActivityQuestionPublicConfig;
  answer: ActivitySupportedAnswer | null;
  moderationStatus: 'approved' | 'pending' | 'rejected';
  moderationReason: string | null;
  gradingStatus: ActivityResponseGradingStatus;
  awardedPoints: number | null;
  maximumPoints: number;
  teacherFeedback: string;
}

export interface ActivityGradingAuditEntry {
  id: string;
  questionBlockId: string | null;
  action: 'automatic' | 'manual' | 'moderation' | 'release';
  previousAwardedPoints: number | null;
  awardedPoints: number | null;
  teacherFeedback: string;
  createdAt: string;
}

export interface ActivityAdminAttemptDetail extends ActivityAdminAttempt {
  responses: ActivityAdminAttemptResponse[];
  audit: ActivityGradingAuditEntry[];
}

export interface ActivityAttemptCredential {
  attemptId: string;
  attemptToken: string;
  attempt: PublicActivityAttempt;
}

export interface ActivityResponse {
  attemptId: string;
  questionBlockId: string;
  answer: unknown;
  serverRevision: number;
  savedAt: string;
  gradingStatus: ActivityResponseGradingStatus;
  awardedPoints: number | null;
}
