import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CancelAccountDeletionUseCase,
  CreateBudgetUseCase,
  CreateLoanUseCase,
  DeleteTransactionUseCase,
  ExportTransactionsUseCase,
  GenerateDashboardUseCase,
  GenerateReportUseCase,
  GetUserSettingsSummaryUseCase,
  ListBudgetsUseCase,
  ListDraftsUseCase,
  ListOpenDebtsUseCase,
  ListOpenLoansUseCase,
  LogLoanPaymentUseCase,
  ProcessConversationEventUseCase,
  ProvisionTelegramUserUseCase,
  RequestAccountDeletionUseCase,
  RouteCallbackQueryUseCase,
  RouteDocumentMessageUseCase,
  RouteOcrDraftCallbackUseCase,
  RoutePhotoMessageUseCase,
  RouteTextMessageUseCase,
  RouteVoiceMessageUseCase,
  SearchTransactionsUseCase,
  SETTINGS_PREFERENCE_KEYS,
  SetUserPreferenceUseCase,
  CreateCustomCategoryUseCase,
  CustomCategoryNotFoundError,
  DeleteCustomCategoryUseCase,
  ListCustomCategoriesUseCase,
  TransactionAlreadyDeletedError,
  TransactionNotFoundError,
  UnauthorizedTransactionAccessError,
  UndoLastTransactionActionUseCase,
  UpdateUserProfileUseCase,
  computeCurrentDateTimeInTimezone,
} from '@afa/application';
import type {
  ProcessConversationEventOutcome,
  RouteCallbackQueryOutcome,
  RouteTextMessageOutcome,
  UpdateUserProfileField,
} from '@afa/application';
import {
  ACCOUNT_DELETION_CONFIRMATION_REPOSITORY,
  CATEGORY_REPOSITORY,
  CURRENCY_REPOSITORY,
  CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY,
  LOAN_WIZARD_STATE_REPOSITORY,
  REPORT_QUERY_REPOSITORY,
  SEARCH_SESSION_REPOSITORY,
  LoanOverpaymentError,
  NegativeAmortizationError,
  accountDeletionGracePeriodDaysRemaining,
  calculateNextLoanDueDate,
  compareDecimalAmounts,
  computeMonthlyBoundary,
  convertPercentToDecimalFraction,
  generateClarificationFallbackMessage,
  isCustomCategoryWizardStateExpired,
  isLoanWizardStateExpired,
  isSearchSessionExpired,
  isValidDecimalAmount,
  isValidNonNegativeDecimalAmount,
  resolveReplyLanguage,
  subtractDecimalAmounts,
  toDetectedLanguage,
} from '@afa/domain';
import type {
  AccountDeletionConfirmationRepository,
  BudgetPeriodType,
  CategoryAmount,
  CategoryRepository,
  CurrencyRepository,
  CustomCategoryWizardStateRecord,
  CustomCategoryWizardStateRepository,
  DetectedLanguage,
  LoanCreateDraft,
  LoanInstallmentFrequency,
  LoanPaymentDraft,
  LoanWizardStateRecord,
  LoanWizardStateRepository,
  LoanWizardStep,
  MerchantAmount,
  ReportDateRange,
  ReportQueryRepository,
  SearchFilterField,
  SearchFilters,
  SearchSessionRecord,
  SearchSessionRepository,
  TransactionType,
  User,
} from '@afa/domain';
import type { EnvironmentVariables } from '@afa/shared';
import { requireCurrentUserId, runWithUserContext } from '@afa/shared';
import type { InlineKeyboardMarkup, Update } from 'telegraf/types';
import { message } from 'telegraf/filters';
import { Telegraf } from 'telegraf';

import {
  buildAccountDeletionConfirmKeyboard,
  buildCancelPendingDeletionKeyboard,
} from './account-deletion-keyboard';
import {
  buildBatchReviewKeyboard,
  buildBatchSummaryKeyboard,
  buildConfirmationKeyboard,
  buildLoanWizardConfirmationKeyboard,
} from './confirmation-keyboard';
import { COMMAND_DEFINITIONS, IMPLEMENTED_COMMANDS } from './command-registry';
import {
  buildSearchFilterMenuKeyboard,
  buildSearchResultsKeyboard,
  buildSearchTypeKeyboard,
  isSearchTransactionType,
} from './search-keyboard';
import {
  PICKER_LOOKBACK_DAYS,
  RANGE_REPORT_TYPES,
  buildReportBackKeyboard,
  buildReportCategoryPickerKeyboard,
  buildReportMenuKeyboard,
  buildReportMerchantPickerKeyboard,
  buildReportRangePresetKeyboard,
  hashMerchant,
  isReportType,
  type ReportType,
} from './report-keyboard';
import {
  buildExportMenuKeyboard,
  isExportRangePreset,
  type ExportRangePreset,
} from './export-keyboard';
import {
  buildCustomCategoriesListKeyboard,
  buildCustomCategoryDeleteConfirmKeyboard,
  buildCustomCategoryParentKeyboard,
  buildSettingsBackKeyboard,
  buildSettingsConfidenceKeyboard,
  buildSettingsCurrencyKeyboard,
  buildSettingsLanguageKeyboard,
  buildSettingsMenuKeyboard,
  buildSettingsNotificationsKeyboard,
  buildSettingsTimezoneKeyboard,
} from './settings-keyboard';
import {
  accountDeletionAlreadyPendingReply,
  accountDeletionCancelledReply,
  accountDeletionCancelNotPendingReply,
  accountDeletionConfirmPromptReply,
  accountDeletionGracePeriodExpiredReply,
  accountDeletionNotEligibleReply,
  accountDeletionRequestedReply,
  accountDeletionTypeToConfirmReply,
  accountDeletionWrongTextReply,
  accountSuspendedPendingDeletionReply,
  awaitingConfirmationGuidanceReply,
  batchCancelConfirmationReply,
  batchReviewCompleteReply,
  budgetCategoryNotFoundReply,
  budgetCreatedReply,
  budgetCreateUsageReply,
  budgetDuplicateReply,
  budgetInvalidArgsReply,
  askSearchCategoryReply,
  askSearchDateFromReply,
  askSearchDateToReply,
  askSearchMaxAmountReply,
  askSearchMerchantReply,
  askSearchMinAmountReply,
  askSearchTagsReply,
  cancelledReply,
  clarificationAckReply,
  commandNotYetAvailableReply,
  dashboardEmptyReply,
  documentNotYetSupportedReply,
  documentUnsupportedReply,
  editFieldNotSupportedReply,
  editPromptReply,
  editValueAcceptedReply,
  editValueInvalidReply,
  extractionUnknownReply,
  groupChatRejectionMessage,
  helpMessage,
  interruptionNote,
  invalidSearchAmountReply,
  invalidSearchCategoryReply,
  invalidSearchDateReply,
  malformedCallbackReply,
  nothingToCancelReply,
  noTransactionDetectedReply,
  renderSearchResults,
  searchFilterMenuReply,
  searchNoResultsReply,
  searchResultAlreadyGoneReply,
  searchResultDeletedReply,
  searchSessionExpiredReply,
  photoAckReply,
  photoInvalidReply,
  renderBatchAllHighConfidenceCommittedMessage,
  renderBatchHighConfidenceCommittedMessage,
  renderBatchItemMessage,
  renderBatchSummaryMessage,
  renderBudgetsList,
  renderConfirmationMessage,
  renderDashboard,
  renderDebtsList,
  renderDraftsList,
  staleCallbackReply,
  storageFailureReply,
  undoneReply,
  unsupportedMessageTypeReply,
  voiceAckReply,
  voiceInvalidReply,
  welcomeNewUserMessage,
  welcomeReturningUserMessage,
  askLoanCurrencyReply,
  askLoanInstallmentAmountReply,
  askLoanInstallmentFrequencyReply,
  askLoanInterestRateReply,
  askLoanLenderReply,
  askLoanPaymentAmountReply,
  askLoanPrincipalReply,
  askLoanSelectionReply,
  askLoanStartDateReply,
  invalidLoanCurrencyReply,
  invalidLoanInstallmentAmountReply,
  invalidLoanInstallmentFrequencyReply,
  invalidLoanInterestRateReply,
  invalidLoanLenderReply,
  invalidLoanPaymentAmountReply,
  invalidLoanPrincipalReply,
  invalidLoanSelectionReply,
  invalidLoanStartDateReply,
  loanCreateCancelledReply,
  loanCreatedReply,
  loanNegativeAmortizationReply,
  loanNotFoundReply,
  loanOverpaymentReply,
  loanPaymentCancelledReply,
  loanPaymentConflictReply,
  loansUsageReply,
  noActiveLoanWizardReply,
  noOpenLoansForPaymentReply,
  renderLoanCreateConfirmation,
  renderLoanDetails,
  renderLoanPaymentConfirmation,
  renderLoanPaymentResult,
  renderLoansList,
  ocrDraftConfirmedReply,
  ocrDraftCommitFailedReply,
  ocrDraftRetryReply,
  reportCategoryPickerReply,
  reportEmptyReply,
  reportErrorReply,
  reportMenuReply,
  reportMerchantPickerReply,
  reportRangePromptReply,
  renderCashFlowReport,
  renderCategoryReport,
  renderCustomRangeReport,
  renderDailyReport,
  renderDebtSummaryReport,
  renderMerchantReport,
  renderMonthlyReport,
  renderQuarterlyReport,
  renderTrendAnalysisReport,
  renderWeeklyReport,
  renderYearlyReport,
  splitTelegramMessage,
  exportEmptyReply,
  exportErrorReply,
  exportMenuReply,
  exportReadyCaption,
  exportTooLargeReply,
  settingsConfidencePromptReply,
  settingsConfidenceToggledReply,
  settingsCurrencyPromptReply,
  settingsErrorReply,
  settingsInvalidValueReply,
  settingsLanguagePromptReply,
  settingsMenuReply,
  settingsNotificationsPromptReply,
  settingsNotificationToggledReply,
  settingsProfileUpdatedReply,
  settingsTimezonePromptReply,
  undoErrorReply,
  undoNothingToUndoReply,
  undoRemovedReply,
  undoRestoredReply,
  undoUnsupportedActionReply,
  customCategoriesListReply,
  customCategoryCreatedReply,
  customCategoryDeletedReply,
  customCategoryDeletePreviewReply,
  customCategoryDuplicateNameReply,
  customCategoryErrorReply,
  customCategoryInvalidNameReply,
  customCategoryInvalidParentReply,
  customCategoryNamePromptReply,
  customCategoryNotFoundReply,
  customCategoryParentPromptReply,
} from './reply-messages';
import { downloadTelegramFile } from './telegram-file-downloader';
import type { BotContext } from './bot-context';

/**
 * Transport only. Update handlers here must never contain business logic —
 * they parse/route a Telegram update and delegate to an @afa/application
 * use-case (TASK-BOT-001's own architecture rule: Telegram handlers stay
 * thin adapters; state-machine, extraction, and edit-validation logic all
 * live in @afa/application/@afa/domain, reused here unchanged).
 */
