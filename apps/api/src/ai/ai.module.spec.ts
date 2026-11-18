import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { FactoryProvider, Provider } from '@nestjs/common';
import type { Env } from '../config/env.validation';
import { AiModule } from './ai.module';
import {
  unavailableTokenSource,
  VERTEX_TOKEN_SOURCE,
  type AccessTokenSource,
} from './access-token-source';
import { GoogleAccessTokenSource } from './google-access-token-source';

jest.mock('./google-access-token-source', () => ({
  GoogleAccessTokenSource: jest.fn().mockImplementation(() => ({ getAccessToken: jest.fn() })),
}));

/** 取正式模組的 token factory 組裝測試，mock Google 來源以免載入真實憑證。 */
describe('AiModule token source', () => {
  afterEach(() => jest.clearAllMocks());

  it.each(['vertex', 'vertex-anthropic', 'glm', 'fake'] as const)(
    'SC-P41.4 creates Google token source only for Vertex providers (%s)',
    async (selected) => {
      const providers = Reflect.getMetadata('providers', AiModule) as Provider[];
      const tokenProvider = providers.find(
        (entry) =>
          typeof entry === 'object' && 'provide' in entry && entry.provide === VERTEX_TOKEN_SOURCE,
      ) as FactoryProvider<AccessTokenSource>;
      const module = await Test.createTestingModule({
        providers: [
          tokenProvider,
          {
            provide: ConfigService,
            useValue: new ConfigService<Env, true>({
              LLM_PROVIDER: selected,
              GOOGLE_APPLICATION_CREDENTIALS: '/outside/test-key.json',
            }),
          },
        ],
      }).compile();
      try {
        const source = module.get<AccessTokenSource>(VERTEX_TOKEN_SOURCE);
        if (selected === 'vertex' || selected === 'vertex-anthropic') {
          expect(GoogleAccessTokenSource).toHaveBeenCalledTimes(1);
          expect(GoogleAccessTokenSource).toHaveBeenCalledWith('/outside/test-key.json');
          expect(source).not.toBe(unavailableTokenSource);
        } else {
          expect(GoogleAccessTokenSource).not.toHaveBeenCalled();
          expect(source).toBe(unavailableTokenSource);
        }
      } finally {
        await module.close();
      }
    },
  );
});
