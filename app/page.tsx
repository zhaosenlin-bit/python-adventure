"use client";

import { useState, useEffect, useRef } from "react";
import { useGameStore } from "@/store/gameStore";
import { useAuthStore } from "@/store/authStore";
import { useCoinStore } from "@/store/coinStore";
import { useSoundStore } from "@/store/soundStore";
import { musicManager } from "@/lib/audio/musicManager";
import { useI18n } from "@/lib/i18n";
import AuthModal from "@/components/auth/AuthModal";
import SubjectSelect from "@/components/game/SubjectSelect";
import ChapterSelect from "@/components/game/ChapterSelect";
import { LearningIcon } from "@/components/game/LearningIcon";
import WorldMap from "@/components/game/WorldMap";
import LevelView from "@/components/game/LevelView";
import LeaderboardModal from "@/components/game/LeaderboardModal";
import { SyncStatusIndicator } from "@/components/game/SyncStatusIndicator";
import { Level } from "@/lib/levels";
import { getLearningChapter, getLearningCopy, type LearningSubjectId } from "@/lib/learningHub";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Trophy, LogOut, User, Volume2, VolumeX, Languages, Globe2, BrainCircuit, ExternalLink, Keyboard, Gamepad2, Menu, X } from "lucide-react";
import Footer from "@/components/Footer";
import CoinBalance from "@/components/ui/CoinBalance";
import CoinHistory from "@/components/ui/CoinHistory";
import NewUserGuide, { shouldShowNewUserGuide } from "@/components/ui/NewUserGuide";
import DailyCheckIn from "@/components/pet/DailyCheckIn";
import AchievementPanel from "@/components/pet/AchievementPanel";

type ViewState = 'home' | 'map' | 'level';
const AI_RESEARCH_URL = "https://research.google/ai-quests/intl/en_us/quest/market-marshes";
const ENGLISH_GAME_URL = "https://www.gamestolearnenglish.com/";
const MICROSTUDIO_GAME_URL = "https://microstudio.dev/";
const TYPING_URL = process.env.NEXT_PUBLIC_TYPING_URL || "/typing/index.html";
const DINO_GAME_URL = "/dino/index.html";

