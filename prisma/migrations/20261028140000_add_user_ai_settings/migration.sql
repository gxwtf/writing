-- AlterTable：用户级 AI 模型设置（BYOK），沿用广学英语 User.aiSettings 的结构
ALTER TABLE "User" ADD COLUMN "aiSettings" JSONB;
