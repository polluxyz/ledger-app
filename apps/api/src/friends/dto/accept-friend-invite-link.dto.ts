import { FriendInviteTokenDto } from './friend-invite-token.dto';

/** 接受連結只收 token；其餘欄位由全域驗證拒絕。 */
export class AcceptFriendInviteLinkDto extends FriendInviteTokenDto {}
