-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "userName" TEXT NOT NULL,
    "admin" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "realName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingEntry" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "subject" TEXT NOT NULL DEFAULT 'english',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "colorId" TEXT NOT NULL DEFAULT 'blue',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingEntryTag" (
    "id" SERIAL NOT NULL,
    "writingEntryId" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WritingEntryTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagConfig" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "colorId" TEXT NOT NULL DEFAULT 'blue',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_userId_key" ON "User"("userId");

-- CreateIndex
CREATE INDEX "WritingEntry_userId_idx" ON "WritingEntry"("userId");

-- CreateIndex
CREATE INDEX "WritingEntry_userId_subject_idx" ON "WritingEntry"("userId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "WritingEntryTag_tagId_idx" ON "WritingEntryTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "WritingEntryTag_writingEntryId_tagId_key" ON "WritingEntryTag"("writingEntryId", "tagId");

-- CreateIndex
CREATE INDEX "TagConfig_userId_idx" ON "TagConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TagConfig_userId_name_key" ON "TagConfig"("userId", "name");

-- AddForeignKey
ALTER TABLE "WritingEntry" ADD CONSTRAINT "WritingEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingEntryTag" ADD CONSTRAINT "WritingEntryTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingEntryTag" ADD CONSTRAINT "WritingEntryTag_writingEntryId_fkey" FOREIGN KEY ("writingEntryId") REFERENCES "WritingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagConfig" ADD CONSTRAINT "TagConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
