import type { BudgetThresholdCrossedPayload } from '../events/domain-event';
import type { DetectedLanguage } from '../ai-extraction/transaction-extraction-schema';

/**
 * TASK-FIN-003 (FR-BUD-005, FR-NOT-011). `categoryName` carries the
 * category's raw `code` (e.g. `"FOOD_DINING"`), not a translated display
 * label — full category-translation lookup (`category_translations`,
 * §13.8) is explicitly out of this task's scope, the same "minimal
 * projection... full category modeling belongs to TASK-FIN-006" boundary
 * `CategoryRepository`'s own doc comment already draws (see this task's
 * final report). `null` means the overall-scope budget, rendered as a
 * fixed, already-localized word instead.
 */
export function renderBudgetThresholdCrossedMessage(
  payload: BudgetThresholdCrossedPayload,
  language: DetectedLanguage,
): string {
  const scopeLabel =
    payload.categoryName ??
    { uz: 'Umumiy', ru: 'Общий', en: 'Overall' }[
      language === 'uz' || language === 'ru' ? language : 'en'
    ];

  const isFull = payload.thresholdPercent >= 100;

  switch (language) {
    case 'uz':
      return isFull
        ? `Diqqat: "${scopeLabel}" byudjetingiz shu davr uchun tugadi — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency} (${payload.utilizationPercent.toFixed(1)}%).`
        : `Ogohlantirish: "${scopeLabel}" byudjetingiz ${payload.thresholdPercent}% ga yetdi — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency}.`;
    case 'ru':
      return isFull
        ? `Внимание: бюджет "${scopeLabel}" исчерпан на этот период — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency} (${payload.utilizationPercent.toFixed(1)}%).`
        : `Предупреждение: бюджет "${scopeLabel}" достиг ${payload.thresholdPercent}% — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency}.`;
    case 'en':
    default:
      return isFull
        ? `You've gone over your "${scopeLabel}" budget for this period — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency} (${payload.utilizationPercent.toFixed(1)}%).`
        : `Warning: your "${scopeLabel}" budget has reached ${payload.thresholdPercent}% — ${payload.usedAmount} / ${payload.limitAmount} ${payload.currency}.`;
  }
}
