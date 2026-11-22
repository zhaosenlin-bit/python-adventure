import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getApiBaseUrl } from '@/lib/config/api';
import {
    AuthRequestError,
    classifyAuthError,
    normalizeFriendlyAuthError,
    readErrorMessage,
} from '@/lib/api/authError';
import type { AuthErrorKind } from '@/lib/api/authError';

// 生产环境禁用调试日志
// 只在真正的本地开发环境输出调试日志
const isLocalDev = typeof window !== 'undefined' 
  ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  : process.env.NODE_ENV === 'development';
const debugLog = isLocalDev ? console.log.bind(console) : () => {};

interface User {
    id: number;
    username: string;
    email: string;
    level: number;
    experience: number;
    coins: number; // 💰 金币余额
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;
    // 错误归类，用来判断是不是「后端没连上」这类需要一键修复的问题
    errorKind: AuthErrorKind | null;
    // 🔒 同步状态
    syncStatus: 'synced' | 'pending' | 'failed' | 'token-expired';
    lastSyncError: string | null;

    // Actions
    login: (username: string, password: string) => Promise<void>;
    register: (username: string, email: string, password: string) => Promise<void>;
    logout: () => void;
    loadUserProfile: () => Promise<void>;
    clearError: () => void;
    // 🔒 Token 过期处理
    handleTokenExpired: () => void;
    setSyncStatus: (status: 'synced' | 'pending' | 'failed' | 'token-expired', error?: string) => void;
    // 🔒 Token 主动验证（页面加载时调用）
    validateToken: () => Promise<boolean>;
}

