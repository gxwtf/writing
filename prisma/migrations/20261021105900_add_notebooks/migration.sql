-- CreateTable
CREATE TABLE "Notebook" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notebook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotebookEntry" (
    "id" SERIAL NOT NULL,
    "notebookId" INTEGER NOT NULL,
    "writingEntryId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotebookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notebook_userId_idx" ON "Notebook"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Notebook_userId_name_key" ON "Notebook"("userId", "name");

-- CreateIndex
CREATE INDEX "NotebookEntry_notebookId_idx" ON "NotebookEntry"("notebookId");

-- CreateIndex
CREATE INDEX "NotebookEntry_writingEntryId_idx" ON "NotebookEntry"("writingEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "NotebookEntry_notebookId_writingEntryId_key" ON "NotebookEntry"("notebookId", "writingEntryId");

-- AddForeignKey
ALTER TABLE "Notebook" ADD CONSTRAINT "Notebook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookEntry" ADD CONSTRAINT "NotebookEntry_notebookId_fkey" FOREIGN KEY ("notebookId") REFERENCES "Notebook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotebookEntry" ADD CONSTRAINT "NotebookEntry_writingEntryId_fkey" FOREIGN KEY ("writingEntryId") REFERENCES "WritingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: 给每个已有积累的用户建一个默认积累本，并把其全部积累挂进去
-- （与广学英语 20260924000000_add_wordbooks 的回填逻辑一致）
INSERT INTO "Notebook" ("userId", "name", "createdAt", "updatedAt")
SELECT DISTINCT "userId", '我的积累本', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "WritingEntry";

INSERT INTO "NotebookEntry" ("notebookId", "writingEntryId", "createdAt")
SELECT nb."id", e."id", CURRENT_TIMESTAMP
FROM "WritingEntry" e
JOIN "Notebook" nb ON nb."userId" = e."userId" AND nb."name" = '我的积累本'
ON CONFLICT ("notebookId", "writingEntryId") DO NOTHING;
