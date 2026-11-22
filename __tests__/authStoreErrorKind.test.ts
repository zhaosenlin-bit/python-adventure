export {};

jest.mock('@/store/gameStore', () => ({
  useGameStore: {
    getState: () => ({ loadFromCloud: jest.fn().mockResolvedValue(undefined) }),
  },
}));

jest.mock('@/store/petStore', () => ({
  usePetStore: {
    getState: () => ({
      loadPets: jest.fn().mockResolvedValue(undefined),
      currentPet: null,
    }),
  },
}));

function createAuthStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => store.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
    }),
    clear: jest.fn(() => {
      store.clear();
    }),
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useAuthStore 错误归类', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(global, 'localStorage', {
      value: createAuthStorageMock(),
      configurable: true,
      writable: true,
    });
  });

  it('后端返回 401 时归类为表单问题，并给出后端的中文提示', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse({ detail: '用户名或密码错误' }, 401));
    const { useAuthStore } = await import('@/store/authStore');

    await expect(useAuthStore.getState().login('someone', 'wrong')).rejects.toThrow('用户名或密码错误');
    expect(useAuthStore.getState().errorKind).toBe('form');
    expect(useAuthStore.getState().error).toBe('用户名或密码错误');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('后端返回 500 时归类为服务端问题', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ detail: '服务器繁忙，请稍后再试' }, 500));
    const { useAuthStore } = await import('@/store/authStore');

    await expect(useAuthStore.getState().login('someone', 'pass')).rejects.toThrow();
    expect(useAuthStore.getState().errorKind).toBe('server');
  });

  it('连不上后端时归类为网络问题', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { useAuthStore } = await import('@/store/authStore');

    await expect(useAuthStore.getState().login('someone', 'pass')).rejects.toThrow();
    expect(useAuthStore.getState().errorKind).toBe('network');
    expect(useAuthStore.getState().error).toContain('连不上服务器');
  });

  it('再次提交时会清掉上一次的 errorKind，避免过时提示条残留', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'token-123', user: { id: 1, username: 'someone' } }, 200),
      );
    (global as any).fetch = fetchMock;
    const { useAuthStore } = await import('@/store/authStore');

    await expect(useAuthStore.getState().login('someone', 'pass')).rejects.toThrow();
    expect(useAuthStore.getState().errorKind).toBe('network');

    await useAuthStore.getState().login('someone', 'pass');
    expect(useAuthStore.getState().errorKind).toBeNull();
    expect(useAuthStore.getState().error).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });
});
