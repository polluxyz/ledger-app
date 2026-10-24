-- CreateTable
CREATE TABLE "AiParseDailyUsage" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" BIGINT NOT NULL DEFAULT 0,
    "completionTokens" BIGINT NOT NULL DEFAULT 0,
    "usageUnknownCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiParseDailyUsage_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "AiDailyUsage" (
    "day" DATE NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" BIGINT NOT NULL DEFAULT 0,
    "completionTokens" BIGINT NOT NULL DEFAULT 0,
    "usageUnknownCalls" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("day")
);

-- AddForeignKey
ALTER TABLE "AiParseDailyUsage" ADD CONSTRAINT "AiParseDailyUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