@Injectable()
export class TelegramBotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private readonly bot: Telegraf<BotContext>;

  constructor(
    // Explicit @Inject — belt-and-suspenders alongside this app's own
    // vitest.config.ts SWC fix (see that file's doc comment): vitest's
    // default esbuild transform cannot reliably emit `design:paramtypes`
    // for every constructor param (this one — a generic type parameterized
    // by a type-only import — was the first found to break; a plain class
    // one position later broke too once this one was pinned, which is why
    // the systemic SWC fix, not per-parameter patching, is the real fix).
    // The real `tsc -b` production build already emits this metadata
    // correctly regardless — confirmed by compiling this app's own dist/
    // output directly with plain node. Left in place since an explicit
    // token is harmless and slightly more robust than relying on inference
    // alone for this specific param.
    @Inject(ConfigService) private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly provisionTelegramUser: ProvisionTelegramUserUseCase,
    private readonly routeTextMessage: RouteTextMessageUseCase,
    private readonly routeCallbackQuery: RouteCallbackQueryUseCase,
    private readonly routeVoiceMessage: RouteVoiceMessageUseCase,
    private readonly routePhotoMessage: RoutePhotoMessageUseCase,
    private readonly routeDocumentMessage: RouteDocumentMessageUseCase,
    private readonly processConversationEvent: ProcessConversationEventUseCase,
    private readonly listDrafts: ListDraftsUseCase,
    private readonly listOpenDebts: ListOpenDebtsUseCase,
    private readonly generateDashboard: GenerateDashboardUseCase,
    private readonly listBudgets: ListBudgetsUseCase,
    private readonly createBudget: CreateBudgetUseCase,
    @Inject(CATEGORY_REPOSITORY) private readonly categoryRepository: CategoryRepository,
    private readonly createLoan: CreateLoanUseCase,
    private readonly logLoanPayment: LogLoanPaymentUseCase,
    private readonly listOpenLoans: ListOpenLoansUseCase,
    @Inject(LOAN_WIZARD_STATE_REPOSITORY)
    private readonly loanWizardStateRepository: LoanWizardStateRepository,
    @Inject(CURRENCY_REPOSITORY) private readonly currencyRepository: CurrencyRepository,
    private readonly searchTransactions: SearchTransactionsUseCase,
    private readonly deleteTransactionUseCase: DeleteTransactionUseCase,
    @Inject(SEARCH_SESSION_REPOSITORY)
    private readonly searchSessionRepository: SearchSessionRepository,
    private readonly requestAccountDeletion: RequestAccountDeletionUseCase,
    private readonly cancelAccountDeletion: CancelAccountDeletionUseCase,
    @Inject(ACCOUNT_DELETION_CONFIRMATION_REPOSITORY)
    private readonly accountDeletionConfirmationRepository: AccountDeletionConfirmationRepository,
    private readonly routeOcrDraftCallback: RouteOcrDraftCallbackUseCase,
    private readonly generateReport: GenerateReportUseCase,
    @Inject(REPORT_QUERY_REPOSITORY) private readonly reportQueryRepository: ReportQueryRepository,
    private readonly exportTransactions: ExportTransactionsUseCase,
    private readonly getUserSettingsSummary: GetUserSettingsSummaryUseCase,
    private readonly updateUserProfile: UpdateUserProfileUseCase,
    private readonly setUserPreference: SetUserPreferenceUseCase,
    private readonly undoLastTransactionAction: UndoLastTransactionActionUseCase,
    private readonly createCustomCategory: CreateCustomCategoryUseCase,
    private readonly listCustomCategories: ListCustomCategoriesUseCase,
    private readonly deleteCustomCategory: DeleteCustomCategoryUseCase,
    @Inject(CUSTOM_CATEGORY_WIZARD_STATE_REPOSITORY)
    private readonly customCategoryWizardStateRepository: CustomCategoryWizardStateRepository,
  ) {
    const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is required to start the Telegram Bot app');
    }

    this.bot = new Telegraf<BotContext>(token);
    this.registerHandlers();
  }

  /** Exposed for the webhook controller (TASK-BOT-001's §3.3.1 ingress) — never called by long-polling mode, where Telegraf drives updates itself. */
  async handleUpdate(update: Update): Promise<void> {
    await this.bot.handleUpdate(update);
  }

  private registerHandlers(): void {
    this.bot.use(async (ctx, next) => {
      // §7.2.9/§7.8.5 — MVP is 1:1 private chat only; group content must
      // never reach provisioning, AI, OCR/STT, or any persistent log
      // beyond this rejection itself (AC-CMA-005).
      if (ctx.chat && ctx.chat.type !== 'private') {
        // No `ctx.provisioning` yet at this point (provisioning happens
        // below, only for chats that pass this check) — resolved from
        // Telegram's own `language_code` alone, the same best-effort source
        // `ProvisionTelegramUserUseCase.derivePreferredLanguage` uses.
        const language = resolveReplyLanguage(
          this.languageFromTelegramCode(ctx.from?.language_code),
          null,
        );
        await ctx.reply(groupChatRejectionMessage(language));
        return;
      }

      if (ctx.from) {
        const { user, isNewUser } = await this.provisionTelegramUser.execute({
          telegramUserId: BigInt(ctx.from.id),
          telegramUsername: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
          languageCode: ctx.from.language_code,
        });
        ctx.provisioning = { isNewUser, user };

        // TASK-AUTH-006 (FR-RET-001 — "all bot functionality suspended
        // immediately"). Checked here, before `next()`, so it blocks every
        // command/text/voice/photo/document/callback handler uniformly —
        // mirrors the group-chat rejection check immediately above in
        // shape (a hard stop before any handler-specific logic runs), and
        // deliberately does NOT touch `ProvisionTelegramUserUseCase`
        // (TASK-AUTH-001) itself, which already returns the user's real
        // current status unchanged; this is the minimal additive branch,
        // scoped entirely to this transport-layer middleware.
        //
        // Two, and only two, exceptions let a `pending_deletion` update
        // through instead of being blocked: the "Cancel account deletion"
        // button (`delacct_cancel_pending` — a fixed literal, never carrying
        // any user id, so a stale button can never act on a different
        // user's account, since the handler always resolves the acting
        // user via `requireCurrentUserId()`, never from callback_data), and
        // a repeated `/deleteaccount` (so it can report an honest
        // status/grace-period reply instead of the generic suspension
        // notice). `deleted` never qualifies for either exception — that
        // status is not a real, reachable state once TASK-AUTH-006's own
        // hard-delete purge runs (the `users` row is gone entirely, not
        // soft-marked), kept here only as defensive dead-code.
        if (user.status === 'pending_deletion' || user.status === 'deleted') {
          const callbackData =
            ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
          const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
          const isAllowedException =
            user.status === 'pending_deletion' &&
            (callbackData === 'delacct_cancel_pending' ||
              messageText?.startsWith('/deleteaccount'));

          if (!isAllowedException) {
            const language = this.replyLanguageFor(user, null);
            const daysRemaining = user.deletionRequestedAt
              ? accountDeletionGracePeriodDaysRemaining(user.deletionRequestedAt, new Date())
              : 0;
            await ctx.reply(accountSuspendedPendingDeletionReply(daysRemaining, language));
            return;
          }
        }

        // TASK-DB-011 — every handler this update reaches, and every
        // database call any of them make (directly or via an
        // @afa/application use case), runs with this resolved, authenticated
        // user's id available to the RLS user-context mechanism.
        await runWithUserContext(user.id, next);
        return;
      }
      await next();
    });

    this.bot.start((ctx) => {
      this.logger.log(`/start received from telegram_user_id=${ctx.from.id}`);
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      return ctx.provisioning?.isNewUser
        ? ctx.reply(welcomeNewUserMessage(language))
        : ctx.reply(welcomeReturningUserMessage(language));
    });

    this.bot.command('help', (ctx) =>
      ctx.reply(helpMessage(this.replyLanguageFor(ctx.provisioning!.user, null))),
    );

    this.bot.command('cancel', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      const userId = requireCurrentUserId();

      // TASK-FIN-004 (Stage I) — the Loan Wizard is a SEPARATE state
      // machine from ConversationState (see `loan-wizard-state.entity.ts`'s
      // own doc comment); an active wizard takes priority for /cancel since
      // it is what the user is actually engaged with, and the two machines
      // are otherwise independent (never both meaningfully active at once
      // in practice — Loan Wizard steps intercept plain text before
      // `RouteTextMessageUseCase` ever runs, so no AWAITING_CLARIFICATION-
      // style state accumulates while a wizard is open).
      const wizardState = await this.loanWizardStateRepository.get(userId);
      if (wizardState) {
        await this.loanWizardStateRepository.compareAndSet(userId, wizardState.version, null);
        await ctx.reply(
          wizardState.createDraft !== null
            ? loanCreateCancelledReply(language)
            : loanPaymentCancelledReply(language),
        );
        return;
      }

      const outcome = await this.processConversationEvent.execute(requireCurrentUserId(), {
        type: 'CANCELLATION',
      });
      await ctx.reply(this.cancellationReplyFor(outcome, language));
    });

    this.bot.command('drafts', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      const drafts = await this.listDrafts.execute({
        userId: requireCurrentUserId(),
        currentDateTime: new Date(),
      });
      await ctx.reply(renderDraftsList(drafts, language));
    });

    this.bot.command('debts', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      const debts = await this.listOpenDebts.execute({ userId: requireCurrentUserId() });
      await ctx.reply(renderDebtsList(debts, language));
    });

    this.bot.command('dashboard', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      const result = await this.generateDashboard.execute(requireCurrentUserId());
      await ctx.reply(
        result.kind === 'empty' ? dashboardEmptyReply(language) : renderDashboard(result, language),
      );
    });

    this.bot.command('search', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await this.startSearchSession(ctx, language);
    });

    this.bot.command('deleteaccount', async (ctx) => {
      const user = ctx.provisioning!.user;
      const language = this.replyLanguageFor(user, null);
      await this.showDeleteAccountPrompt(ctx, user, language);
    });

    this.bot.command('loans', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await this.handleLoansCommand(ctx.message.text, language, ctx);
    });

    this.bot.command('budget', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await this.handleBudgetCommand(ctx.message.text, ctx.provisioning!.user, language, ctx);
    });

    this.bot.command('report', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await ctx.reply(reportMenuReply(language), {
        reply_markup: buildReportMenuKeyboard(language),
      });
    });

    this.bot.command('export', async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await this.showExportMenu(ctx, language);
    });

    this.bot.command('settings', async (ctx) => {
      const userId = requireCurrentUserId();
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await this.showSettingsMenu(ctx, userId, language);
    });

    // TASK-FIN-013 (Chapter 10 §10.4) — immediate, single-shot per the PRD's
    // own "Flow: Undo Operation" (§12.14): no menu, no confirmation, no
    // inline keyboard/callback_data. The authenticated userId comes only
    // from `requireCurrentUserId()` (AsyncLocalStorage set by the auth
    // middleware) — never from user-supplied input — and
    // `UndoLastTransactionActionUseCase` re-verifies ownership server-side
    // via that same userId on every call.
    this.bot.command('undo', async (ctx) => {
      const userId = requireCurrentUserId();
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);

      let outcome;
      try {
        outcome = await this.undoLastTransactionAction.execute(userId);
      } catch (error) {
        this.logger.error('UndoLastTransactionActionUseCase failed', error as Error);
        await ctx.reply(undoErrorReply(language));
        return;
      }

      switch (outcome.kind) {
        case 'nothing_to_undo':
          await ctx.reply(undoNothingToUndoReply(language));
          break;
        case 'unsupported_action':
          await ctx.reply(undoUnsupportedActionReply(language));
          break;
        case 'undone':
          await ctx.reply(
            outcome.action === 'deleted'
              ? undoRestoredReply(outcome.transaction, language)
              : undoRemovedReply(outcome.transaction, language),
          );
          break;
      }
    });

    for (const definition of COMMAND_DEFINITIONS) {
      if (!IMPLEMENTED_COMMANDS.has(definition.command)) {
        this.bot.command(definition.command, (ctx) =>
          ctx.reply(
            commandNotYetAvailableReply(this.replyLanguageFor(ctx.provisioning!.user, null)),
          ),
        );
      }
    }

    this.bot.on(message('text'), async (ctx) => {
      const user = ctx.provisioning!.user;

      // TASK-FIN-004 (Stage I) — a plain-text message is intercepted for
      // the Loan Wizard BEFORE it ever reaches RouteTextMessageUseCase's
      // AI-extraction pipeline, exactly the way commands themselves take
      // priority over this handler in Telegraf's own middleware chain.
      // Expired wizard records are treated as absent (read-time check,
      // matching `isConversationStateExpired`'s own established discipline)
      // and simply fall through to normal message handling.
      const wizardState = await this.loanWizardStateRepository.get(requireCurrentUserId());
      if (wizardState && !isLoanWizardStateExpired(wizardState, new Date().toISOString())) {
        await this.handleLoanWizardTextStep(ctx, wizardState, user);
        return;
      }

      // TASK-FIN-006 — same precedence rule as the Loan Wizard above: a
      // plain-text message is intercepted while `/settings → Custom
      // categories → Add new`'s name-entry step is actively pending.
      const customCategoryWizardState = await this.customCategoryWizardStateRepository.get(
        requireCurrentUserId(),
      );
      if (
        customCategoryWizardState &&
        !isCustomCategoryWizardStateExpired(customCategoryWizardState, new Date().toISOString())
      ) {
        await this.handleCustomCategoryWizardTextStep(ctx, customCategoryWizardState, user);
        return;
      }

      // TASK-FIN-012 — same precedence rule as the Loan Wizard above: a
      // plain-text message only gets intercepted here while the user is
      // actively mid-answer to a specific `/search` filter prompt
      // (`awaitingField !== null`) — the filter menu itself sitting
      // unanswered never blocks normal message handling.
      const searchSession = await this.searchSessionRepository.get(requireCurrentUserId());
      if (
        searchSession &&
        searchSession.awaitingField !== null &&
        !isSearchSessionExpired(searchSession, new Date().toISOString())
      ) {
        await this.handleSearchTextStep(ctx, searchSession, user);
        return;
      }

      // TASK-AUTH-006 — same precedence shape once more: intercepted only
      // while the "Type DELETE to confirm." prompt is actively pending.
      const awaitingDeletionConfirm =
        await this.accountDeletionConfirmationRepository.isAwaitingConfirmation(
          requireCurrentUserId(),
        );
      if (awaitingDeletionConfirm) {
        await this.handleAccountDeletionTextStep(ctx, user);
        return;
      }

      const outcome = await this.routeTextMessage.execute({
        userId: requireCurrentUserId(),
        text: ctx.message.text,
        currentDateTime: computeCurrentDateTimeInTimezone(new Date(), user.timezone),
        userDefaultCurrency: user.defaultCurrency,
        userRecentCategories: [],
      });
      const language = this.replyLanguageFor(user, this.detectedLanguageFrom(outcome));
      await this.sendTextOutcomeReply(ctx, outcome, language);
    });

    this.bot.on(message('voice'), async (ctx) => {
      const user = ctx.provisioning!.user;
      const language = this.replyLanguageFor(user, null);
      await ctx.reply(voiceAckReply(language));
      const voice = ctx.message.voice;

      let audio;
      try {
        audio = await downloadTelegramFile(ctx.telegram, voice.file_id);
      } catch (error) {
        this.logger.error('Failed to download voice message from Telegram', error as Error);
        await ctx.reply(storageFailureReply(language));
        return;
      }

      const outcome = await this.routeVoiceMessage.execute({
        userId: requireCurrentUserId(),
        telegramFileId: voice.file_id,
        audio,
        mimeType: voice.mime_type ?? 'audio/ogg',
        sizeBytes: voice.file_size ?? audio.length,
        durationSeconds: voice.duration,
        currentDateTime: computeCurrentDateTimeInTimezone(new Date(), user.timezone),
        userDefaultCurrency: user.defaultCurrency,
        userRecentCategories: [],
      });

      // TASK-BOT-008 — the localization layer never blocks a
      // voice-originated outcome from rendering in the correct language;
      // the missing piece (this outcome ever resolving a pending
      // AWAITING_CLARIFICATION) is the worker->Conversation-Engine hand-off
      // itself, a separate, pre-existing, deliberately-deferred gap (see
      // this task's final report) — not something the reply text here can
      // fix or needs to work around.
      if (outcome.kind === 'invalid_audio') {
        await ctx.reply(voiceInvalidReply(language));
      } else if (outcome.kind === 'storage_failure') {
        await ctx.reply(storageFailureReply(language));
      }
    });

    this.bot.on(message('photo'), async (ctx) => {
      const user = ctx.provisioning!.user;
      const language = this.replyLanguageFor(user, null);
      await ctx.reply(photoAckReply(language));
      const sizes = ctx.message.photo;
      const largest = sizes[sizes.length - 1]!;

      let image;
      try {
        image = await downloadTelegramFile(ctx.telegram, largest.file_id);
      } catch (error) {
        this.logger.error('Failed to download photo from Telegram', error as Error);
        await ctx.reply(storageFailureReply(language));
        return;
      }

      const outcome = await this.routePhotoMessage.execute({
        userId: requireCurrentUserId(),
        telegramFileId: largest.file_id,
        image,
        mimeType: 'image/jpeg',
        sizeBytes: largest.file_size ?? image.length,
        sourceType: 'photo',
        caption: ctx.message.caption ?? null,
        currentDateTime: computeCurrentDateTimeInTimezone(new Date(), user.timezone),
        userDefaultCurrency: user.defaultCurrency,
        userRecentCategories: [],
      });

      if (outcome.kind === 'invalid_image') {
        await ctx.reply(photoInvalidReply(language));
      } else if (outcome.kind === 'storage_failure') {
        await ctx.reply(storageFailureReply(language));
      }
    });

    this.bot.on(message('document'), async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      const document = ctx.message.document;
      const outcome = this.routeDocumentMessage.execute({
        fileName: document.file_name ?? '',
        mimeType: document.mime_type ?? '',
      });
      await ctx.reply(
        outcome.kind === 'unsupported'
          ? documentUnsupportedReply(language)
          : documentNotYetSupportedReply(language),
      );
    });

    this.bot.on(message('sticker', 'location', 'contact', 'video'), async (ctx) => {
      const language = this.replyLanguageFor(ctx.provisioning!.user, null);
      await ctx.reply(unsupportedMessageTypeReply(language));
    });

    this.bot.on('callback_query', async (ctx) => {
      const callbackQuery = ctx.callbackQuery;
      const data = 'data' in callbackQuery ? callbackQuery.data : undefined;
      const user = ctx.provisioning!.user;
      const language = this.replyLanguageFor(user, null);
      if (!data) {
        await ctx.answerCbQuery(malformedCallbackReply(language));
        return;
      }

      // TASK-FIN-004 (Stage I) — `loan_wizard_*` callback_data is handled
      // entirely separately from `RouteCallbackQueryUseCase`'s own
      // `<action>:<transactionId>[:<field>]` scheme (never modified here),
      // matching `buildLoanWizardConfirmationKeyboard`'s own doc comment.
      if (data.startsWith('loan_wizard_')) {
        await this.handleLoanWizardCallback(ctx, data, language);
        return;
      }

      // TASK-FIN-012 — `search_*` callback_data is handled entirely
      // separately from `RouteCallbackQueryUseCase`'s own scheme too, same
      // precedent as `loan_wizard_*` immediately above.
      if (data.startsWith('search_')) {
        await this.handleSearchCallback(ctx, data, language);
        return;
      }

      // TASK-AUTH-006 — `delacct_*` callback_data, same separate-namespace
      // precedent as `loan_wizard_*`/`search_*` immediately above.
      if (data.startsWith('delacct_')) {
        await this.handleAccountDeletionCallback(ctx, data, language);
        return;
      }

      // TASK-AI-006 — `ocrdraft_*` callback_data, same separate-namespace
      // precedent as the three above. Deliberately NOT routed through
      // `RouteCallbackQueryUseCase` — see `RouteOcrDraftCallbackUseCase`'s
      // own doc comment for why an OCR draft's Confirm/Edit/Cancel cannot
      // reuse that use case's `conversation_state`-dependent scheme.
      if (data.startsWith('ocrdraft_')) {
        await this.handleOcrDraftCallback(ctx, data, language);
        return;
      }

      // TASK-REP-TG — `report_*` callback_data, same separate-namespace
      // precedent as the four above.
      if (data.startsWith('report_')) {
        await this.handleReportCallback(ctx, data, language);
        return;
      }

      // TASK-FIN-014 — `export_*` callback_data, same separate-namespace
      // precedent as the five above.
      if (data.startsWith('export_')) {
        await this.handleExportCallback(ctx, data, language);
        return;
      }

      // TASK-BOT-SET — `settings_*` callback_data, same separate-namespace
      // precedent as the six above.
      if (data.startsWith('settings_')) {
        await this.handleSettingsCallback(ctx, data, language);
        return;
      }

      const outcome = await this.routeCallbackQuery.execute({
        userId: requireCurrentUserId(),
        callbackData: data,
        currentDateTime: computeCurrentDateTimeInTimezone(new Date(), user.timezone),
      });
      await this.acknowledgeCallback(ctx, outcome, language);
    });

    this.bot.catch((error, ctx) => {
      this.logger.error(`Unhandled Telegraf error for update ${ctx.updateType}`, error as Error);
    });
  }

  /**
   * TASK-BOT-008 — the single place that pulls "this turn's detected
   * language" out of whichever `RouteTextMessageOutcome` kind carries one
   * (every kind that ran a real extraction call — see each interface's own
   * doc comment in `route-text-message.use-case.ts`); `null` for the kinds
   * that never extracted anything this turn (cancellation phrase, no
   * pending state to act on, edit-value processing). `replyLanguageFor`
   * combines whatever this returns with the user's stored preference,
   * per Chapter 4 §4.2.2 — never used directly as the reply language on its
   * own.
   */
  private detectedLanguageFrom(outcome: RouteTextMessageOutcome): DetectedLanguage | null {
    switch (outcome.kind) {
      case 'no_transaction_detected':
      case 'batch_all_high_confidence_committed':
      case 'batch_review_started':
      case 'candidate_processed':
      case 'clarification_resolved':
      case 'clarification_commit_failed':
      case 'interruption_committed':
      case 'interruption_commit_failed':
        return outcome.detectedLanguage;
      case 'clarification_processed':
        return outcome.language;
      case 'cancelled':
      case 'extraction_unknown':
      case 'edit_value_processed':
      case 'edit_field_not_supported':
      case 'awaiting_confirmation_guidance':
        return null;
      default: {
        const exhaustiveCheck: never = outcome;
        return exhaustiveCheck;
      }
    }
  }

  private replyForTextOutcome(
    outcome: RouteTextMessageOutcome,
    language: DetectedLanguage,
  ): string {
    switch (outcome.kind) {
      case 'cancelled':
        return this.cancellationReplyFor(outcome.processEventOutcome, language);
      case 'extraction_unknown':
        return extractionUnknownReply(language);
      case 'no_transaction_detected':
        return noTransactionDetectedReply(language);
      case 'batch_all_high_confidence_committed':
        return renderBatchAllHighConfidenceCommittedMessage(outcome, language);
      case 'batch_review_started':
        // Handled by `sendTextOutcomeReply` directly (two messages: summary
        // + first item card, each with its own keyboard) — never reached.
        throw new Error(
          'batch_review_started must be handled by sendTextOutcomeReply, not replyForTextOutcome',
        );
      case 'candidate_processed':
        if (outcome.processEventOutcome.status !== 'transitioned') {
          return extractionUnknownReply(language);
        }
        // TASK-BOT-003 — a fresh message resolving straight into
        // AWAITING_CLARIFICATION gets its real, field-specific question
        // (Chapter 5 §5.3.2), not a static acknowledgment.
        if (outcome.processEventOutcome.nextState === 'AWAITING_CLARIFICATION') {
          return outcome.clarificationQuestion ?? extractionUnknownReply(language);
        }
        // TASK-BOT-004 (FR-CE-010/011/012) — IDLE (auto_commit) and
        // AWAITING_CONFIRMATION (flagged_review) both already committed by
        // this point (FR-CE-040/FR-CE-044); either way the user gets the
        // real candidate summary, never a generic placeholder.
        return renderConfirmationMessage(
          outcome.candidate,
          outcome.processEventOutcome.flaggedFields,
          language,
        );
      case 'clarification_processed':
        if (outcome.processEventOutcome.status !== 'transitioned') {
          return extractionUnknownReply(language);
        }
        // TASK-BOT-003 — FR-CE-005's fallback (retry budget exhausted) is a
        // generic, language-aware "let's try differently" message, not a
        // further field-specific question.
        if (outcome.processEventOutcome.fallbackToMiniForm) {
          return generateClarificationFallbackMessage(language);
        }
        // Still AWAITING_CLARIFICATION (FR-CE-042, retry budget remains) —
        // BR-CE-003's "re-asks once with a more specific prompt": the
        // regenerated retry-tier question, not a static acknowledgment.
        if (outcome.processEventOutcome.nextState === 'AWAITING_CLARIFICATION') {
          return outcome.nextQuestion ?? extractionUnknownReply(language);
        }
        // TASK-BOT-002-FIX — resolved back to IDLE (FR-CE-043) reaches this
        // generic acknowledgment only via the defensive fallback (the
        // pending draft could not be found, an edge case that should not
        // occur in production); the real, expected resolution path returns
        // `clarification_resolved` below instead, with the actual commit.
        return clarificationAckReply(language);
      case 'clarification_resolved':
        // TASK-BOT-002-FIX (§5.2.3's state diagram: "AWAITING_CLARIFICATION
        // -> IDLE: user answers, record resolved and committed") — the real
        // confirmation for the now-complete, committed transaction, never a
        // generic "Thanks, updating that now" placeholder.
        return renderConfirmationMessage(outcome.candidate, [], language);
      case 'clarification_commit_failed':
        return storageFailureReply(language);
      case 'edit_value_processed':
        return outcome.processEventOutcome.status === 'transitioned'
          ? editValueAcceptedReply(language)
          : editValueInvalidReply(language);
      case 'edit_field_not_supported':
        return editFieldNotSupportedReply(language);
      case 'awaiting_confirmation_guidance':
        return awaitingConfirmationGuidanceReply(language);
      case 'interruption_committed':
        // TASK-BOT-005 (§5.6 row 1, ADR-CE-006) — the real confirmation for
        // the NEW (interrupting) transaction, plus the required note that
        // the earlier, still-pending clarification was not discarded.
        return `${renderConfirmationMessage(outcome.candidate, [], language)}\n\n${interruptionNote(language)}`;
      case 'interruption_commit_failed':
        return storageFailureReply(language);
      default: {
        const exhaustiveCheck: never = outcome;
        return String(exhaustiveCheck);
      }
    }
  }

  /**
   * TASK-BOT-004 — the Confirmation Renderer's send path: plain-text reply
   * for every outcome, except a `flagged_review` commit (nextState ===
   * AWAITING_CONFIRMATION) also gets the FR-CE-013 Edit/Undo inline
   * keyboard attached to the SAME message. `auto_commit` (nextState IDLE)
   * deliberately gets no keyboard — see `confirmationKeyboardFor`'s own
   * doc comment for the guard-table-shaped reason why.
   */
  /**
   * TASK-FIN-003 (FR-BUD-001/002/006/007) — `/budget` alone lists the
   * user's active budgets with live utilization (FR-BUD-006); `/budget
   * create <category code | overall> <amount> <period>` creates one via a
   * SINGLE structured command message. This is a disclosed simplification
   * of FR-BUD-002's "guided /budget flow (IN_BUDGET_SETUP conversation
   * state)" — the full multi-turn conversation-state-machine integration
   * (a new state, new transition-guard rows, `RouteTextMessageUseCase`
   * branching) was not attempted in this pass, given the regression risk of
   * touching that heavily-tested existing system versus the time budget
   * available; see this task's final report for the full reasoning. Every
   * field is validated BEFORE calling `CreateBudgetUseCase`, so that use
   * case's own errors are a defensive backstop, not the primary validation
   * path — mirroring `CreateExpenseUseCase`'s own layering.
   */
  private async handleBudgetCommand(
    messageText: string,
    user: User,
    language: DetectedLanguage,
    ctx: BotContext,
  ): Promise<void> {
    const args = messageText.trim().split(/\s+/).slice(1);

    if (args.length === 0) {
      const utilizations = await this.listBudgets.execute({ userId: requireCurrentUserId() });
      await ctx.reply(renderBudgetsList(utilizations, language));
      return;
    }

    if (args[0] !== 'create' || args.length !== 4) {
      await ctx.reply(budgetCreateUsageReply(language));
      return;
    }

    const [, scopeArg, amountArg, periodArg] = args;
    const VALID_PERIODS: readonly string[] = ['weekly', 'monthly', 'quarterly', 'yearly'];
    const isValidAmount = /^[1-9]\d*(\.\d{1,2})?$/.test(amountArg!);
    if (!VALID_PERIODS.includes(periodArg!) || !isValidAmount) {
      await ctx.reply(budgetInvalidArgsReply(language));
      return;
    }

    let categoryId: string | undefined;
    if (scopeArg!.toLowerCase() !== 'overall') {
      const category = await this.categoryRepository.findByCode(scopeArg!.toUpperCase());
      if (!category || category.status !== 'active') {
        await ctx.reply(budgetCategoryNotFoundReply(language));
        return;
      }
      categoryId = category.id;
    }

    try {
      const outcome = await this.createBudget.execute({
        userId: requireCurrentUserId(),
        scopeType: categoryId ? 'category' : 'overall',
        categoryId,
        limitAmount: amountArg!,
        currency: user.defaultCurrency,
        periodType: periodArg as BudgetPeriodType,
      });

      if (outcome.kind === 'duplicate') {
        await ctx.reply(budgetDuplicateReply(language));
        return;
      }

      await ctx.reply(budgetCreatedReply(scopeArg!, amountArg!, user.defaultCurrency, language));
    } catch {
      // Defensive backstop only — every field above is already validated
      // before reaching this call; a thrown domain/application error here
      // means a case this command's own up-front validation didn't
      // anticipate, not a normal user-facing outcome.
      await ctx.reply(budgetInvalidArgsReply(language));
    }
  }

  // ==========================================================================
  // TASK-FIN-004 Stage I — Loan Telegram UX (Chapter 8 §8.8, FR-FIN-009)
  // ==========================================================================

  /** How long an in-progress `/loans create`/`/loans pay` dialog survives without an answer, mirroring the order of magnitude `ConversationStateRecord`'s own AWAITING_* TTLs use elsewhere in this codebase. */
  private static readonly LOAN_WIZARD_TTL_MS = 10 * 60 * 1000;

  private loanWizardExpiresAt(): string {
    return new Date(Date.now() + TelegramBotService.LOAN_WIZARD_TTL_MS).toISOString();
  }

  /**
   * FR-FIN-009 — `/loans` (list), `/loans create`, `/loans pay`, `/loans <id>`
   * (details). Structured-subcommand dispatch, mirroring `handleBudgetCommand`'s
   * own precedent — no business logic here, only routing to
   * `ListOpenLoansUseCase`/wizard-start helpers.
   */
  private async handleLoansCommand(
    messageText: string,
    language: DetectedLanguage,
    ctx: BotContext,
  ): Promise<void> {
    const args = messageText.trim().split(/\s+/).slice(1);

    if (args.length === 0) {
      await this.replyLoansList(ctx, language);
      return;
    }
    if (args[0] === 'create') {
      await this.startLoanCreateWizard(ctx, language);
      return;
    }
    if (args[0] === 'pay') {
      await this.startLoanPaymentWizard(ctx, language);
      return;
    }
    if (args.length === 1) {
      await this.replyLoanDetails(ctx, args[0]!, language);
      return;
    }
    await ctx.reply(loansUsageReply(language));
  }

  private async replyLoansList(ctx: BotContext, language: DetectedLanguage): Promise<void> {
    const loans = await this.listOpenLoans.execute({ userId: requireCurrentUserId() });
    const now = new Date();
    const rendered = loans.map((loan) => ({
      lender: loan.lender,
      outstandingBalance: loan.outstandingBalance,
      currency: loan.currency,
      installmentAmount: loan.installmentAmount,
      nextDueDate: calculateNextLoanDueDate(loan.startDate, loan.installmentFrequency, now),
    }));
    await ctx.reply(renderLoansList(rendered, language));
  }

  /**
   * `/loans <id>` — looked up via `ListOpenLoansUseCase` (the only
   * approved-for-reuse Loan read path) rather than a new "find by id"
   * use-case; a DISCLOSED consequence is that a `'paid_off'` loan is not
   * viewable this way (that use case's own contract excludes it, matching
   * `/loans`'s own list scope) — see this stage's own final report.
   */
  private async replyLoanDetails(
    ctx: BotContext,
    loanId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const loans = await this.listOpenLoans.execute({ userId: requireCurrentUserId() });
    const loan = loans.find((candidate) => candidate.id === loanId);
    if (!loan) {
      await ctx.reply(loanNotFoundReply(language));
      return;
    }
    await ctx.reply(
      renderLoanDetails(
        {
          lender: loan.lender,
          principalAmount: loan.principalAmount,
          outstandingBalance: loan.outstandingBalance,
          currency: loan.currency,
          interestRate: loan.interestRate,
          installmentAmount: loan.installmentAmount,
          installmentFrequency: loan.installmentFrequency,
          status: loan.status,
          nextDueDate: calculateNextLoanDueDate(
            loan.startDate,
            loan.installmentFrequency,
            new Date(),
          ),
        },
        language,
      ),
    );
  }

  private async startLoanCreateWizard(ctx: BotContext, language: DetectedLanguage): Promise<void> {
    const userId = requireCurrentUserId();
    const current = await this.loanWizardStateRepository.get(userId);
    await this.loanWizardStateRepository.compareAndSet(userId, current?.version ?? 0, {
      version: (current?.version ?? 0) + 1,
      step: 'AWAITING_LENDER',
      createDraft: {},
      paymentDraft: null,
      expiresAt: this.loanWizardExpiresAt(),
    });
    await ctx.reply(askLoanLenderReply(language));
  }

  private async startLoanPaymentWizard(ctx: BotContext, language: DetectedLanguage): Promise<void> {
    const userId = requireCurrentUserId();
    const loans = await this.listOpenLoans.execute({ userId });
    if (loans.length === 0) {
      await ctx.reply(noOpenLoansForPaymentReply(language));
      return;
    }
    const current = await this.loanWizardStateRepository.get(userId);
    const candidateLoanIds = loans.map((loan) => loan.id);
    await this.loanWizardStateRepository.compareAndSet(userId, current?.version ?? 0, {
      version: (current?.version ?? 0) + 1,
      step: 'AWAITING_PAYMENT_LOAN_SELECTION',
      createDraft: null,
      paymentDraft: { candidateLoanIds },
      expiresAt: this.loanWizardExpiresAt(),
    });
    await ctx.reply(
      askLoanSelectionReply(
        loans.map((loan) => ({
          lender: loan.lender,
          outstandingBalance: loan.outstandingBalance,
          currency: loan.currency,
        })),
        language,
      ),
    );
  }

  /** Writes the next wizard step (bumping `version`) and replies with `nextPrompt`; on a CAS failure (a concurrent write already changed the record — e.g. the user tapped Cancel on a confirmation while also typing) reports "no active request" rather than silently applying a stale step. */
  private async writeLoanWizardStep(
    ctx: BotContext,
    userId: string,
    expectedVersion: number,
    step: LoanWizardStep,
    createDraft: LoanCreateDraft | null,
    paymentDraft: LoanPaymentDraft | null,
    nextPrompt: string,
    language: DetectedLanguage,
  ): Promise<boolean> {
    const written = await this.loanWizardStateRepository.compareAndSet(userId, expectedVersion, {
      version: expectedVersion + 1,
      step,
      createDraft,
      paymentDraft,
      expiresAt: this.loanWizardExpiresAt(),
    });
    if (written) {
      await ctx.reply(nextPrompt);
    } else {
      await ctx.reply(noActiveLoanWizardReply(language));
    }
    return written;
  }

  private static readonly NO_INTEREST_KEYWORDS = new Set([
    "yo'q",
    'yoq',
    'yo`q',
    'none',
    'no',
    'нет',
  ]);

  /**
   * Every free-text message while a Loan Wizard is active. Each branch
   * validates the raw answer BEFORE writing it to the draft — no financial
   * calculation happens here (interest/principal/amortization all remain
   * `LogLoanPaymentUseCase`'s job, only invoked at final confirmation).
   */
  private async handleLoanWizardTextStep(
    ctx: BotContext,
    state: LoanWizardStateRecord,
    user: User,
  ): Promise<void> {
    const language = this.replyLanguageFor(user, null);
    const userId = requireCurrentUserId();
    const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text.trim() : '';

    switch (state.step) {
      case 'AWAITING_LENDER': {
        if (text.length === 0) {
          await ctx.reply(invalidLoanLenderReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_PRINCIPAL',
          { ...state.createDraft, lender: text },
          null,
          askLoanPrincipalReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_PRINCIPAL': {
        if (!isValidDecimalAmount(text)) {
          await ctx.reply(invalidLoanPrincipalReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_CURRENCY',
          { ...state.createDraft, principalAmount: text },
          null,
          askLoanCurrencyReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_CURRENCY': {
        const code = text.toUpperCase();
        const supported = await this.currencyRepository.isSupported(code);
        if (!supported) {
          await ctx.reply(invalidLoanCurrencyReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_INTEREST_RATE',
          { ...state.createDraft, currency: code },
          null,
          askLoanInterestRateReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_INTEREST_RATE': {
        if (TelegramBotService.NO_INTEREST_KEYWORDS.has(text.toLowerCase())) {
          await this.writeLoanWizardStep(
            ctx,
            userId,
            state.version,
            'AWAITING_INSTALLMENT_AMOUNT',
            { ...state.createDraft, interestRate: null },
            null,
            askLoanInstallmentAmountReply(language),
            language,
          );
          return;
        }
        if (!/^\d+(\.\d{1,4})?$/.test(text)) {
          await ctx.reply(invalidLoanInterestRateReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_INSTALLMENT_AMOUNT',
          { ...state.createDraft, interestRate: convertPercentToDecimalFraction(text) },
          null,
          askLoanInstallmentAmountReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_INSTALLMENT_AMOUNT': {
        if (!isValidDecimalAmount(text)) {
          await ctx.reply(invalidLoanInstallmentAmountReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_INSTALLMENT_FREQUENCY',
          { ...state.createDraft, installmentAmount: text },
          null,
          askLoanInstallmentFrequencyReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_INSTALLMENT_FREQUENCY': {
        const frequency = text.toLowerCase();
        if (!['weekly', 'monthly', 'quarterly'].includes(frequency)) {
          await ctx.reply(invalidLoanInstallmentFrequencyReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_START_DATE',
          { ...state.createDraft, installmentFrequency: frequency },
          null,
          askLoanStartDateReply(language),
          language,
        );
        return;
      }
      case 'AWAITING_START_DATE': {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
          Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())
        ) {
          await ctx.reply(invalidLoanStartDateReply(language));
          return;
        }
        const draft = { ...state.createDraft, startDate: text };
        const newVersion = state.version + 1;
        const written = await this.loanWizardStateRepository.compareAndSet(userId, state.version, {
          version: newVersion,
          step: 'AWAITING_CREATE_CONFIRMATION',
          createDraft: draft,
          paymentDraft: null,
          expiresAt: this.loanWizardExpiresAt(),
        });
        if (!written) {
          await ctx.reply(noActiveLoanWizardReply(language));
          return;
        }
        await ctx.reply(
          renderLoanCreateConfirmation(
            {
              lender: draft.lender!,
              principalAmount: draft.principalAmount!,
              currency: draft.currency!,
              interestRate: draft.interestRate ?? null,
              installmentAmount: draft.installmentAmount!,
              installmentFrequency: draft.installmentFrequency!,
              startDate: draft.startDate!,
            },
            language,
          ),
          { reply_markup: buildLoanWizardConfirmationKeyboard('create', newVersion, language) },
        );
        return;
      }
      case 'AWAITING_PAYMENT_LOAN_SELECTION': {
        const ids = state.paymentDraft?.candidateLoanIds ?? [];
        const index = Number.parseInt(text, 10);
        if (!Number.isInteger(index) || index < 1 || index > ids.length) {
          await ctx.reply(invalidLoanSelectionReply(language));
          return;
        }
        const loanId = ids[index - 1]!;
        const loans = await this.listOpenLoans.execute({ userId });
        const loan = loans.find((candidate) => candidate.id === loanId);
        if (!loan) {
          await ctx.reply(loanNotFoundReply(language));
          return;
        }
        await this.writeLoanWizardStep(
          ctx,
          userId,
          state.version,
          'AWAITING_PAYMENT_AMOUNT',
          null,
          { loanId, candidateLoanIds: ids },
          askLoanPaymentAmountReply(
            {
              lender: loan.lender,
              outstandingBalance: loan.outstandingBalance,
              currency: loan.currency,
            },
            language,
          ),
          language,
        );
        return;
      }
      case 'AWAITING_PAYMENT_AMOUNT': {
        if (!isValidDecimalAmount(text)) {
          await ctx.reply(invalidLoanPaymentAmountReply(language));
          return;
        }
        const loanId = state.paymentDraft?.loanId;
        if (!loanId) {
          await ctx.reply(noActiveLoanWizardReply(language));
          return;
        }
        const loans = await this.listOpenLoans.execute({ userId });
        const loan = loans.find((candidate) => candidate.id === loanId);
        if (!loan) {
          await ctx.reply(loanNotFoundReply(language));
          return;
        }
        const newVersion = state.version + 1;
        const written = await this.loanWizardStateRepository.compareAndSet(userId, state.version, {
          version: newVersion,
          step: 'AWAITING_PAYMENT_CONFIRMATION',
          createDraft: null,
          paymentDraft: { loanId, amount: text },
          expiresAt: this.loanWizardExpiresAt(),
        });
        if (!written) {
          await ctx.reply(noActiveLoanWizardReply(language));
          return;
        }
        await ctx.reply(
          renderLoanPaymentConfirmation(
            {
              lender: loan.lender,
              outstandingBalance: loan.outstandingBalance,
              currency: loan.currency,
            },
            text,
            language,
          ),
          { reply_markup: buildLoanWizardConfirmationKeyboard('pay', newVersion, language) },
        );
        return;
      }
      case 'AWAITING_CREATE_CONFIRMATION':
      case 'AWAITING_PAYMENT_CONFIRMATION':
        // These two steps are advanced only via the inline-keyboard
        // callback (`handleLoanWizardCallback`) — a stray text message here
        // is neither applied nor treated as a new answer.
        await ctx.reply(noActiveLoanWizardReply(language));
        return;
      default: {
        const exhaustiveCheck: never = state.step;
        throw new Error(`Unhandled loan wizard step: ${String(exhaustiveCheck)}`);
      }
    }
  }

  /**
   * `loan_wizard_{create|pay}_{confirm|cancel}:<version>`. The `version`
   * embedded in `callback_data` is the SAME idempotency guard
   * `buildLoanWizardConfirmationKeyboard`'s own doc comment describes: the
   * confirm/cancel handlers both clear the wizard record via
   * `compareAndSet(userId, state.version, null)` BEFORE doing anything
   * else — a duplicate tap (double-click, retried webhook delivery) reads
   * the already-cleared record, its `state.version !== version` check
   * fails, and it is safely rejected as stale, never double-applying
   * `LogLoanPaymentUseCase`.
   */
  private async handleLoanWizardCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();
    const separatorIndex = data.lastIndexOf(':');
    const action = data.slice(0, separatorIndex);
    const version = Number.parseInt(data.slice(separatorIndex + 1), 10);
    const state = await this.loanWizardStateRepository.get(userId);

    if (!state || !Number.isInteger(version) || state.version !== version) {
      await ctx.answerCbQuery();
      await ctx.reply(noActiveLoanWizardReply(language));
      return;
    }

    if (action === 'loan_wizard_create_cancel') {
      await this.loanWizardStateRepository.compareAndSet(userId, state.version, null);
      await ctx.answerCbQuery();
      await ctx.reply(loanCreateCancelledReply(language));
      return;
    }
    if (action === 'loan_wizard_pay_cancel') {
      await this.loanWizardStateRepository.compareAndSet(userId, state.version, null);
      await ctx.answerCbQuery();
      await ctx.reply(loanPaymentCancelledReply(language));
      return;
    }
    if (action === 'loan_wizard_create_confirm') {
      await this.finalizeLoanCreate(ctx, userId, state, language);
      return;
    }
    if (action === 'loan_wizard_pay_confirm') {
      await this.finalizeLoanPayment(ctx, userId, state, language);
      return;
    }
    await ctx.answerCbQuery();
  }

  private async finalizeLoanCreate(
    ctx: BotContext,
    userId: string,
    state: LoanWizardStateRecord,
    language: DetectedLanguage,
  ): Promise<void> {
    const cleared = await this.loanWizardStateRepository.compareAndSet(userId, state.version, null);
    if (!cleared) {
      await ctx.answerCbQuery();
      await ctx.reply(loanPaymentConflictReply(language));
      return;
    }
    await ctx.answerCbQuery();

    const draft = state.createDraft;
    if (
      !draft?.lender ||
      !draft.principalAmount ||
      !draft.currency ||
      !draft.installmentAmount ||
      !draft.installmentFrequency ||
      !draft.startDate
    ) {
      await ctx.reply(loanCreateCancelledReply(language));
      return;
    }

    try {
      await this.createLoan.execute({
        userId,
        lender: draft.lender,
        principalAmount: draft.principalAmount,
        currency: draft.currency,
        interestRate: draft.interestRate ?? undefined,
        installmentAmount: draft.installmentAmount,
        installmentFrequency: draft.installmentFrequency as LoanInstallmentFrequency,
        startDate: new Date(`${draft.startDate}T00:00:00Z`),
      });
      await ctx.reply(loanCreatedReply(language));
    } catch (error) {
      this.logger.error('Loan creation failed', error as Error);
      await ctx.reply(loanCreateCancelledReply(language));
    }
  }

  private async finalizeLoanPayment(
    ctx: BotContext,
    userId: string,
    state: LoanWizardStateRecord,
    language: DetectedLanguage,
  ): Promise<void> {
    const cleared = await this.loanWizardStateRepository.compareAndSet(userId, state.version, null);
    if (!cleared) {
      await ctx.answerCbQuery();
      await ctx.reply(loanPaymentConflictReply(language));
      return;
    }
    await ctx.answerCbQuery();

    const loanId = state.paymentDraft?.loanId;
    const amount = state.paymentDraft?.amount;
    if (!loanId || !amount) {
      await ctx.reply(loanPaymentCancelledReply(language));
      return;
    }

    try {
      const outcome = await this.logLoanPayment.execute({
        userId,
        loanId,
        amount,
        paymentDate: new Date(),
      });
      if (outcome.kind === 'conflict') {
        await ctx.reply(loanPaymentConflictReply(language));
        return;
      }
      // interestPortion is derived by simple subtraction of two values
      // `LogLoanPaymentUseCase` already computed — never a reimplementation
      // of the amortization formula itself (that lives only in
      // `computeLoanAmortization`, @afa/domain).
      const interestPortion = subtractDecimalAmounts(
        outcome.payment.amount,
        outcome.payment.principalPortion,
      );
      await ctx.reply(
        renderLoanPaymentResult(
          {
            amount: outcome.payment.amount,
            interestPortion,
            principalPortion: outcome.payment.principalPortion,
            outstandingBalance: outcome.loan.outstandingBalance,
            currency: outcome.loan.currency,
            paidOff: outcome.loan.status === 'paid_off',
          },
          language,
        ),
      );
    } catch (error) {
      if (error instanceof LoanOverpaymentError) {
        await ctx.reply(loanOverpaymentReply(language));
        return;
      }
      if (error instanceof NegativeAmortizationError) {
        await ctx.reply(loanNegativeAmortizationReply(language));
        return;
      }
      this.logger.error('Loan payment failed', error as Error);
      await ctx.reply(loanPaymentCancelledReply(language));
    }
  }

  private async sendTextOutcomeReply(
    ctx: BotContext,
    outcome: RouteTextMessageOutcome,
    language: DetectedLanguage,
  ): Promise<void> {
    if (outcome.kind === 'batch_review_started') {
      await this.sendBatchReviewStarted(ctx, outcome, language);
      return;
    }
    const text = this.replyForTextOutcome(outcome, language);
    const keyboard = this.confirmationKeyboardFor(outcome, language);
    if (keyboard) {
      await ctx.reply(text, { reply_markup: keyboard });
    } else {
      await ctx.reply(text);
    }
  }

  /**
   * TASK-BOT-006 (§5.7.1) — "show the required summary first," then the
   * first low-confidence item one at a time (FR-CE-032). Two separate
   * messages (not one) since each carries its own, distinct inline
   * keyboard: the summary's optional "Import N confident ones now"
   * (FR-CE-031, state-independent) vs. the item card's Confirm/Skip/Cancel.
   */
  private async sendBatchReviewStarted(
    ctx: BotContext,
    outcome: Extract<RouteTextMessageOutcome, { kind: 'batch_review_started' }>,
    language: DetectedLanguage,
  ): Promise<void> {
    const summaryText = renderBatchSummaryMessage(
      {
        totalItems: outcome.totalItems,
        highConfidenceCount: outcome.highConfidenceCount,
        lowConfidenceCount: outcome.lowConfidenceCandidates.length,
      },
      language,
    );
    if (outcome.highConfidenceCount > 0) {
      await ctx.reply(summaryText, {
        reply_markup: buildBatchSummaryKeyboard(
          outcome.batchId,
          outcome.highConfidenceCount,
          language,
        ),
      });
    } else {
      await ctx.reply(summaryText);
    }

    const firstCandidate = outcome.lowConfidenceCandidates[0];
    const firstDraftId = outcome.lowConfidenceDraftIds[0];
    if (!firstCandidate || !firstDraftId) {
      return;
    }
    await ctx.reply(
      renderBatchItemMessage(firstCandidate, 1, outcome.lowConfidenceCandidates.length, language),
      { reply_markup: buildBatchReviewKeyboard(firstDraftId, language) },
    );
  }

  /**
   * TASK-BOT-006 (FR-CE-052) — the one CANCELLATION outcome with three
   * distinct replies, not two: a normal discard (`nextState === 'IDLE'`)
   * still gets `cancelledReply`; nothing pending is still
   * `nothingToCancelReply`; but a `transitioned` outcome landing back on
   * `AWAITING_MULTI_ITEM_REVIEW` is the FIRST of the two required taps —
   * only *asking* to discard batch progress, not yet doing so — and must
   * say so, not claim "Okay, cancelled." prematurely.
   */
  private cancellationReplyFor(
    processEventOutcome: ProcessConversationEventOutcome,
    language: DetectedLanguage,
  ): string {
    if (processEventOutcome.status !== 'transitioned') {
      return nothingToCancelReply(language);
    }
    if (processEventOutcome.nextState === 'AWAITING_MULTI_ITEM_REVIEW') {
      return batchCancelConfirmationReply(language);
    }
    return cancelledReply(language);
  }

  /**
   * Only `flagged_review` candidates (nextState === AWAITING_CONFIRMATION)
   * get an inline keyboard. `auto_commit` candidates (nextState IDLE) do
   * NOT, even though FR-CE-011's worked example shows Edit/Undo on a
   * high-confidence message too: TASK-BOT-002's guard table (out of this
   * task's scope to redesign, per its own explicit instruction) only enters
   * AWAITING_CONFIRMATION for `flagged_review` — an auto-commit candidate's
   * conversation state is already back to IDLE by the time this message is
   * sent. `RouteCallbackQueryUseCase` requires AWAITING_CONFIRMATION (with
   * a matching `transactionId`) before honoring Edit/Undo, so a button
   * attached to an auto-commit message would always resolve to `stale` —
   * strictly worse than no button. See this task's final report for the
   * full gap explanation.
   */
  private confirmationKeyboardFor(
    outcome: RouteTextMessageOutcome,
    language: DetectedLanguage,
  ): InlineKeyboardMarkup | null {
    if (
      outcome.kind !== 'candidate_processed' ||
      outcome.processEventOutcome.status !== 'transitioned' ||
      outcome.processEventOutcome.nextState !== 'AWAITING_CONFIRMATION' ||
      outcome.processEventOutcome.transactionId === null
    ) {
      return null;
    }
    return buildConfirmationKeyboard(
      outcome.processEventOutcome.transactionId,
      outcome.processEventOutcome.flaggedFields,
      language,
    );
  }

  /**
   * TASK-BOT-008 (Chapter 4 §4.2.2) — the single, reusable combination point
   * for a reply's language: the user's stored `preferredLanguage` (narrowed
   * safely — see `toDetectedLanguage`'s own doc comment for why an
   * unsupported/corrupted stored value must never be trusted as-is) always
   * wins when present; `detectedLanguage` (this turn's, when one exists) is
   * only the fallback; `'en'` is the last resort. Every reply site in this
   * class calls this exactly once per outcome, never re-deriving the same
   * precedence inline.
   */
  private replyLanguageFor(
    user: { preferredLanguage: string },
    detectedLanguage: DetectedLanguage | null,
  ): DetectedLanguage {
    return resolveReplyLanguage(toDetectedLanguage(user.preferredLanguage), detectedLanguage);
  }

  /** TASK-BOT-008 — the one reply site (group-chat rejection) that fires before `ProvisionTelegramUserUseCase` has run, so there is no stored `preferredLanguage` yet to read; falls back to Telegram's own per-sender `language_code` instead. */
  private languageFromTelegramCode(languageCode: string | undefined): DetectedLanguage | null {
    return toDetectedLanguage(languageCode?.split('-')[0]?.toLowerCase());
  }

  private async acknowledgeCallback(
    ctx: BotContext,
    outcome: RouteCallbackQueryOutcome,
    language: DetectedLanguage,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'malformed':
        await ctx.answerCbQuery(malformedCallbackReply(language));
        return;
      case 'stale':
        await ctx.answerCbQuery(staleCallbackReply(language));
        return;
      case 'acknowledged':
        await ctx.answerCbQuery();
        return;
      case 'edit_requested':
        await ctx.answerCbQuery();
        if (outcome.processEventOutcome.status === 'transitioned') {
          await ctx.reply(editPromptReply(language));
        } else {
          await ctx.reply(staleCallbackReply(language));
        }
        return;
      case 'cancelled':
        await ctx.answerCbQuery();
        await ctx.reply(this.cancellationReplyFor(outcome.processEventOutcome, language));
        return;
      case 'undone':
        await ctx.answerCbQuery();
        await ctx.reply(
          outcome.processEventOutcome.status === 'transitioned'
            ? undoneReply(language)
            : staleCallbackReply(language),
        );
        return;
      case 'batch_item_confirmed':
      case 'batch_item_skipped':
        await ctx.answerCbQuery();
        await this.sendNextBatchItemOrCompletion(ctx, outcome, language);
        return;
      case 'batch_commit_failed':
        await ctx.answerCbQuery();
        await ctx.reply(storageFailureReply(language));
        return;
      case 'batch_high_confidence_committed':
        await ctx.answerCbQuery();
        await ctx.reply(renderBatchHighConfidenceCommittedMessage(outcome, language));
        return;
      default: {
        const exhaustiveCheck: never = outcome;
        throw new Error(`Unhandled callback outcome: ${String(exhaustiveCheck)}`);
      }
    }
  }

  /** TASK-BOT-006 (FR-CE-032/FR-CE-033) — after a Confirm/Skip tap, either render the next paginated low-confidence item or announce review completion. */
  private async sendNextBatchItemOrCompletion(
    ctx: BotContext,
    outcome: Extract<
      RouteCallbackQueryOutcome,
      { kind: 'batch_item_confirmed' | 'batch_item_skipped' }
    >,
    language: DetectedLanguage,
  ): Promise<void> {
    if (!outcome.nextCandidate || outcome.nextPosition === null || !outcome.nextDraftId) {
      await ctx.reply(batchReviewCompleteReply(language));
      return;
    }
    await ctx.reply(
      renderBatchItemMessage(
        outcome.nextCandidate,
        outcome.nextPosition,
        outcome.totalLowConfidence,
        language,
      ),
      { reply_markup: buildBatchReviewKeyboard(outcome.nextDraftId, language) },
    );
  }

  async onModuleInit(): Promise<void> {
    await this.bot.telegram.setMyCommands(
      COMMAND_DEFINITIONS.map((definition) => ({
        command: definition.command,
        description: definition.description,
      })),
    );

    const webhookSecret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
    const webhookUrl = this.config.get('TELEGRAM_WEBHOOK_URL', { infer: true });

    if (webhookSecret && webhookUrl) {
      // Chapter 17 §17.2 — webhook delivery in production. This app never
      // calls bot.launch() in this mode; TelegramWebhookController drives
      // updates via handleUpdate() instead.
      await this.bot.telegram.setWebhook(webhookUrl, { secret_token: webhookSecret });
      this.logger.log('Telegram bot registered for webhook delivery');
      return;
    }

    // Long-polling — local development only (Chapter 17 §17.2).
    await this.bot.launch();
    this.logger.log('Telegram bot launched (long-polling)');
  }

  onModuleDestroy(): void {
    this.bot.stop('SIGTERM');
  }

  // ==========================================================================
  // TASK-FIN-012 — Search (Chapter 10 §10.3)
  // ==========================================================================

  /** Mirrors `LOAN_WIZARD_TTL_MS`'s own order of magnitude for an in-progress guided-flow dialog. */
  private static readonly SEARCH_SESSION_TTL_MS = 10 * 60 * 1000;
  private static readonly SEARCH_DATE_PLUS_ONE_DAY_MS = 24 * 60 * 60 * 1000;

  private searchSessionExpiresAt(): string {
    return new Date(Date.now() + TelegramBotService.SEARCH_SESSION_TTL_MS).toISOString();
  }

  private activeSearchFieldSet(filters: SearchFilters): Set<string> {
    const set = new Set<string>();
    if (filters.category) set.add('category');
    if (filters.merchant) set.add('merchant');
    if (filters.transactionType) set.add('transactionType');
    if (filters.dateFrom) set.add('dateFrom');
    if (filters.dateTo) set.add('dateTo');
    if (filters.minAmount) set.add('minAmount');
    if (filters.maxAmount) set.add('maxAmount');
    if (filters.tags && filters.tags.length > 0) set.add('tags');
    return set;
  }

  private promptForSearchField(field: SearchFilterField, language: DetectedLanguage): string {
    switch (field) {
      case 'category':
        return askSearchCategoryReply(language);
      case 'merchant':
        return askSearchMerchantReply(language);
      case 'dateFrom':
        return askSearchDateFromReply(language);
      case 'dateTo':
        return askSearchDateToReply(language);
      case 'minAmount':
        return askSearchMinAmountReply(language);
      case 'maxAmount':
        return askSearchMaxAmountReply(language);
      case 'tags':
        return askSearchTagsReply(language);
      case 'transactionType':
        // Handled via `buildSearchTypeKeyboard` instead — never reaches a text prompt.
        return askSearchCategoryReply(language);
      default: {
        const exhaustiveCheck: never = field;
        return exhaustiveCheck;
      }
    }
  }

  private async startSearchSession(ctx: BotContext, language: DetectedLanguage): Promise<void> {
    const userId = requireCurrentUserId();
    const current = await this.searchSessionRepository.get(userId);
    await this.searchSessionRepository.compareAndSet(userId, current?.version ?? 0, {
      version: (current?.version ?? 0) + 1,
      filters: {},
      awaitingField: null,
      page: 0,
      expiresAt: this.searchSessionExpiresAt(),
    });
    await ctx.reply(searchFilterMenuReply({}, language), {
      reply_markup: buildSearchFilterMenuKeyboard(new Set(), language),
    });
  }

  private isValidSearchIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    return !Number.isNaN(new Date(value).getTime());
  }

  /**
   * Every free-text message while a `/search` filter prompt is active
   * (mirrors `handleLoanWizardTextStep`'s own per-field validate-then-write
   * shape). No search execution happens here — only filter composition;
   * the actual `searchTransactions.execute()` call happens exclusively in
   * `runSearchAndReply`, reached only via the "Search"/pagination buttons.
   */
  private async handleSearchTextStep(
    ctx: BotContext,
    session: SearchSessionRecord,
    user: User,
  ): Promise<void> {
    const language = this.replyLanguageFor(user, null);
    const userId = requireCurrentUserId();
    const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text.trim() : '';
    const field = session.awaitingField!;

    switch (field) {
      case 'category': {
        const code = text.toUpperCase();
        const category = await this.categoryRepository.findByCode(code);
        if (!category || category.status !== 'active') {
          await ctx.reply(invalidSearchCategoryReply(language));
          return;
        }
        await this.writeSearchFilter(
          ctx,
          userId,
          session.version,
          { ...session.filters, category: code },
          language,
        );
        return;
      }
      case 'merchant': {
        if (text.length === 0) {
          await ctx.reply(askSearchMerchantReply(language));
          return;
        }
        await this.writeSearchFilter(
          ctx,
          userId,
          session.version,
          { ...session.filters, merchant: text },
          language,
        );
        return;
      }
      case 'dateFrom':
      case 'dateTo': {
        if (!this.isValidSearchIsoDate(text)) {
          await ctx.reply(invalidSearchDateReply(language));
          return;
        }
        await this.writeSearchFilter(
          ctx,
          userId,
          session.version,
          { ...session.filters, [field]: text },
          language,
        );
        return;
      }
      case 'minAmount':
      case 'maxAmount': {
        if (!isValidNonNegativeDecimalAmount(text)) {
          await ctx.reply(invalidSearchAmountReply(language));
          return;
        }
        const otherBound =
          field === 'minAmount' ? session.filters.maxAmount : session.filters.minAmount;
        if (otherBound !== undefined) {
          const min = field === 'minAmount' ? text : otherBound;
          const max = field === 'minAmount' ? otherBound : text;
          if (compareDecimalAmounts(min, max) === 1) {
            await ctx.reply(invalidSearchAmountReply(language));
            return;
          }
        }
        await this.writeSearchFilter(
          ctx,
          userId,
          session.version,
          { ...session.filters, [field]: text },
          language,
        );
        return;
      }
      case 'tags': {
        const tags = text
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        await this.writeSearchFilter(
          ctx,
          userId,
          session.version,
          { ...session.filters, tags },
          language,
        );
        return;
      }
      case 'transactionType':
        return;
      default: {
        const exhaustiveCheck: never = field;
        return exhaustiveCheck;
      }
    }
  }

  private async writeSearchFilter(
    ctx: BotContext,
    userId: string,
    expectedVersion: number,
    filters: SearchFilters,
    language: DetectedLanguage,
  ): Promise<void> {
    const written = await this.searchSessionRepository.compareAndSet(userId, expectedVersion, {
      version: expectedVersion + 1,
      filters,
      awaitingField: null,
      page: 0,
      expiresAt: this.searchSessionExpiresAt(),
    });
    if (!written) {
      await ctx.reply(searchSessionExpiredReply(language));
      return;
    }
    await ctx.reply(searchFilterMenuReply(filters, language), {
      reply_markup: buildSearchFilterMenuKeyboard(this.activeSearchFieldSet(filters), language),
    });
  }

  /**
   * `search_*` callback_data dispatch. Every branch re-fetches the session
   * fresh (never trusts a value captured before the tap) and, for `Delete`,
   * never trusts the tapped transaction id alone — ownership is
   * re-verified by `DeleteTransactionUseCase` itself (`existing.userId !==
   * input.userId` → `UnauthorizedTransactionAccessError`), the exact
   * two-layer discipline this codebase already applies everywhere else a
   * client-supplied id reaches a mutation.
   */
  private async handleSearchCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();

    if (data.startsWith('search_delete:')) {
      const transactionId = data.slice('search_delete:'.length);
      try {
        await this.deleteTransactionUseCase.execute({ transactionId, userId });
        await ctx.answerCbQuery(searchResultDeletedReply(language));
      } catch (error) {
        if (
          error instanceof TransactionNotFoundError ||
          error instanceof TransactionAlreadyDeletedError ||
          error instanceof UnauthorizedTransactionAccessError
        ) {
          await ctx.answerCbQuery(searchResultAlreadyGoneReply(language));
          return;
        }
        throw error;
      }
      return;
    }

    const session = await this.searchSessionRepository.get(userId);
    if (!session) {
      await ctx.answerCbQuery();
      await ctx.reply(searchSessionExpiredReply(language));
      return;
    }

    if (data === 'search_menu') {
      await ctx.answerCbQuery();
      await ctx.reply(searchFilterMenuReply(session.filters, language), {
        reply_markup: buildSearchFilterMenuKeyboard(
          this.activeSearchFieldSet(session.filters),
          language,
        ),
      });
      return;
    }

    if (data.startsWith('search_field:')) {
      const field = data.slice('search_field:'.length) as SearchFilterField;
      if (field === 'transactionType') {
        await ctx.answerCbQuery();
        await ctx.reply(this.promptForSearchField(field, language), {
          reply_markup: buildSearchTypeKeyboard(),
        });
        return;
      }
      const written = await this.searchSessionRepository.compareAndSet(userId, session.version, {
        ...session,
        version: session.version + 1,
        awaitingField: field,
      });
      await ctx.answerCbQuery();
      await ctx.reply(
        written ? this.promptForSearchField(field, language) : searchSessionExpiredReply(language),
      );
      return;
    }

    if (data.startsWith('search_type:')) {
      const type = data.slice('search_type:'.length);
      await ctx.answerCbQuery();
      if (!isSearchTransactionType(type)) {
        return;
      }
      await this.writeSearchFilter(
        ctx,
        userId,
        session.version,
        { ...session.filters, transactionType: type },
        language,
      );
      return;
    }

    if (data === 'search_reset') {
      await this.searchSessionRepository.compareAndSet(userId, session.version, {
        version: session.version + 1,
        filters: {},
        awaitingField: null,
        page: 0,
        expiresAt: this.searchSessionExpiresAt(),
      });
      await ctx.answerCbQuery();
      await ctx.reply(searchFilterMenuReply({}, language), {
        reply_markup: buildSearchFilterMenuKeyboard(new Set(), language),
      });
      return;
    }

    if (data === 'search_cancel') {
      await this.searchSessionRepository.compareAndSet(userId, session.version, null);
      await ctx.answerCbQuery();
      await ctx.reply(cancelledReply(language));
      return;
    }

    if (data === 'search_apply' || data.startsWith('search_page:')) {
      const page = data === 'search_apply' ? 0 : Number(data.slice('search_page:'.length));
      await ctx.answerCbQuery();
      await this.runSearchAndReply(
        ctx,
        userId,
        session,
        Number.isFinite(page) ? page : 0,
        language,
      );
      return;
    }

    await ctx.answerCbQuery();
  }

  /**
   * FR-SCH-005/006 — resolves the user-typed category CODE to the real
   * `categoryId` `ReportQueryRepository.searchTransactions` needs, composes
   * the optional date range (`dateTo` is INCLUSIVE per this task's own
   * `SearchFilters` contract, so it is converted to the repository's own
   * EXCLUSIVE-end convention by adding one day), and reuses
   * `SearchTransactionsUseCase` unchanged — no financial calculation, no
   * new query, here.
   */
  private async runSearchAndReply(
    ctx: BotContext,
    userId: string,
    session: SearchSessionRecord,
    page: number,
    language: DetectedLanguage,
  ): Promise<void> {
    let categoryId: string | undefined;
    if (session.filters.category) {
      const category = await this.categoryRepository.findByCode(session.filters.category);
      categoryId = category?.id;
    }

    const dateRange =
      session.filters.dateFrom || session.filters.dateTo
        ? {
            start: session.filters.dateFrom ? new Date(session.filters.dateFrom) : new Date(0),
            end: session.filters.dateTo
              ? new Date(
                  new Date(session.filters.dateTo).getTime() +
                    TelegramBotService.SEARCH_DATE_PLUS_ONE_DAY_MS,
                )
              : new Date('2999-01-01'),
          }
        : null;

    const output = await this.searchTransactions.execute({
      userId,
      filters: {
        categoryId,
        merchant: session.filters.merchant,
        transactionType: session.filters.transactionType as TransactionType | undefined,
        minAmount: session.filters.minAmount,
        maxAmount: session.filters.maxAmount,
        tags: session.filters.tags,
      },
      dateRange,
      page,
    });

    await this.searchSessionRepository.compareAndSet(userId, session.version, {
      ...session,
      version: session.version + 1,
      page: output.page,
      expiresAt: this.searchSessionExpiresAt(),
    });

    if (output.results.length === 0) {
      await ctx.reply(searchNoResultsReply(language));
      return;
    }

    await ctx.reply(renderSearchResults(output.results, output.page, output.totalCount, language), {
      reply_markup: buildSearchResultsKeyboard(
        output.results.map((r) => r.id),
        output.page,
        output.hasNextPage,
        output.hasPreviousPage,
        language,
      ),
    });
  }

  // ==========================================================================
  // TASK-AUTH-006 — Account Deletion Flow (Chapter 12 §12.18)
  // ==========================================================================

  /** Order-of-magnitude mirrors `SEARCH_SESSION_TTL_MS`/`LOAN_WIZARD_TTL_MS` — an in-progress "type DELETE" prompt should not linger indefinitely. */
  private static readonly ACCOUNT_DELETION_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
  private static readonly ACCOUNT_DELETION_CONFIRM_WORD = 'DELETE';

  /**
   * `delacct_*` callback_data dispatch. `delacct_confirm` marks the
   * next-text-is-the-answer flag (never mutates `users` yet — the exact
   * literal "DELETE" text is the only thing that does); `delacct_cancel`
   * declines the request outright (§12.18's own "[Cancel]" button — a
   * distinct concept from `delacct_cancel_pending`, which reverses an
   * ALREADY-pending deletion via `CancelAccountDeletionUseCase`).
   *
   * `delacct_cancel_pending` never trusts any id carried in `data` (there
   * is none — it is a fixed literal) — `userId` is always resolved via
   * `requireCurrentUserId()` (ALS, set from THIS update's own real Telegram
   * sender), so a stale button from an old message can only ever act on
   * whichever account is actually clicking it, never a different user's.
   */
  private async handleAccountDeletionCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();

    if (data === 'delacct_confirm') {
      const expiresAt = new Date(
        Date.now() + TelegramBotService.ACCOUNT_DELETION_CONFIRMATION_TTL_MS,
      );
      await this.accountDeletionConfirmationRepository.markAwaitingConfirmation(userId, expiresAt);
      await ctx.answerCbQuery();
      await ctx.reply(accountDeletionTypeToConfirmReply(language));
      return;
    }

    if (data === 'delacct_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply(cancelledReply(language));
      return;
    }

    if (data === 'delacct_cancel_pending') {
      const outcome = await this.cancelAccountDeletion.execute(userId, new Date());
      await ctx.answerCbQuery();
      if (outcome.kind === 'cancelled') {
        await ctx.reply(accountDeletionCancelledReply(language));
        return;
      }
      if (outcome.kind === 'grace_period_expired') {
        await ctx.reply(accountDeletionGracePeriodExpiredReply(language));
        return;
      }
      await ctx.reply(accountDeletionCancelNotPendingReply(outcome.currentStatus, language));
      return;
    }

    await ctx.answerCbQuery();
  }

  /**
   * TASK-AI-006 — the OCR draft review card's Confirm/Edit/Cancel handler.
   * `RouteOcrDraftCallbackUseCase` already enforces cross-user isolation
   * (draft ownership check) and idempotency (the same
   * `TransactionCommitPort` lock every other commit path relies on) —
   * this method only ever maps its outcome to a reply, never re-derives
   * authorization or re-attempts a commit itself.
   */
  private async handleOcrDraftCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const outcome = await this.routeOcrDraftCallback.execute({
      userId: requireCurrentUserId(),
      callbackData: data,
    });
    await ctx.answerCbQuery();

    switch (outcome.kind) {
      case 'malformed':
        await ctx.reply(malformedCallbackReply(language));
        return;
      case 'not_found':
      case 'already_resolved':
        await ctx.reply(staleCallbackReply(language));
        return;
      case 'cancelled':
        await ctx.reply(cancelledReply(language));
        return;
      case 'commit_failed':
        await ctx.reply(ocrDraftCommitFailedReply(language));
        return;
      case 'retry':
        await ctx.reply(ocrDraftRetryReply(language));
        return;
      case 'confirmed':
        await ctx.reply(ocrDraftConfirmedReply(outcome.candidate, language));
        return;
      case 'edit_ready':
        await ctx.reply(
          renderConfirmationMessage(outcome.candidate, outcome.flaggedFields, language),
          {
            reply_markup: buildConfirmationKeyboard(
              outcome.transactionId,
              outcome.flaggedFields,
              language,
            ),
          },
        );
        return;
      default: {
        const exhaustiveCheck: never = outcome;
        return exhaustiveCheck;
      }
    }
  }

  /**
   * TASK-REP-TG — `/report`'s own `report_*` callback_data namespace, same
   * separate-namespace precedent as `handleSearchCallback`/
   * `handleOcrDraftCallback` above. Every branch derives `userId` via
   * `requireCurrentUserId()` only — callback_data here never carries a user
   * id (only a report type, a categoryId, or a merchant hash), so a tapped
   * callback can never be used to fetch another user's report; the query
   * always runs scoped to whoever is tapping right now, not whoever the
   * button was originally sent to.
   */
  private async handleReportCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();

    if (data === 'report_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply(cancelledReply(language));
      return;
    }

    if (data === 'report_back') {
      await ctx.answerCbQuery();
      await ctx.reply(reportMenuReply(language), {
        reply_markup: buildReportMenuKeyboard(language),
      });
      return;
    }

    if (data.startsWith('report_type:')) {
      const type = data.slice('report_type:'.length);
      await ctx.answerCbQuery();
      if (!isReportType(type)) {
        await ctx.reply(malformedCallbackReply(language));
        return;
      }
      await this.handleReportTypeSelected(ctx, userId, type, language);
      return;
    }

    if (data.startsWith('report_range:')) {
      const rest = data.slice('report_range:'.length);
      const [type, daysText] = rest.split(':');
      const days = Number(daysText);
      await ctx.answerCbQuery();
      if (
        !isReportType(type) ||
        !RANGE_REPORT_TYPES.includes(type) ||
        !Number.isFinite(days) ||
        days <= 0
      ) {
        await ctx.reply(malformedCallbackReply(language));
        return;
      }
      await this.generateRangeReportAndReply(ctx, userId, type, days, language);
      return;
    }

    if (data.startsWith('report_cat:')) {
      const categoryId = data.slice('report_cat:'.length);
      await ctx.answerCbQuery();
      await this.generateCategoryReportAndReply(ctx, userId, categoryId, language);
      return;
    }

    if (data.startsWith('report_mer:')) {
      const merchantHash = data.slice('report_mer:'.length);
      await ctx.answerCbQuery();
      await this.generateMerchantReportAndReply(ctx, userId, merchantHash, language);
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply(malformedCallbackReply(language));
  }

  private async handleReportTypeSelected(
    ctx: BotContext,
    userId: string,
    type: ReportType,
    language: DetectedLanguage,
  ): Promise<void> {
    if (RANGE_REPORT_TYPES.includes(type)) {
      await ctx.reply(reportRangePromptReply(language), {
        reply_markup: buildReportRangePresetKeyboard(type, language),
      });
      return;
    }

    if (type === 'category') {
      await this.showReportCategoryPicker(ctx, userId, language);
      return;
    }

    if (type === 'merchant') {
      await this.showReportMerchantPicker(ctx, userId, language);
      return;
    }

    await this.generateImmediateReportAndReply(ctx, userId, type, language);
  }

  /** daily/weekly/monthly/quarterly/yearly/debt_summary — no sub-menu, generated straight from `asOf = now` exactly as `GenerateReportUseCase`'s own default parameter already does. */
  private async generateImmediateReportAndReply(
    ctx: BotContext,
    userId: string,
    type: ReportType,
    language: DetectedLanguage,
  ): Promise<void> {
    const asOf = new Date();
    let text: string | null;
    try {
      switch (type) {
        case 'daily':
          text = renderDailyReport(await this.generateReport.generateDaily(userId, asOf), language);
          break;
        case 'weekly':
          text = renderWeeklyReport(
            await this.generateReport.generateWeekly(userId, asOf),
            language,
          );
          break;
        case 'monthly':
          text = renderMonthlyReport(
            await this.generateReport.generateMonthly(userId, asOf),
            language,
          );
          break;
        case 'quarterly':
          text = renderQuarterlyReport(
            await this.generateReport.generateQuarterly(userId, asOf),
            language,
          );
          break;
        case 'yearly':
          text = renderYearlyReport(
            await this.generateReport.generateYearly(userId, asOf),
            language,
          );
          break;
        case 'debt_summary':
          text = renderDebtSummaryReport(
            await this.generateReport.generateDebtSummary(userId, asOf),
            language,
          );
          break;
        default:
          text = null;
      }
    } catch (error) {
      this.logger.error(`GenerateReportUseCase failed for report type "${type}"`, error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }

    await this.replyWithReport(ctx, text, language);
  }

  /** cash_flow/custom_range/trend_analysis — a fixed 7/30/90-day preset range picked by the user, never a new free-text date-entry flow. */
  private async generateRangeReportAndReply(
    ctx: BotContext,
    userId: string,
    type: ReportType,
    days: number,
    language: DetectedLanguage,
  ): Promise<void> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    const range: ReportDateRange = { start, end };

    let text: string | null;
    try {
      switch (type) {
        case 'cash_flow':
          text = renderCashFlowReport(
            await this.generateReport.generateCashFlow(
              userId,
              range,
              ctx.provisioning!.user.defaultCurrency,
            ),
            language,
          );
          break;
        case 'custom_range':
          text = renderCustomRangeReport(
            await this.generateReport.generateCustomRange(userId, range),
            language,
          );
          break;
        case 'trend_analysis':
          text = renderTrendAnalysisReport(
            await this.generateReport.generateTrendAnalysis(userId, range),
            language,
          );
          break;
        default:
          text = null;
      }
    } catch (error) {
      this.logger.error(`GenerateReportUseCase failed for report type "${type}"`, error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }

    await this.replyWithReport(ctx, text, language);
  }

  /** `CategoryRepository` has no "list all" method (no new repository code for this task) — the picker instead reuses the SAME `getCategoryBreakdown` query `GenerateReportUseCase` itself already calls internally for other report types, over a fixed recent window, to surface the user's own real, non-empty categories. */
  private reportPickerLookbackRange(): ReportDateRange {
    const end = new Date();
    const start = new Date(end.getTime() - PICKER_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  private async showReportCategoryPicker(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const range = this.reportPickerLookbackRange();
    let categories: CategoryAmount[];
    try {
      categories = await this.reportQueryRepository.getCategoryBreakdown(userId, range, {
        transactionType: 'EXPENSE',
      });
    } catch (error) {
      this.logger.error('Failed to load /report category picker data', error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }

    const keyboard = buildReportCategoryPickerKeyboard(categories, language);
    if (keyboard === null) {
      await ctx.reply(reportEmptyReply(language));
      return;
    }
    await ctx.reply(reportCategoryPickerReply(language), { reply_markup: keyboard });
  }

  private async generateCategoryReportAndReply(
    ctx: BotContext,
    userId: string,
    categoryId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const range = this.reportPickerLookbackRange();
    let text: string | null;
    try {
      text = renderCategoryReport(
        await this.generateReport.generateCategoryReport(userId, categoryId, range),
        language,
      );
    } catch (error) {
      this.logger.error('GenerateReportUseCase failed for report type "category"', error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }
    await this.replyWithReport(ctx, text, language);
  }

  private async showReportMerchantPicker(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const range = this.reportPickerLookbackRange();
    let merchants: MerchantAmount[];
    try {
      merchants = await this.reportQueryRepository.getMerchantBreakdown(userId, range, {
        transactionType: 'EXPENSE',
      });
    } catch (error) {
      this.logger.error('Failed to load /report merchant picker data', error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }

    const keyboard = buildReportMerchantPickerKeyboard(merchants, language);
    if (keyboard === null) {
      await ctx.reply(reportEmptyReply(language));
      return;
    }
    await ctx.reply(reportMerchantPickerReply(language), { reply_markup: keyboard });
  }

  /**
   * `merchantHash` is `hashMerchant(merchant)` (never the raw merchant text)
   * from a button `showReportMerchantPicker` built for THIS SAME
   * `requireCurrentUserId()`. Re-fetching that user's own breakdown here
   * (rather than trusting anything from callback_data) and matching by hash
   * is what makes this immune to cross-user replay: tapping a copy of
   * someone else's button re-derives against the tapping user's own data,
   * where the hash will simply not match anything (handled below as an
   * invalid callback), never another user's merchant name.
   */
  private async generateMerchantReportAndReply(
    ctx: BotContext,
    userId: string,
    merchantHash: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const range = this.reportPickerLookbackRange();
    let merchants: MerchantAmount[];
    try {
      merchants = await this.reportQueryRepository.getMerchantBreakdown(userId, range, {
        transactionType: 'EXPENSE',
      });
    } catch (error) {
      this.logger.error('Failed to load /report merchant picker data', error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }

    const match = merchants.find((m) => hashMerchant(m.merchant) === merchantHash);
    if (!match) {
      await ctx.reply(malformedCallbackReply(language));
      return;
    }

    let text: string | null;
    try {
      text = renderMerchantReport(
        await this.generateReport.generateMerchantReport(userId, match.merchant, range),
        language,
      );
    } catch (error) {
      this.logger.error('GenerateReportUseCase failed for report type "merchant"', error as Error);
      await ctx.reply(reportErrorReply(language));
      return;
    }
    await this.replyWithReport(ctx, text, language);
  }

  /** `text === null` means the report renderer determined its own report was empty (rule: friendly "not enough data" reply, never a wall of zeros). Otherwise splits for Telegram's 4096-char limit and always offers a Back-to-menu button on the final chunk. */
  private async replyWithReport(
    ctx: BotContext,
    text: string | null,
    language: DetectedLanguage,
  ): Promise<void> {
    if (text === null) {
      await ctx.reply(reportEmptyReply(language));
      return;
    }

    const chunks = splitTelegramMessage(text);
    for (let i = 0; i < chunks.length; i += 1) {
      const isLast = i === chunks.length - 1;
      await ctx.reply(
        chunks[i]!,
        isLast ? { reply_markup: buildReportBackKeyboard(language) } : undefined,
      );
    }
  }

  /**
   * TASK-FIN-014 — `/export`'s own `export_*` callback_data namespace, same
   * separate-namespace precedent as `handleReportCallback`. `userId` always
   * comes from `requireCurrentUserId()`, never callback_data (which here
   * carries only a fixed date-range preset name — nothing user-identifying,
   * nothing arbitrary).
   */
  private async handleExportCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();

    if (data === 'export_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply(cancelledReply(language));
      return;
    }

    if (data.startsWith('export_range:')) {
      const preset = data.slice('export_range:'.length);
      await ctx.answerCbQuery();
      if (!isExportRangePreset(preset)) {
        await ctx.reply(malformedCallbackReply(language));
        return;
      }
      await this.generateExportAndSend(ctx, userId, preset, language);
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply(malformedCallbackReply(language));
  }

  private computeExportRange(preset: ExportRangePreset): ReportDateRange {
    const now = new Date();
    switch (preset) {
      case 'this_month':
        return computeMonthlyBoundary(now).current;
      case 'last_month':
        return computeMonthlyBoundary(now).prior;
      case 'last_90_days':
        return { start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000), end: now };
      case 'all_time':
        // Same unbounded-sentinel convention `runSearchAndReply` already
        // uses for an all-time filter — never a fabricated "epoch to now"
        // that would silently exclude a transaction dated in the future
        // (e.g. a scheduled/post-dated entry).
        return { start: new Date(0), end: new Date('2999-01-01') };
      default: {
        const exhaustiveCheck: never = preset;
        return exhaustiveCheck;
      }
    }
  }

  /** BR-EXP2-001 — the export query always runs scoped to `userId` (from `requireCurrentUserId()`), never anything from callback_data; internal errors are logged server-side only, never surfaced to Telegram (rule: no stack trace/internal detail leakage). */
  private async generateExportAndSend(
    ctx: BotContext,
    userId: string,
    preset: ExportRangePreset,
    language: DetectedLanguage,
  ): Promise<void> {
    const range = this.computeExportRange(preset);

    let outcome;
    try {
      outcome = await this.exportTransactions.execute(userId, range);
    } catch (error) {
      this.logger.error(`ExportTransactionsUseCase failed for preset "${preset}"`, error as Error);
      await ctx.reply(exportErrorReply(language));
      return;
    }

    if (outcome.kind === 'empty') {
      await ctx.reply(exportEmptyReply(language));
      return;
    }
    if (outcome.kind === 'too_large') {
      await ctx.reply(exportTooLargeReply(outcome.rowCount, language));
      return;
    }

    // Deterministic filename, never user-controlled input, never carrying a
    // user id or other identifying value — an outbound in-memory buffer
    // attached to this one Telegram message, never written to any shared
    // filesystem/object path, so there is no "overwrite another user's
    // file" surface for a predictable name to exploit here.
    const filename = `transactions_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    await ctx.replyWithDocument(
      { source: outcome.buffer, filename },
      { caption: exportReadyCaption(outcome.rowCount, language) },
    );
  }

  /** Factored out of the `/export` command itself so `/settings`'s own "Data export" redirect button (§7.4.4) shows the exact same menu without duplicating it — zero behavioral change to `/export` itself. */
  private async showExportMenu(ctx: BotContext, language: DetectedLanguage): Promise<void> {
    await ctx.reply(exportMenuReply(language), { reply_markup: buildExportMenuKeyboard(language) });
  }

  /** Factored out of the `/deleteaccount` command itself so `/settings`'s own "Account deletion" redirect button (§7.4.4) shows the exact same prompt without duplicating it — zero behavioral change to `/deleteaccount` itself. */
  private async showDeleteAccountPrompt(
    ctx: BotContext,
    user: User,
    language: DetectedLanguage,
  ): Promise<void> {
    // TASK-AUTH-006 — repeated `/deleteaccount` while already
    // `pending_deletion`: no new request is created (the middleware
    // above only lets this command through in that state to reach this
    // exact branch), just an honest status/grace-period report plus the
    // same "Cancel account deletion" button.
    if (user.status === 'pending_deletion' && user.deletionRequestedAt) {
      const daysRemaining = accountDeletionGracePeriodDaysRemaining(
        user.deletionRequestedAt,
        new Date(),
      );
      await ctx.reply(accountDeletionAlreadyPendingReply(daysRemaining, language), {
        reply_markup: buildCancelPendingDeletionKeyboard(language),
      });
      return;
    }

    await ctx.reply(accountDeletionConfirmPromptReply(language), {
      reply_markup: buildAccountDeletionConfirmKeyboard(language),
    });
  }

  /**
   * TASK-BOT-SET (Chapter 7 §7.3/§7.4) — `/settings`'s own `settings_*`
   * callback_data namespace, same separate-namespace precedent as
   * `handleReportCallback`/`handleExportCallback`. `userId` always comes
   * from `requireCurrentUserId()`, never callback_data — callback_data here
   * carries only a fixed field name/enum value (a language code, a currency
   * code, a curated timezone string, a notification-toggle key), and every
   * one of those is still re-validated server-side by `UpdateUserProfileUseCase`/
   * the real `CurrencyRepository`/`isValidIanaTimezone` regardless of
   * whether it came from a button this code built or a forged callback —
   * the same "never trust the client, always re-check" discipline every
   * other callback handler in this file already follows.
   */
  private async handleSettingsCallback(
    ctx: BotContext,
    data: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const userId = requireCurrentUserId();

    if (data === 'settings_cancel') {
      await ctx.answerCbQuery();
      await ctx.reply(cancelledReply(language));
      return;
    }

    if (data === 'settings_back') {
      await ctx.answerCbQuery();
      await this.showSettingsMenu(ctx, userId, language);
      return;
    }

    if (data === 'settings_lang') {
      await ctx.answerCbQuery();
      await ctx.reply(settingsLanguagePromptReply(language), {
        reply_markup: buildSettingsLanguageKeyboard(language),
      });
      return;
    }

    if (data === 'settings_currency') {
      await ctx.answerCbQuery();
      await this.showSettingsCurrencyPicker(ctx, language);
      return;
    }

    if (data === 'settings_timezone') {
      await ctx.answerCbQuery();
      await ctx.reply(settingsTimezonePromptReply(language), {
        reply_markup: buildSettingsTimezoneKeyboard(language),
      });
      return;
    }

    if (data === 'settings_notif') {
      await ctx.answerCbQuery();
      await this.showSettingsNotifications(ctx, userId, language);
      return;
    }

    if (data === 'settings_confidence') {
      await ctx.answerCbQuery();
      await this.showSettingsConfidence(ctx, userId, language);
      return;
    }

    if (data === 'settings_export') {
      await ctx.answerCbQuery();
      await this.showExportMenu(ctx, language);
      return;
    }

    if (data === 'settings_deleteaccount') {
      await ctx.answerCbQuery();
      await this.showDeleteAccountPrompt(ctx, ctx.provisioning!.user, language);
      return;
    }

    if (data.startsWith('settings_lang_set:')) {
      const value = data.slice('settings_lang_set:'.length);
      await ctx.answerCbQuery();
      await this.applyProfileUpdate(ctx, userId, 'language', value, language);
      return;
    }

    if (data.startsWith('settings_currency_set:')) {
      const value = data.slice('settings_currency_set:'.length);
      await ctx.answerCbQuery();
      await this.applyProfileUpdate(ctx, userId, 'currency', value, language);
      return;
    }

    if (data.startsWith('settings_timezone_set:')) {
      const value = data.slice('settings_timezone_set:'.length);
      await ctx.answerCbQuery();
      await this.applyProfileUpdate(ctx, userId, 'timezone', value, language);
      return;
    }

    if (data.startsWith('settings_notif_toggle:')) {
      const toggle = data.slice('settings_notif_toggle:'.length);
      await ctx.answerCbQuery();
      if (toggle !== 'debt_reminder' && toggle !== 'budget_alert') {
        await ctx.reply(malformedCallbackReply(language));
        return;
      }
      await this.toggleNotificationPreference(ctx, userId, toggle, language);
      return;
    }

    if (data === 'settings_confidence_toggle') {
      await ctx.answerCbQuery();
      await this.toggleConfidencePreference(ctx, userId, language);
      return;
    }

    if (data === 'settings_categories') {
      await ctx.answerCbQuery();
      await this.showCustomCategoriesList(ctx, userId, language);
      return;
    }

    if (data === 'settings_categories_add') {
      await ctx.answerCbQuery();
      await this.startCustomCategoryWizard(ctx, userId, language);
      return;
    }

    if (data === 'settings_categories_cancel') {
      await ctx.answerCbQuery();
      await this.cancelCustomCategoryWizard(userId);
      await this.showCustomCategoriesList(ctx, userId, language);
      return;
    }

    if (data.startsWith('settings_categories_parent:')) {
      const code = data.slice('settings_categories_parent:'.length);
      await ctx.answerCbQuery();
      await this.handleCustomCategoryParentSelected(ctx, userId, code, language);
      return;
    }

    if (data.startsWith('settings_categories_delete_confirm:')) {
      const id = data.slice('settings_categories_delete_confirm:'.length);
      await ctx.answerCbQuery();
      await this.handleCustomCategoryDeleteConfirmed(ctx, userId, id, language);
      return;
    }

    if (data === 'settings_categories_delete_cancel') {
      await ctx.answerCbQuery();
      await this.showCustomCategoriesList(ctx, userId, language);
      return;
    }

    if (data.startsWith('settings_categories_delete:')) {
      const id = data.slice('settings_categories_delete:'.length);
      await ctx.answerCbQuery();
      await this.handleCustomCategoryDeletePreview(ctx, userId, id, language);
      return;
    }

    await ctx.answerCbQuery();
    await ctx.reply(malformedCallbackReply(language));
  }

  private async showSettingsMenu(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let summary;
    try {
      summary = await this.getUserSettingsSummary.execute(userId);
    } catch (error) {
      this.logger.error('GetUserSettingsSummaryUseCase failed', error as Error);
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    if (!summary) {
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    await ctx.reply(settingsMenuReply(summary.user, language), {
      reply_markup: buildSettingsMenuKeyboard(language),
    });
  }

  private async showSettingsCurrencyPicker(
    ctx: BotContext,
    language: DetectedLanguage,
  ): Promise<void> {
    let codes: string[];
    try {
      codes = await this.currencyRepository.listActiveCodes();
    } catch (error) {
      this.logger.error('CurrencyRepository.listActiveCodes failed', error as Error);
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    await ctx.reply(settingsCurrencyPromptReply(language), {
      reply_markup: buildSettingsCurrencyKeyboard(codes, language),
    });
  }

  // ==========================================================================
  // TASK-FIN-006 — Custom Categories (Chapter 7 §7.4, Chapter 8 §8.11)
  // ==========================================================================

  /** Mirrors `LOAN_WIZARD_TTL_MS`'s own order of magnitude for an in-progress guided-flow dialog. */
  private static readonly CUSTOM_CATEGORY_WIZARD_TTL_MS = 10 * 60 * 1000;

  private customCategoryWizardExpiresAt(): string {
    return new Date(
      Date.now() + TelegramBotService.CUSTOM_CATEGORY_WIZARD_TTL_MS,
    ).toISOString();
  }

  private async showCustomCategoriesList(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let categories;
    try {
      categories = await this.listCustomCategories.execute(userId);
    } catch (error) {
      this.logger.error('ListCustomCategoriesUseCase failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }
    await ctx.reply(customCategoriesListReply(categories.length, language), {
      reply_markup: buildCustomCategoriesListKeyboard(categories, language),
    });
  }

  private async startCustomCategoryWizard(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const current = await this.customCategoryWizardStateRepository.get(userId);
    await this.customCategoryWizardStateRepository.compareAndSet(userId, current?.version ?? 0, {
      version: (current?.version ?? 0) + 1,
      step: 'AWAITING_NAME',
      name: null,
      expiresAt: this.customCategoryWizardExpiresAt(),
    });
    await ctx.reply(customCategoryNamePromptReply(language));
  }

  private async cancelCustomCategoryWizard(userId: string): Promise<void> {
    const state = await this.customCategoryWizardStateRepository.get(userId);
    if (state) {
      await this.customCategoryWizardStateRepository.compareAndSet(userId, state.version, null);
    }
  }

  /** The `AWAITING_NAME` step — intercepted BEFORE `RouteTextMessageUseCase`'s AI-extraction pipeline, same priority-over-AI precedence the Loan Wizard/Search/account-deletion text steps already establish. */
  private async handleCustomCategoryWizardTextStep(
    ctx: BotContext,
    state: CustomCategoryWizardStateRecord,
    user: User,
  ): Promise<void> {
    const language = this.replyLanguageFor(user, null);
    const userId = requireCurrentUserId();
    const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text.trim() : '';

    if (state.step !== 'AWAITING_NAME') {
      // Only reachable via a stray text message while a parent-selection
      // keyboard is pending — the reply itself nudges the user back to the
      // buttons rather than silently doing nothing.
      await ctx.reply(customCategoryParentPromptReply(language));
      return;
    }

    let availability;
    try {
      availability = await this.createCustomCategory.checkNameAvailability(userId, text);
    } catch (error) {
      this.logger.error('CreateCustomCategoryUseCase.checkNameAvailability failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }

    if (availability === 'invalid') {
      await ctx.reply(customCategoryInvalidNameReply(language));
      return;
    }
    if (availability === 'duplicate') {
      await ctx.reply(customCategoryDuplicateNameReply(language));
      return;
    }

    let parentOptions;
    try {
      parentOptions = await this.createCustomCategory.listParentOptions(language);
    } catch (error) {
      this.logger.error('CreateCustomCategoryUseCase.listParentOptions failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }

    const written = await this.customCategoryWizardStateRepository.compareAndSet(
      userId,
      state.version,
      {
        version: state.version + 1,
        step: 'AWAITING_PARENT_SELECTION',
        name: text,
        expiresAt: this.customCategoryWizardExpiresAt(),
      },
    );
    if (!written) {
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }

    await ctx.reply(customCategoryParentPromptReply(language), {
      reply_markup: buildCustomCategoryParentKeyboard(parentOptions, language),
    });
  }

  private async handleCustomCategoryParentSelected(
    ctx: BotContext,
    userId: string,
    parentCode: string,
    language: DetectedLanguage,
  ): Promise<void> {
    const state = await this.customCategoryWizardStateRepository.get(userId);
    if (!state || state.step !== 'AWAITING_PARENT_SELECTION' || !state.name) {
      // A stale/forged callback, or the wizard already expired/finished —
      // generic safe response, never leaks which case it was.
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }

    let outcome;
    try {
      outcome = await this.createCustomCategory.execute({
        userId,
        name: state.name,
        language,
        parentCategoryCode: parentCode,
      });
    } catch (error) {
      this.logger.error('CreateCustomCategoryUseCase failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }

    switch (outcome.kind) {
      case 'invalid_parent':
        // Server-side re-verification rejected the code — a forged/stale
        // callback, never a raw id trusted from the client.
        await ctx.reply(customCategoryInvalidParentReply(language));
        return;
      case 'duplicate_name':
        // Only reachable via a genuine concurrent race (the name step's own
        // `checkNameAvailability` already passed) — the atomic DB write lost
        // the race, so this is reported exactly like the earlier check.
        await this.customCategoryWizardStateRepository.compareAndSet(userId, state.version, null);
        await ctx.reply(customCategoryDuplicateNameReply(language));
        return;
      case 'created':
        await this.customCategoryWizardStateRepository.compareAndSet(userId, state.version, null);
        await ctx.reply(customCategoryCreatedReply(outcome.category.name, outcome.parentLabel, language));
        return;
    }
  }

  private async handleCustomCategoryDeletePreview(
    ctx: BotContext,
    userId: string,
    categoryId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let preview;
    try {
      preview = await this.deleteCustomCategory.preview(categoryId, userId, language);
    } catch (error) {
      if (error instanceof CustomCategoryNotFoundError) {
        await ctx.reply(customCategoryNotFoundReply(language));
        return;
      }
      this.logger.error('DeleteCustomCategoryUseCase.preview failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }
    await ctx.reply(
      customCategoryDeletePreviewReply(
        preview.category.name,
        preview.parentLabel,
        preview.affectedTransactionCount,
        language,
      ),
      { reply_markup: buildCustomCategoryDeleteConfirmKeyboard(categoryId, language) },
    );
  }

  private async handleCustomCategoryDeleteConfirmed(
    ctx: BotContext,
    userId: string,
    categoryId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let result;
    try {
      result = await this.deleteCustomCategory.execute(categoryId, userId, language);
    } catch (error) {
      this.logger.error('DeleteCustomCategoryUseCase.execute failed', error as Error);
      await ctx.reply(customCategoryErrorReply(language));
      return;
    }
    if (!result) {
      // Idempotent-safe double-delete (already deprecated by an earlier/
      // concurrent confirm tap) — same generic safe response as "not found",
      // never a second reversal attempt.
      await ctx.reply(customCategoryNotFoundReply(language));
      return;
    }
    await ctx.reply(
      customCategoryDeletedReply(result.parentLabel, result.reassignedTransactionCount, language),
    );
  }

  private async showSettingsNotifications(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let summary;
    try {
      summary = await this.getUserSettingsSummary.execute(userId);
    } catch (error) {
      this.logger.error('GetUserSettingsSummaryUseCase failed', error as Error);
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    if (!summary) {
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    await ctx.reply(settingsNotificationsPromptReply(language), {
      reply_markup: buildSettingsNotificationsKeyboard(summary.notificationPreferences, language),
    });
  }

  private async showSettingsConfidence(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let summary;
    try {
      summary = await this.getUserSettingsSummary.execute(userId);
    } catch (error) {
      this.logger.error('GetUserSettingsSummaryUseCase failed', error as Error);
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    if (!summary) {
      await ctx.reply(settingsErrorReply(language));
      return;
    }
    await ctx.reply(settingsConfidencePromptReply(language), {
      reply_markup: buildSettingsConfidenceKeyboard(summary.confidenceDisplay, language),
    });
  }

  private async applyProfileUpdate(
    ctx: BotContext,
    userId: string,
    field: UpdateUserProfileField,
    value: string,
    language: DetectedLanguage,
  ): Promise<void> {
    let outcome;
    try {
      outcome = await this.updateUserProfile.execute(userId, field, value);
    } catch (error) {
      this.logger.error(`UpdateUserProfileUseCase failed for field "${field}"`, error as Error);
      await ctx.reply(settingsErrorReply(language));
      return;
    }

    if (outcome.kind === 'invalid_value') {
      await ctx.reply(settingsInvalidValueReply(language));
      return;
    }

    await ctx.reply(settingsProfileUpdatedReply(field, value, language), {
      reply_markup: buildSettingsBackKeyboard(language),
    });
  }

  private async toggleNotificationPreference(
    ctx: BotContext,
    userId: string,
    toggle: 'debt_reminder' | 'budget_alert',
    language: DetectedLanguage,
  ): Promise<void> {
    const key =
      toggle === 'debt_reminder'
        ? SETTINGS_PREFERENCE_KEYS.NOTIF_DEBT_REMINDER
        : SETTINGS_PREFERENCE_KEYS.NOTIF_BUDGET_ALERT;

    let summary;
    try {
      summary = await this.getUserSettingsSummary.execute(userId);
      if (!summary) {
        await ctx.reply(settingsErrorReply(language));
        return;
      }
      const current =
        toggle === 'debt_reminder'
          ? summary.notificationPreferences.debtReminder
          : summary.notificationPreferences.budgetAlert;
      const next = !current;
      await this.setUserPreference.execute(userId, key, next);
      await ctx.reply(settingsNotificationToggledReply(toggle, next, language), {
        reply_markup: buildSettingsBackKeyboard(language),
      });
    } catch (error) {
      this.logger.error('SetUserPreferenceUseCase failed for notification toggle', error as Error);
      await ctx.reply(settingsErrorReply(language));
    }
  }

  private async toggleConfidencePreference(
    ctx: BotContext,
    userId: string,
    language: DetectedLanguage,
  ): Promise<void> {
    try {
      const summary = await this.getUserSettingsSummary.execute(userId);
      if (!summary) {
        await ctx.reply(settingsErrorReply(language));
        return;
      }
      const next = !summary.confidenceDisplay;
      await this.setUserPreference.execute(
        userId,
        SETTINGS_PREFERENCE_KEYS.CONFIDENCE_DISPLAY,
        next,
      );
      await ctx.reply(settingsConfidenceToggledReply(next, language), {
        reply_markup: buildSettingsBackKeyboard(language),
      });
    } catch (error) {
      this.logger.error('SetUserPreferenceUseCase failed for confidence toggle', error as Error);
      await ctx.reply(settingsErrorReply(language));
    }
  }

  /**
   * The single plain-text message following "Type DELETE to confirm." —
   * one-shot: the awaiting-flag is always cleared here, regardless of
   * outcome, so a stale/duplicate follow-up message is never re-processed
   * as a second answer. Only the exact literal `"DELETE"` (after
   * whitespace trimming, matching every other text-input handler in this
   * file) proceeds; anything else leaves the account fully unchanged.
   */
  private async handleAccountDeletionTextStep(ctx: BotContext, user: User): Promise<void> {
    const language = this.replyLanguageFor(user, null);
    const userId = requireCurrentUserId();
    const text = 'text' in ctx.message! ? (ctx.message as { text: string }).text.trim() : '';

    await this.accountDeletionConfirmationRepository.clear(userId);

    if (text !== TelegramBotService.ACCOUNT_DELETION_CONFIRM_WORD) {
      await ctx.reply(accountDeletionWrongTextReply(language));
      return;
    }

    const outcome = await this.requestAccountDeletion.execute(userId);
    if (outcome.kind === 'requested') {
      await ctx.reply(accountDeletionRequestedReply(language), {
        reply_markup: buildCancelPendingDeletionKeyboard(language),
      });
      return;
    }
    await ctx.reply(accountDeletionNotEligibleReply(outcome.currentStatus, language));
  }
}