export default function Home() {
    const router = useRouter();
    const { isAuthenticated, user, logout, validateToken, token } = useAuthStore();
    const [view, setView] = useState<ViewState>('home');
    const [selectedSubject, setSelectedSubject] = useState<LearningSubjectId | null>(null);
    const [selectedChapter, setSelectedChapter] = useState<number>(1);
    const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [showCoinHistory, setShowCoinHistory] = useState(false);
    const [showNewUserGuide, setShowNewUserGuide] = useState(false);
    const [showQuickLinksMenu, setShowQuickLinksMenu] = useState(false);
    const [visibleQuickLinkCount, setVisibleQuickLinkCount] = useState(5);
    const [showDinoGame, setShowDinoGame] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [isValidating, setIsValidating] = useState(true); // 🔒 Token验证状态
    const [loginGate, setLoginGate] = useState(true); // 🔒 一打开网站先进入登录界面，登录成功后才进入首页
    const { level: userLevel, xp } = useGameStore();
    const { balance: coins, loadBalance } = useCoinStore(); // 使用统一的coinStore
    const { isMuted, toggleMute } = useSoundStore();
    const { language, setLanguage, t } = useI18n();
    const musicInitialized = useRef(false);
    const quickLinksMenuRef = useRef<HTMLDivElement | null>(null);
    const topBarRef = useRef<HTMLDivElement | null>(null);
    const topBarLeftRef = useRef<HTMLDivElement | null>(null);
    const fixedActionsRef = useRef<HTMLDivElement | null>(null);
    const quickLinksMeasureRef = useRef<HTMLDivElement | null>(null);
    const overflowMeasureRef = useRef<HTMLButtonElement | null>(null);
    const tokenValidated = useRef(false); // 🔒 防止重复验证

    useEffect(() => {
        setMounted(true);

        // 🔒 登录成功（isAuthenticated 变为 true）后关闭登录门，进入首页
        if (isAuthenticated) {
            setLoginGate(false);
        }

        // 🔒 页面加载时验证Token（只验证一次）
        if (!tokenValidated.current && isAuthenticated) {
            tokenValidated.current = true;
            validateToken().finally(() => {
                setIsValidating(false);
            });
        } else {
            setIsValidating(false);
        }
        
        // 加载金币余额
        if (isAuthenticated && token) {
            loadBalance(token);
        }
        
        // 👋 检查是否需要显示新用户引导
        if (isAuthenticated && shouldShowNewUserGuide(user?.id)) {
            setShowNewUserGuide(true);
        }

        // 只初始化一次音乐管理器
        if (!musicInitialized.current) {
            musicInitialized.current = true;
            // 启动背景音乐
            if (typeof window !== 'undefined') {
                // 用户首次交互后启动音乐
                const handleFirstInteraction = async () => {
                    try {
                        const { isMuted } = useSoundStore.getState();
                        if (!isMuted) {
                            await musicManager.play();
                        }
                    } catch (e) {
                        console.error('[HomePage] Failed to start background music:', e);
                    }
                    document.removeEventListener('click', handleFirstInteraction);
                    document.removeEventListener('keydown', handleFirstInteraction);
                    document.removeEventListener('touchstart', handleFirstInteraction);
                };
                
                document.addEventListener('click', handleFirstInteraction);
                document.addEventListener('keydown', handleFirstInteraction);
                document.addEventListener('touchstart', handleFirstInteraction);
            }
        }

        // Listen for campaign mode trigger from open world
        const handleOpenCampaign = (event?: Event) => {
            const detail = (event as CustomEvent | undefined)?.detail as { chapterId?: number; openMap?: boolean } | undefined;
            setSelectedSubject('python');
            if (detail?.openMap) {
                setSelectedChapter(detail.chapterId ?? 1);
                setView('map');
                return;
            }
            setSelectedChapter(detail?.chapterId ?? 1);
            setView('home');
        };
        

        window.addEventListener('open-campaign', handleOpenCampaign);

        return () => {
            window.removeEventListener('open-campaign', handleOpenCampaign);
        };
    }, [isAuthenticated, validateToken, token, loadBalance]);

    useEffect(() => {
        if (!showQuickLinksMenu) return;

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (quickLinksMenuRef.current && target && !quickLinksMenuRef.current.contains(target)) {
                setShowQuickLinksMenu(false);
            }
        };

        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowQuickLinksMenu(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('touchstart', handlePointerDown);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('touchstart', handlePointerDown);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showQuickLinksMenu]);

    // 恐龙大世界弹窗：Esc 关闭
    useEffect(() => {
        if (!showDinoGame) return;

        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowDinoGame(false);
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [showDinoGame]);

    const selectedChapterMeta = getLearningChapter(selectedChapter);

    const handleSelectSubject = (subjectId: LearningSubjectId) => {
        setSelectedSubject(subjectId);
        setView('home');
    };

    const handleSelectChapter = (chapterId: number) => {
        const chapter = getLearningChapter(chapterId);
        if (chapter) {
            setSelectedSubject(chapter.subjectId);
        }
        setSelectedChapter(chapterId);
        setView('map');
    };

    const handleSelectLevel = (level: Level) => {
        setSelectedLevel(level);
        setView('level');
    };

    const handleBackToHome = () => {
        setView('home');
        setSelectedLevel(null);
    };

    const handleBackToSubjects = () => {
        setSelectedSubject(null);
        setSelectedLevel(null);
        setView('home');
    };

    const handleBackToMap = () => {
        setView('map');
        setSelectedLevel(null);
    };

    const handleLogout = () => {
        logout();
        window.location.reload();
    };

    const handleToggleMute = () => {
        toggleMute();
        musicManager.toggleMute();
    };

    const handleToggleLanguage = () => {
        setLanguage(language === 'cn' ? 'en' : 'cn');
    };

    const handleEnterWorld = () => {
        // 停止主页音乐
        musicManager.stop();
        router.push('/world');
    };

    const handleOpenAiResearch = () => {
        if (typeof window === 'undefined') return;
        window.open(AI_RESEARCH_URL, '_blank', 'noopener,noreferrer');
    };

    const handleOpenEnglishGame = () => {
        if (typeof window === 'undefined') return;
        window.open(ENGLISH_GAME_URL, '_blank', 'noopener,noreferrer');
    };

    const handleOpenMicrostudioGame = () => {
        if (typeof window === 'undefined') return;
        window.open(MICROSTUDIO_GAME_URL, '_blank', 'noopener,noreferrer');
    };

    const handleOpenCodeResearch = () => {
        router.push('/code-research');
    };

    const handleOpenTyping = () => {
        if (typeof window === 'undefined') return;
        const target = new URL(TYPING_URL, window.location.origin);
        target.searchParams.set('source', 'game-google');
        target.searchParams.set('apiBase', '/api/typing');
        target.searchParams.set('returnUrl', window.location.href);
        if (token) target.searchParams.set('token', token);
        if (user?.id) target.searchParams.set('userId', String(user.id));
        if (user?.username) target.searchParams.set('username', user.username);
        if (userLevel) target.searchParams.set('level', String(userLevel));
        window.location.href = target.toString();
    };

    // 🦖 恐龙大世界：在首页全屏弹窗中打开游戏（iframe 同源，支持鼠标锁定）
    const handleOpenDinoGame = () => {
        musicManager.stop();
        setShowDinoGame(true);
    };

    const handleCloseDinoGame = () => {
        setShowDinoGame(false);
        const { isMuted } = useSoundStore.getState();
        if (!isMuted) {
            musicManager.play();
        }
    };

    const topQuickLinks = [
        {
            id: 'typing',
            testId: 'typing-entry-button',
            label: '\u4eab\u6253\u5b57',
            title: '\u8fdb\u5165\u4e50\u542f\u4eab\u6253\u5b57\u8bad\u7ec3\u4e2d\u5fc3',
            Icon: Keyboard,
            iconClassName: 'text-yellow-300',
            buttonClassName: 'top-action-typing border-yellow-300/40 bg-yellow-400/15 text-yellow-50 shadow-yellow-500/10',
            onClick: handleOpenTyping,
        },
        {
            id: 'ai-research',
            testId: 'ai-research-button',
            label: 'AI Research',
            title: '\u56fd\u5916\u8d44\u6e90\uff1a\u9700\u8981\u8c03\u6574\u7f51\u7edc\u73af\u5883',
            Icon: BrainCircuit,
            iconClassName: 'text-cyan-300',
            buttonClassName: 'top-action-ai border-cyan-400/30 bg-cyan-500/10 text-cyan-100 shadow-cyan-500/10',
            onClick: handleOpenAiResearch,
        },
        {
            id: 'code-research',
            testId: 'code-research-button',
            label: 'Code Research',
            title: '\u8fdb\u5165 Code Research \u7f16\u7a0b\u6311\u6218',
            Icon: BrainCircuit,
            iconClassName: 'text-emerald-300',
            buttonClassName: 'top-action-code border-emerald-300/35 bg-emerald-500/12 text-emerald-100 shadow-emerald-500/10',
            onClick: handleOpenCodeResearch,
        },
        {
            id: 'english-game',
            testId: 'english-game-button',
            label: '\u82f1\u8bed\u6e38\u620f',
            title: '\u6253\u5f00\u82f1\u8bed\u6e38\u620f\u7ad9\u70b9',
            Icon: Gamepad2,
            iconClassName: 'text-violet-300',
            buttonClassName: 'top-action-english border-violet-300/35 bg-violet-500/12 text-violet-100 shadow-violet-500/10',
            onClick: handleOpenEnglishGame,
        },
        {
            id: 'microstudio-game',
            testId: 'microstudio-game-button',
            label: 'microstudio game',
            title: '\u6253\u5f00 microstudio \u6e38\u620f\u521b\u4f5c\u5e73\u53f0',
            Icon: Gamepad2,
            iconClassName: 'text-sky-300',
            buttonClassName: 'top-action-microstudio border-sky-300/35 bg-sky-500/12 text-sky-100 shadow-sky-500/10',
            onClick: handleOpenMicrostudioGame,
        },
    ] as const;

    // 顶部入口按实际可用宽度自动收纳：放不下的入口进入“更多入口”
    useEffect(() => {
        const updateVisibleQuickLinks = () => {
            const bar = topBarRef.current;
            const left = topBarLeftRef.current;
            const fixed = fixedActionsRef.current;
            const measure = quickLinksMeasureRef.current;
            if (!bar || !left || !fixed || !measure) return;

            // 窄屏顶部栏改为纵向排列，入口统一收进菜单
            if (!window.matchMedia('(min-width: 640px)').matches) {
                setVisibleQuickLinkCount((current) => (current === 0 ? current : 0));
                return;
            }

            const barStyle = window.getComputedStyle(bar);
            const horizontalPadding =
                (parseFloat(barStyle.paddingLeft) || 0) + (parseFloat(barStyle.paddingRight) || 0);
            const contentWidth = bar.clientWidth - horizontalPadding;
            const leftWidth = left.getBoundingClientRect().width;
            const fixedWidth = fixed.getBoundingClientRect().width;
            const outerGap = 12;
            const linkGap = 8;
            const availableForLinks = contentWidth - leftWidth - fixedWidth - outerGap;
            const widths = Array.from(
                measure.querySelectorAll<HTMLButtonElement>('[data-measure-link]')
            ).map((node) => node.getBoundingClientRect().width);
            if (!widths.length) return;

            const allLinksWidth =
                widths.reduce((sum, width) => sum + width, 0) + linkGap * (widths.length - 1);

            if (availableForLinks >= allLinksWidth) {
                setVisibleQuickLinkCount((current) => (current === widths.length ? current : widths.length));
                return;
            }

            const overflowWidth = overflowMeasureRef.current?.getBoundingClientRect().width || 96;
            const linksBudget = availableForLinks - overflowWidth - linkGap;
            let usedWidth = 0;
            let count = 0;
            for (const width of widths) {
                const nextWidth = usedWidth + (count > 0 ? linkGap : 0) + width;
                if (nextWidth > linksBudget) break;
                usedWidth = nextWidth;
                count += 1;
            }

            const nextCount = Math.max(0, Math.min(widths.length - 1, count));
            setVisibleQuickLinkCount((current) => (current === nextCount ? current : nextCount));
        };

        updateVisibleQuickLinks();
        const resizeObserver = new ResizeObserver(updateVisibleQuickLinks);
        [topBarRef.current, topBarLeftRef.current, fixedActionsRef.current].forEach((node) => {
            if (node) resizeObserver.observe(node);
        });
        window.addEventListener('resize', updateVisibleQuickLinks);
        let cancelled = false;
        document.fonts?.ready.then(() => {
            if (!cancelled) updateVisibleQuickLinks();
        });

        return () => {
            cancelled = true;
            resizeObserver.disconnect();
            window.removeEventListener('resize', updateVisibleQuickLinks);
        };
    }, [language, isAuthenticated, userLevel, coins]);

    useEffect(() => {
        if (visibleQuickLinkCount >= topQuickLinks.length && showQuickLinksMenu) {
            setShowQuickLinksMenu(false);
        }
    }, [visibleQuickLinkCount, showQuickLinksMenu, topQuickLinks.length]);

    // 🔒 验证中显示加载状态
    if (!mounted || isValidating) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-[#0a0e27] via-[#1a1e3e] to-[#0a0e27] flex items-center justify-center">
                <div className="text-blue-400 font-pixel text-xl animate-pulse">加载中...</div>
            </div>
        );
    }

    if (loginGate || !isAuthenticated) {
        return <AuthModal />;
    }

    return (
        <main className="min-h-screen bg-gradient-to-b from-[#0a0e27] via-[#1a1e3e] to-[#0a0e27] text-white">
            {/* 🔒 进度同步状态指示器 */}
            <SyncStatusIndicator />
            
            {/* Top Bar */}
            <div ref={topBarRef} className="relative z-30 flex flex-col sm:flex-row justify-between items-center p-2 sm:p-4 bg-[#0a0e27]/80 backdrop-blur-sm border-b border-blue-900/30 gap-2 sm:gap-0">
                <div ref={topBarLeftRef} className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center sm:justify-start">
                    <div className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-slate-950/40 px-3 py-2 shadow-[0_8px_24px_rgba(4,18,38,0.35)]">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
                            <Image
                                src="/brand/logo11-badge.png"
                                alt="LeQiXiang Logo"
                                width={32}
                                height={32}
                                priority
                                className="h-7 w-7 object-contain"
                            />
                        </div>
                        <div className="leading-tight">
                            <div className="text-lg sm:text-2xl font-pixel text-blue-300">{t('app.title')}</div>
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-cyan-200/75">
                                <span>LeQiXiang</span>
                                <span className="text-gray-500/80">v2.2</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-xs sm:text-sm text-slate-400 hidden sm:block">{t('app.welcome', { username: user?.username || '' })}</div>
                </div>
                {/* 入口宽度测量层：仅用于计算哪几个入口放得下，不参与界面呈现 */}
                <div
                    ref={quickLinksMeasureRef}
                    aria-hidden="true"
                    className="pointer-events-none invisible absolute left-4 top-0 flex w-max items-center gap-2 whitespace-nowrap"
                >
                    {topQuickLinks.map((link) => {
                        const Icon = link.Icon;
                        return (
                            <button
                                key={`measure-${link.id}`}
                                type="button"
                                tabIndex={-1}
                                data-measure-link={link.id}
                                className={`top-action-cta group inline-flex min-h-[44px] transform-gpu items-center gap-2 rounded-full border px-3 py-2 shadow-lg ${link.buttonClassName}`}
                            >
                                <Icon className={`h-4 w-4 ${link.iconClassName}`} />
                                <span className="hidden text-sm font-medium xl:inline">{link.label}</span>
                                <ExternalLink className="hidden h-3.5 w-3.5 xl:block" />
                            </button>
                        );
                    })}
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:gap-3 lg:w-auto lg:flex-nowrap">
                    <div ref={quickLinksMenuRef} className="relative flex min-w-0 items-center gap-2">
                        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                            {topQuickLinks.slice(0, visibleQuickLinkCount).map((link) => {
                                const Icon = link.Icon;
                                return (
                                    <button
                                        key={link.id}
                                        data-testid={link.testId}
                                        onClick={link.onClick}
                                        className={`top-action-cta group inline-flex min-h-[44px] shrink-0 transform-gpu items-center gap-2 rounded-full border px-3 py-2 shadow-lg transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:text-slate-950 hover:shadow-xl hover:ring-2 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 ${link.buttonClassName}`}
                                        title={link.title}
                                    >
                                        <Icon className={`h-4 w-4 transition-all duration-200 group-hover:scale-110 group-hover:text-slate-950 ${link.iconClassName}`} />
                                        <span className="hidden text-sm font-medium xl:inline">{link.label}</span>
                                        <ExternalLink className="hidden h-3.5 w-3.5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-950 xl:block" />
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            ref={overflowMeasureRef}
                            type="button"
                            tabIndex={-1}
                            aria-hidden="true"
                            className="pointer-events-none invisible absolute left-0 top-0 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-cyan-400/25 bg-slate-950/60 px-3 py-2 text-cyan-100"
                        >
                            <Menu className="h-4 w-4" />
                            <span className="text-sm font-medium">{language === 'cn' ? '\u66f4\u591a\u5165\u53e3' : 'More'}</span>
                        </button>
                        {visibleQuickLinkCount < topQuickLinks.length && (
                            <button
                                type="button"
                                data-testid="quick-links-toggle"
                                onClick={() => setShowQuickLinksMenu((current) => !current)}
                                className="top-action-cta inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-cyan-400/25 bg-slate-950/60 px-3 py-2 text-cyan-100 shadow-lg shadow-cyan-950/30 transition-colors hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                                aria-expanded={showQuickLinksMenu}
                                aria-haspopup="menu"
                                aria-label={language === 'cn' ? '\u5c55\u5f00\u5176\u4f59\u5b66\u4e60\u5165\u53e3' : 'Show more learning entries'}
                            >
                                {showQuickLinksMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                                <span className="text-sm font-medium">{language === 'cn' ? '\u66f4\u591a\u5165\u53e3' : 'More'}</span>
                            </button>
                        )}
                        {showQuickLinksMenu && visibleQuickLinkCount < topQuickLinks.length && (
                            <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-cyan-400/20 bg-[#071427]/95 p-3 shadow-[0_24px_60px_rgba(2,12,27,0.6)] backdrop-blur-xl">
                                <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200/70">
                                    {language === 'cn' ? '\u66f4\u591a\u5b66\u4e60\u5165\u53e3' : 'MORE ENTRIES'}
                                </div>
                                <div className="flex flex-col gap-2">
                                    {topQuickLinks.slice(visibleQuickLinkCount).map((link) => {
                                        const Icon = link.Icon;
                                        return (
                                            <button
                                                key={`${link.id}-menu`}
                                                type="button"
                                                data-testid={`${link.testId}-menu`}
                                                onClick={() => {
                                                    link.onClick();
                                                    setShowQuickLinksMenu(false);
                                                }}
                                                className={`top-action-cta group inline-flex min-h-[48px] w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-left shadow-lg transition-all duration-200 ease-out hover:text-slate-950 hover:shadow-xl hover:ring-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 ${link.buttonClassName}`}
                                                title={link.title}
                                            >
                                                <span className="flex items-center gap-3">
                                                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950/25 ring-1 ring-white/10">
                                                        <Icon className={`h-4 w-4 transition-all duration-200 group-hover:scale-110 group-hover:text-slate-950 ${link.iconClassName}`} />
                                                    </span>
                                                    <span className="text-sm font-medium">{link.label}</span>
                                                </span>
                                                <ExternalLink className="h-4 w-4 opacity-80 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-950" />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <div ref={fixedActionsRef} className="flex shrink-0 items-center gap-1 sm:gap-2">
                    <div className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 bg-blue-900/30 rounded">
                        <User className="w-4 h-4 text-blue-400" />
                        <span className="text-xs sm:text-sm">Lv.{userLevel}</span>
                    </div>
                    {/* 金币显示 */}
                    <CoinBalance 
                        initialCoins={coins}
                        size="sm"
                        onClick={() => setShowCoinHistory(true)}
                    />
                    <button
                        onClick={handleToggleMute}
                        className="p-2 sm:p-2 hover:bg-blue-900/30 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title={isMuted ? t('btn.soundOff') : t('btn.soundOn')}
                    >
                        {isMuted ? (
                            <VolumeX className="w-5 h-5 text-gray-400" />
                        ) : (
                            <Volume2 className="w-5 h-5 text-green-400" />
                        )}
                    </button>
                    <button
                        onClick={handleToggleLanguage}
                        className="p-2 hover:bg-blue-900/30 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title={language === 'cn' ? t('btn.switchToEnglish') : t('btn.switchToChinese')}
                    >
                        <Languages className="w-5 h-5 text-blue-400" />
                        <span className="ml-1 text-xs hidden sm:inline">{language === 'cn' ? 'EN' : '\u4e2d'}</span>
                    </button>
                    <button
                        onClick={() => setShowLeaderboard(true)}
                        className="p-2 hover:bg-blue-900/30 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title={t('ui.leaderboard')}
                    >
                        <Trophy className="w-5 h-5 text-yellow-400" />
                    </button>
                    <button
                        onClick={handleLogout}
                        className="p-2 hover:bg-red-900/30 rounded transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title={t('btn.logout')}
                    >
                        <LogOut className="w-5 h-5 text-red-400" />
                    </button>
                    </div>
                </div>
            </div>

            {/* Main Content - 响应式适配 */}
            {view === 'home' && (
                <div className="max-w-6xl mx-auto p-4 sm:p-8">
                    {/* Open World Button - 移动端优化 */}
                    {/* 开放世界按钮 */}
                    <button
                        onClick={handleEnterWorld}
                        className="relative w-full mb-4 sm:mb-8 p-4 sm:p-6 bg-gradient-to-r from-yellow-600 to-orange-600 hover:from-yellow-500 hover:to-orange-500 rounded-xl border-2 sm:border-4 border-yellow-400 transition-all active:scale-95 sm:hover:scale-105 group min-h-[80px]"
                    >
                        <div className="flex items-center justify-center gap-2 sm:gap-4">
                            <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-yellow-100/30 bg-white/10 text-white sm:h-14 sm:w-14">
                                <Globe2 className="h-5 w-5 sm:h-7 sm:w-7" />
                            </span>
                            <div className="text-left">
                                <h2 className="text-xl sm:text-3xl font-pixel text-white">{t('btn.openWorld')}</h2>
                                <p className="text-yellow-100 text-xs sm:text-sm mt-1">{t('btn.openWorld.desc')}</p>
                            </div>
                        </div>
                    </button>

                    {/* 🦖 恐龙大世界 - 3D 开放世界探索游戏入口 */}
                    <div className="relative mb-4 sm:mb-8 overflow-hidden rounded-2xl border border-emerald-400/25 bg-gradient-to-r from-[#0d1a10] via-[#10241a] to-[#0a0e27] p-5 sm:p-6 shadow-[0_18px_50px_rgba(8,15,30,0.4)]">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-300/30 bg-emerald-400/10 text-emerald-200">
                                    <Gamepad2 className="h-6 w-6" />
                                </span>
                                <div>
                                    <h2 className="text-xl sm:text-2xl font-pixel text-emerald-200">恐龙大世界 · 黑爪偷猎队</h2>
                                    <p className="text-xs sm:text-sm text-slate-300 mt-1">3D 开放世界：救回被偷猎队装箱的 12 枚恐龙蛋，找齐爷爷的 6 页追捕笔记，用麻醉枪把 6 名偷猎者赶出山谷——小心霸王龙。</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                data-testid="dino-game-entry-button"
                                onClick={handleOpenDinoGame}
                                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-5 py-2.5 text-emerald-100 shadow-lg shadow-emerald-900/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:bg-emerald-400/25 hover:text-white active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                            >
                                <Gamepad2 className="h-4 w-4" />
                                <span className="text-sm font-semibold">开始探索</span>
                            </button>
                        </div>
                    </div>

                    {!selectedSubject ? (
                        <SubjectSelect
                            userLevel={userLevel}
                            onSelectSubject={handleSelectSubject}
                        />
                    ) : (
                        <ChapterSelect
                            subjectId={selectedSubject}
                            onSelectChapter={handleSelectChapter}
                            onBackToSubjects={handleBackToSubjects}
                            userLevel={userLevel}
                        />
                    )}
                </div>
            )}

            {view === 'map' && (
                <div className="p-8">
                    <div className="max-w-6xl mx-auto">
                        <div className="mb-4 flex items-center">
                            <button
                                onClick={handleBackToHome}
                                className="rounded bg-slate-700 px-4 py-2 font-pixel text-white transition-colors hover:bg-slate-600"
                            >
                                ← {t('ui.backToHome')}
                            </button>
                        </div>
                        {selectedChapterMeta && (
                            <div className="mb-5 rounded-[28px] border border-cyan-400/18 bg-slate-950/70 p-5 shadow-[0_18px_42px_rgba(8,15,30,0.35)]">
                                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                                    <div className="flex items-start gap-4">
                                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-cyan-100">
                                            <LearningIcon icon={selectedChapterMeta.icon} className="h-7 w-7" />
                                        </div>
                                        <div>
                                            <h2 className="text-2xl font-pixel text-yellow-400">
                                                {getLearningCopy(language, selectedChapterMeta.titleCN, selectedChapterMeta.title)}
                                            </h2>
                                            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                                                {getLearningCopy(language, selectedChapterMeta.descriptionCN, selectedChapterMeta.description)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200/90">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                            {language === 'cn' ? '本章重点' : 'Chapter Focus'}
                                        </div>
                                        <div className="mt-2 max-w-xs">
                                            {getLearningCopy(language, selectedChapterMeta.focusCN, selectedChapterMeta.focus)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <WorldMap
                            onSelectLevel={handleSelectLevel}
                            chapterFilter={selectedChapter}
                        />
                    </div>
                </div>
            )}

            {view === 'level' && selectedLevel && (
                <LevelView
                    level={selectedLevel}
                    onBack={handleBackToMap}
                />
            )}

            {showLeaderboard && (
                <LeaderboardModal
                    isOpen={showLeaderboard}
                    onClose={() => setShowLeaderboard(false)}
                />
            )}

            {/* 金币历史记录 */}
            {showCoinHistory && (
                <CoinHistory
                    isOpen={showCoinHistory}
                    onClose={() => setShowCoinHistory(false)}
                    token={useAuthStore.getState().token || undefined}
                />
            )}
            
            {/* 👋 新用户引导 */}
            <NewUserGuide
                isOpen={showNewUserGuide}
                onClose={() => setShowNewUserGuide(false)}
            />

            {view === 'home' && !showNewUserGuide && (
                <>
                    <DailyCheckIn />
                    <AchievementPanel />
                </>
            )}

            {/* 🦖 恐龙大世界全屏弹窗 */}
            {showDinoGame && (
                <div className="fixed inset-0 z-[100] flex flex-col bg-[#0a0e27]">
                    <div className="flex items-center justify-between gap-3 border-b border-emerald-400/20 bg-[#0a0e27]/95 px-4 py-2.5">
                        <div className="flex items-center gap-2 text-sm text-emerald-100">
                            <Gamepad2 className="h-4 w-4 text-emerald-300" />
                            <span className="font-pixel">恐龙大世界 · 黑爪偷猎队</span>
                            <span className="hidden sm:inline text-xs text-slate-400">WASD 移动 · 鼠标视角 · 左键麻醉枪 · Shift 冲刺 · 击败 6 名偷猎者</span>
                        </div>
                        <button
                            type="button"
                            data-testid="dino-game-close-button"
                            onClick={handleCloseDinoGame}
                            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-slate-200 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                        >
                            <X className="h-4 w-4" />
                            返回冒险岛
                        </button>
                    </div>
                    <iframe
                        src={DINO_GAME_URL + "?v=11"}
                        title="恐龙大世界 · 黑爪偷猎队"
                        allow="pointer-lock; fullscreen; autoplay"
                        className="h-full w-full flex-1 border-0 bg-[#0D0E13]"
                    />
                </div>
            )}

            {/* 底部备案信息 */}
            <Footer />
        </main>
    );
}
