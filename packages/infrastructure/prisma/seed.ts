// ============================================================================
// Reference-table seed data.
// Grounds: Chapter 13 §13.15 ("reference tables... version-controlled as seed
// data... reconstructed independently if ever needed"), Chapter 4 §4.4.3
// (canonical category taxonomy — the exact 32 category names below are
// copied verbatim from that section; nothing added, nothing omitted),
// Chapter 13 §13.8 (currencies example set: UZS, USD, RUB, EUR).
//
// ENGINEERING EXECUTION DECISION (disclosed): Chapter 4 §4.4.3 gives display
// names only, not machine-readable `code` values, except one worked example
// ("TRANSPORTATION_FUEL", §4.4 line 277). Codes below follow that single
// demonstrated convention (uppercase snake_case of the display name); no
// parent/child hierarchy is seeded beyond what that one example evidences,
// since no other hierarchy relationship is stated in the PRD text —
// `parent_category_id` is left NULL throughout rather than invented.
// `default_type` per category is a seed-time judgment call (expense/income/
// neutral cash-flow direction), not a PRD-specified value.
//
// UZ/RU translations below are placeholder localization content, NOT
// PRD-sourced strings (Chapter 4/8 do not provide them) — they require the
// same real linguistic review TASK-BOT-008 already mandates for all
// user-facing bot copy before production use.
// ============================================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type SeedCategory = {
  code: string;
  defaultType: 'expense' | 'income' | 'neutral';
  icon: string;
  en: string;
  ru: string;
  uz: string;
};

