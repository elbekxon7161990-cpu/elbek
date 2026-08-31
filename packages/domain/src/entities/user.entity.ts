/**
 * Mirrors the `users` table's core columns (Chapter 13 §13.3,
 * packages/infrastructure/prisma/schema.prisma's `User` model). Plain class,
 * no ORM decorators — packages/infrastructure maps Prisma rows to/from this
 * shape; nothing in @afa/domain or @afa/application ever imports @prisma/client.
 */
export class User {
  constructor(
    public readonly id: string,
    public readonly telegramUserId: bigint,
    public readonly telegramUsername: string | null,
    public readonly displayName: string | null,
    public readonly preferredLanguage: string,
    public readonly defaultCurrency: string,
    public readonly timezone: string,
    public readonly status: string,
    public readonly onboardingCompletedAt: Date | null,
    public readonly deletionRequestedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
