import { SetMetadata } from '@nestjs/common';

export const LEFT_MEMBER_ACCESS_KEY = 'leftMemberAccess';
export type LeftMemberPolicy = 'read' | 'reject';

/**
 * 只有明確標記的帳本路由才辨識已退出者；未標記者維持非成員 404，
 * 避免新增讀取途徑時意外開放歷史帳本。
 */
export const LeftMemberAccess = (policy: LeftMemberPolicy) =>
  SetMetadata(LEFT_MEMBER_ACCESS_KEY, policy);