// 使用动态API地址，支持局域网访问
const getApiUrl = () => getApiBaseUrl();

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            error: null,
            errorKind: null,
            // 🔒 同步状态
            syncStatus: 'synced' as const,
            lastSyncError: null,

            // 🔒 设置同步状态
            setSyncStatus: (status, error) => {
                set({ syncStatus: status, lastSyncError: error || null });
            },

            // 🔒 Token 过期处理 - 不中断游戏，只标记状态
            handleTokenExpired: () => {
                debugLog('[AuthStore] Token expired, marking status...');
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    syncStatus: 'token-expired',
                    lastSyncError: '需要重新登录才能同步云端进度',
                });
            },

            login: async (username: string, password: string) => {
                debugLog('[AuthStore] Starting login...', { username });
                // 连同 errorKind 一起清，避免上一轮的「后端没连上」提示条残留
                set({ isLoading: true, error: null, errorKind: null });
                try {
                    const response = await fetch(`${getApiUrl()}/auth/login`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            username,
                            password,
                        }),
                    });

                    debugLog('[AuthStore] Login response status:', response.status);

                    if (!response.ok) {
                        const errorMessage = await readErrorMessage(response, '登录失败，请检查用户名和密码后重试');
                        throw new AuthRequestError(errorMessage, response.status);
                    }

                    const data = await response.json();
                    debugLog('[AuthStore] Login successful:', data);

                    set({
                        token: data.access_token,
                        user: data.user,
                        isAuthenticated: true,
                        isLoading: false,
                        error: null,
                        errorKind: null,
                        syncStatus: 'synced',
                        lastSyncError: null,
                    });

                    // Load game progress from cloud after successful login
                    try {
                        const { useGameStore } = await import('./gameStore');
                        await useGameStore.getState().loadFromCloud();
                        debugLog('[AuthStore] Game progress loaded from cloud');
                    } catch (error) {
                        // 云端进度拉取失败不影响登录本身，降级成 warn 免得弹开发浮层红框
                        console.warn('[AuthStore] Failed to load game progress:', error);
                    }

                    // 🐾 Load pet status after successful login
                    try {
                        const { usePetStore } = await import('./petStore');
                        await usePetStore.getState().loadPets();
                        debugLog('[AuthStore] Pet status loaded');
                        
                        // Check if pet needs attention
                        const petState = usePetStore.getState();
                        if (petState.currentPet) {
                            const pet = petState.currentPet;
                            if (pet.status === 'coma') {
                                // Show notification for coma pet
                                console.warn('[AuthStore] 🚨 Your pet is in coma! Please rescue it by answering questions.');
                                // TODO: Show in-game notification
                            } else if (pet.status === 'tired') {
                                // Show notification for tired pet
                                console.warn('[AuthStore] 😴 Your pet is tired! Feed it soon to keep it healthy.');
                                // TODO: Show in-game notification
                            }
                        }
                    } catch (error) {
                        console.warn('[AuthStore] Failed to load pet status:', error);
                    }
                } catch (error: unknown) {
                    if (classifyAuthError(error) === 'network') {
                        // 后端没连上属于环境问题，不是代码 bug，用 warn 免得弹开发浮层红框
                        console.warn('[AuthStore] Network unreachable:', error);
                    } else if (error instanceof AuthRequestError) {
                        // 密码错误之类的预期内失败：用 warn 记录，
                        // 免得开发浮层把它当成异常弹一个红框出来
                        console.warn('[AuthStore] Login rejected:', error.status, error.message);
                    } else {
                        console.error('[AuthStore] Login error:', error);
                    }
                    set({
                        error: normalizeFriendlyAuthError(error, '登录失败，请稍后重试'),
                        errorKind: classifyAuthError(error),
                        isLoading: false,
                        isAuthenticated: false,
                    });
                    throw error;
                }
            },

            register: async (username: string, email: string, password: string) => {
                debugLog('[AuthStore] Starting registration...', { username, email });
                set({ isLoading: true, error: null, errorKind: null });
                try {
                    const url = `${getApiUrl()}/auth/register`;
                    debugLog('[AuthStore] Fetching:', url);

                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            username,
                            email,
                            password,
                        }),
                    });

                    debugLog('[AuthStore] Response status:', response.status);
                    debugLog('[AuthStore] Response ok:', response.ok);

                    if (!response.ok) {
                        const errorMessage = await readErrorMessage(response, '注册失败，请检查输入信息后重试');
                        throw new AuthRequestError(errorMessage, response.status);
                    }

                    const data = await response.json();
                    debugLog('[AuthStore] Registration successful:', data);
                    set({
                        isLoading: false,
                    });

                    // Auto-login after registration
                    debugLog('[AuthStore] Auto-logging in...');
                    await get().login(username, password);
                } catch (error: unknown) {
                    if (classifyAuthError(error) === 'network') {
                        console.warn('[AuthStore] Network unreachable:', error);
                    } else if (error instanceof AuthRequestError) {
                        console.warn('[AuthStore] Registration rejected:', error.status, error.message);
                    } else {
                        console.error('[AuthStore] Registration error:', error);
                    }
                    set({
                        error: normalizeFriendlyAuthError(error, '注册失败，请稍后重试'),
                        errorKind: classifyAuthError(error),
                        isLoading: false,
                    });
                    throw error;
                }
            },

            logout: () => {
                // 🔒 安全：调用后端登出接口使Token失效
                const { token } = get();
                if (token) {
                    // 异步调用，不阻塞UI
                    fetch(`${getApiUrl()}/auth/logout`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                        },
                    }).catch(err => {
                        console.debug('[AuthStore] Logout API call failed (non-blocking):', err);
                    });
                }
                
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    error: null,
                    syncStatus: 'synced',
                    lastSyncError: null,
                });
            },

            loadUserProfile: async () => {
                const { token } = get();
                if (!token) return;

                try {
                    const response = await fetch(`${getApiUrl()}/users/profile`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                        },
                    });

                    if (!response.ok) {
                        throw new Error('Failed to load profile');
                    }

                    const user = await response.json();
                    set({ user });
                } catch (error: unknown) {
                    console.error('Failed to load user profile:', error);
                    // If token is invalid, logout
                    get().logout();
                }
            },

            // 🔒 Token 主动验证 - 页面加载时调用，检查token是否仍然有效
            validateToken: async () => {
                const { token, isAuthenticated } = get();
                
                // 如果没有token或未登录，直接返回false
                if (!token || !isAuthenticated) {
                    return false;
                }

                try {
                    // 调用用户信息接口验证token
                    const response = await fetch(`${getApiUrl()}/users/profile`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                        },
                    });

                    if (response.status === 401) {
                        // Token已过期，触发过期处理
                        debugLog('[AuthStore] Token validation failed - expired');
                        get().handleTokenExpired();
                        return false;
                    }

                    if (!response.ok) {
                        // 其他错误（如网络问题），不清除登录状态
                        debugLog('[AuthStore] Token validation failed - server error');
                        return false;
                    }

                    // Token有效，更新用户信息
                    const user = await response.json();
                    set({ user });
                    debugLog('[AuthStore] Token validated successfully');
                    return true;
                } catch (error) {
                    // 网络错误，不清除登录状态（可能是离线）
                    console.error('[AuthStore] Token validation error:', error);
                    return false;
                }
            },

            clearError: () => set({ error: null, errorKind: null }),
        }),
        {
            name: 'auth-storage',
            partialize: (state) => ({
                token: state.token,
                user: state.user,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);
