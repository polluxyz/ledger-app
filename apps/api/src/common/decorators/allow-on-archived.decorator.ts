import { SetMetadata } from '@nestjs/common';

export const ALLOW_ON_ARCHIVED_KEY = 'allowOnArchived';

/** 指向是使用者自己的設定；明確標記後才允許在封存帳本上修改。 */
export const AllowOnArchived = () => SetMetadata(ALLOW_ON_ARCHIVED_KEY, true);