// Chapter 4 §4.4.3's exact 32-entry taxonomy, in the order given there.
const CATEGORIES: SeedCategory[] = [
  {
    code: 'FOOD_DINING',
    defaultType: 'expense',
    icon: '🍽️',
    en: 'Food & Dining',
    ru: 'Еда и рестораны',
    uz: 'Oziq-ovqat va restoran',
  },
  {
    code: 'GROCERIES',
    defaultType: 'expense',
    icon: '🛒',
    en: 'Groceries',
    ru: 'Продукты',
    uz: 'Oziq-ovqat mahsulotlari',
  },
  {
    code: 'TRANSPORTATION',
    defaultType: 'expense',
    icon: '🚌',
    en: 'Transportation',
    ru: 'Транспорт',
    uz: 'Transport',
  },
  {
    code: 'TRANSPORTATION_FUEL',
    defaultType: 'expense',
    icon: '⛽',
    en: 'Fuel',
    ru: 'Топливо',
    uz: 'Yoqilg’i',
  },
  {
    code: 'SHOPPING',
    defaultType: 'expense',
    icon: '🛍️',
    en: 'Shopping',
    ru: 'Покупки',
    uz: 'Xaridlar',
  },
  {
    code: 'UTILITIES',
    defaultType: 'expense',
    icon: '💡',
    en: 'Utilities',
    ru: 'Коммунальные услуги',
    uz: 'Kommunal xizmatlar',
  },
  {
    code: 'HEALTHCARE',
    defaultType: 'expense',
    icon: '🏥',
    en: 'Healthcare',
    ru: 'Здравоохранение',
    uz: 'Sog’liqni saqlash',
  },
  {
    code: 'ENTERTAINMENT',
    defaultType: 'expense',
    icon: '🎬',
    en: 'Entertainment',
    ru: 'Развлечения',
    uz: 'Ko’ngilochar tadbirlar',
  },
  {
    code: 'EDUCATION',
    defaultType: 'expense',
    icon: '🎓',
    en: 'Education',
    ru: 'Образование',
    uz: 'Ta’lim',
  },
  {
    code: 'TRAVEL',
    defaultType: 'expense',
    icon: '✈️',
    en: 'Travel',
    ru: 'Путешествия',
    uz: 'Sayohat',
  },
  {
    code: 'BUSINESS',
    defaultType: 'expense',
    icon: '💼',
    en: 'Business',
    ru: 'Бизнес',
    uz: 'Biznes',
  },
  { code: 'TAX', defaultType: 'expense', icon: '🧾', en: 'Tax', ru: 'Налоги', uz: 'Soliq' },
  {
    code: 'INSURANCE',
    defaultType: 'expense',
    icon: '🛡️',
    en: 'Insurance',
    ru: 'Страхование',
    uz: 'Sug’urta',
  },
  {
    code: 'SUBSCRIPTIONS',
    defaultType: 'expense',
    icon: '🔁',
    en: 'Subscriptions',
    ru: 'Подписки',
    uz: 'Obunalar',
  },
  {
    code: 'HOUSING_RENT',
    defaultType: 'expense',
    icon: '🏠',
    en: 'Housing/Rent',
    ru: 'Жильё/Аренда',
    uz: 'Uy-joy/Ijara',
  },
  {
    code: 'SALARY',
    defaultType: 'income',
    icon: '💰',
    en: 'Salary',
    ru: 'Зарплата',
    uz: 'Ish haqi',
  },
  {
    code: 'FREELANCE_INCOME',
    defaultType: 'income',
    icon: '🧑‍💻',
    en: 'Freelance Income',
    ru: 'Фриланс-доход',
    uz: 'Frilanser daromadi',
  },
  {
    code: 'INVESTMENT',
    defaultType: 'neutral',
    icon: '📈',
    en: 'Investment',
    ru: 'Инвестиции',
    uz: 'Investitsiya',
  },
  {
    code: 'SAVINGS',
    defaultType: 'neutral',
    icon: '🏦',
    en: 'Savings',
    ru: 'Сбережения',
    uz: 'Jamg’arma',
  },
  {
    code: 'DEBT_GIVEN',
    defaultType: 'expense',
    icon: '🤝',
    en: 'Debt Given',
    ru: 'Долг выдан',
    uz: 'Berilgan qarz',
  },
  {
    code: 'DEBT_RECEIVED',
    defaultType: 'income',
    icon: '🤝',
    en: 'Debt Received',
    ru: 'Долг получен',
    uz: 'Olingan qarz',
  },
  {
    code: 'LOAN_PAYMENT',
    defaultType: 'expense',
    icon: '🏛️',
    en: 'Loan Payment',
    ru: 'Платёж по кредиту',
    uz: 'Kredit to’lovi',
  },
  {
    code: 'INSTALLMENT_PAYMENT',
    defaultType: 'expense',
    icon: '📅',
    en: 'Installment Payment',
    ru: 'Платёж по рассрочке',
    uz: 'Bo’lib to’lash',
  },
  {
    code: 'CASH_WITHDRAWAL',
    defaultType: 'neutral',
    icon: '🏧',
    en: 'Cash Withdrawal',
    ru: 'Снятие наличных',
    uz: 'Naqd pul yechish',
  },
  {
    code: 'CURRENCY_EXCHANGE',
    defaultType: 'neutral',
    icon: '💱',
    en: 'Currency Exchange',
    ru: 'Обмен валюты',
    uz: 'Valyuta almashtirish',
  },
  {
    code: 'REFUND',
    defaultType: 'income',
    icon: '↩️',
    en: 'Refund',
    ru: 'Возврат',
    uz: 'Qaytarilgan pul',
  },
  {
    code: 'TRANSFER',
    defaultType: 'neutral',
    icon: '🔄',
    en: 'Transfer',
    ru: 'Перевод',
    uz: 'O’tkazma',
  },
  {
    code: 'GIFTS',
    defaultType: 'expense',
    icon: '🎁',
    en: 'Gifts',
    ru: 'Подарки',
    uz: 'Sovg’alar',
  },
  {
    code: 'CHARITY_DONATION',
    defaultType: 'expense',
    icon: '❤️',
    en: 'Charity/Donation',
    ru: 'Благотворительность',
    uz: 'Xayriya',
  },
  {
    code: 'PERSONAL_CARE',
    defaultType: 'expense',
    icon: '🧴',
    en: 'Personal Care',
    ru: 'Личный уход',
    uz: 'Shaxsiy parvarish',
  },
  {
    code: 'FAMILY_CHILDCARE',
    defaultType: 'expense',
    icon: '👶',
    en: 'Family/Childcare',
    ru: 'Семья/Уход за детьми',
    uz: 'Oila/Bolalar parvarishi',
  },
  {
    code: 'PETS',
    defaultType: 'expense',
    icon: '🐾',
    en: 'Pets',
    ru: 'Питомцы',
    uz: 'Uy hayvonlari',
  },
  { code: 'OTHER', defaultType: 'neutral', icon: '❓', en: 'Other', ru: 'Другое', uz: 'Boshqa' },
];

// Chapter 13 §13.8's example set ("UZS, USD, RUB, EUR, ...")
const CURRENCIES = [
  { code: 'UZS', symbol: "so'm", decimalPlaces: 0, isActive: true },
  { code: 'USD', symbol: '$', decimalPlaces: 2, isActive: true },
  { code: 'RUB', symbol: '₽', decimalPlaces: 2, isActive: true },
  { code: 'EUR', symbol: '€', decimalPlaces: 2, isActive: true },
];

async function main() {
  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: currency,
      create: currency,
    });
  }

  for (const cat of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { code: cat.code },
      update: {
        defaultType: cat.defaultType,
        icon: cat.icon,
        isSystem: true,
        status: 'active',
      },
      create: {
        code: cat.code,
        defaultType: cat.defaultType,
        icon: cat.icon,
        isSystem: true,
        status: 'active',
      },
    });

    const translations: Array<{ language: 'en' | 'ru' | 'uz'; label: string }> = [
      { language: 'en', label: cat.en },
      { language: 'ru', label: cat.ru },
      { language: 'uz', label: cat.uz },
    ];

    for (const t of translations) {
      await prisma.categoryTranslation.upsert({
        where: { categoryId_language: { categoryId: category.id, language: t.language } },
        update: { label: t.label },
        create: { categoryId: category.id, language: t.language, label: t.label },
      });
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded ${CURRENCIES.length} currencies and ${CATEGORIES.length} categories (×3 languages).`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
