-- CreateEnum
CREATE TYPE "HomeLayoutSurface" AS ENUM ('WEB');

-- CreateTable
CREATE TABLE "UserHomeLayout" (
    "userId" TEXT NOT NULL,
    "surface" "HomeLayoutSurface" NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "layout" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserHomeLayout_pkey" PRIMARY KEY ("userId","surface")
);

-- AddForeignKey
ALTER TABLE "UserHomeLayout" ADD CONSTRAINT "UserHomeLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
