import {
  AuthRequestError,
  classifyAuthError,
  extractErrorText,
  normalizeFriendlyAuthError,
  readErrorMessage,
} from '@/lib/api/authError';

function jsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('extractErrorText', () => {
  it('优先取 message，其次 detail', () => {
    expect(extractErrorText({ message: '用户名或密码错误', detail: 'xxx' })).toBe('用户名或密码错误');
  });

  it('detail 是字符串时也能取到', () => {
    expect(extractErrorText({ detail: '请求参数不正确' })).toBe('请求参数不正确');
  });

  it('支持 FastAPI 的 detail 数组', () => {
    expect(extractErrorText({ detail: [{ msg: 'Field required' }] })).toBe('Field required');
  });

  it('空对象返回空字符串而不是 {}', () => {
    expect(extractErrorText({})).toBe('');
    expect(extractErrorText({ detail: {} })).toBe('');
    expect(extractErrorText(null)).toBe('');
    expect(extractErrorText(undefined)).toBe('');
  });
});

describe('readErrorMessage', () => {
  it('读取后端返回的中文提示', async () => {
    const message = await readErrorMessage(jsonResponse({ detail: '用户名或密码错误' }, 401), '兜底文案');
    expect(message).toBe('用户名或密码错误');
  });

  it('错误体为空时回退到兜底文案', async () => {
    const message = await readErrorMessage(new Response('', { status: 401 }), '登录失败，请检查用户名和密码后重试');
    expect(message).toBe('登录失败，请检查用户名和密码后重试');
  });

  it('错误体是 {} 时不会把 {} 甩给用户', async () => {
    const message = await readErrorMessage(jsonResponse({}, 401), '登录失败，请检查用户名和密码后重试');
    expect(message).toBe('登录失败，请检查用户名和密码后重试');
    expect(message).not.toBe('{}');
  });

  it('后端带 message 和 detail 时取更具体的那句', async () => {
    const message = await readErrorMessage(
      jsonResponse({ success: false, message: '邮箱格式不正确', detail: '请求参数不正确' }, 422),
      '注册失败，请检查输入信息后重试',
    );
    expect(message).toBe('邮箱格式不正确');
  });

  it('非 JSON 错误体会截断展示', async () => {
    const message = await readErrorMessage(new Response('Bad Gateway', { status: 502 }), '兜底文案');
    expect(message).toBe('Bad Gateway');
  });
});

describe('normalizeFriendlyAuthError', () => {
  it('网络异常给出中文提示', () => {
    expect(normalizeFriendlyAuthError(new Error('Failed to fetch'), '登录失败')).toContain('连不上服务器');
  });

  it('5xx 追加服务器开小差的提示', () => {
    expect(normalizeFriendlyAuthError(new Error('HTTP 503'), '登录失败')).toContain('服务器');
  });

  it('401 换成登录文案', () => {
    expect(normalizeFriendlyAuthError(new Error('HTTP 401'), '登录失败')).toBe(
      '登录失败，请检查用户名和密码后重试。',
    );
  });
});

describe('AuthRequestError', () => {
  it('保留 HTTP 状态码并且是 Error 的子类', () => {
    const error = new AuthRequestError('用户名或密码错误', 401);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.message).toBe('用户名或密码错误');
  });
});

describe('classifyAuthError', () => {
  it('fetch 失败归类为网络问题', () => {
    expect(classifyAuthError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyAuthError(new Error('NetworkError when attempting to fetch resource'))).toBe('network');
  });

  it('接口返回的状态错误归类为表单问题', () => {
    expect(classifyAuthError(new AuthRequestError('用户名或密码错误', 401))).toBe('form');
  });

  it('5xx 归类为服务端问题', () => {
    expect(classifyAuthError(new AuthRequestError('服务器繁忙，请稍后再试', 500))).toBe('server');
  });

  it('其它异常归类为服务端问题', () => {
    expect(classifyAuthError(new Error('boom'))).toBe('server');
  });
});
