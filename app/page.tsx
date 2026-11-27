"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
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
import { Trophy, LogOut, User, Volume2, VolumeX, Languages, Globe2, BrainCircuit, ExternalLink, Keyboard, Gamepad2, Mountain, Menu, Waves, ChevronDown, X } from "lucide-react";
import Footer from "@/components/Footer";
import CoinBalance from "@/components/ui/CoinBalance";
import CoinHistory from "@/components/ui/CoinHistory";
import NewUserGuide, { shouldShowNewUserGuide } from "@/components/ui/NewUserGuide";
import DailyCheckIn from "@/components/pet/DailyCheckIn";
import AchievementPanel from "@/components/pet/AchievementPanel";
import { showErrorToast } from "@/components/ui/ErrorToast";

type ViewState = 'home' | 'map' | 'level';
const AI_RESEARCH_URL = "https://research.google/ai-quests/intl/en_us/quest/market-marshes";
const ENGLISH_GAME_URL = "https://www.gamestolearnenglish.com/";
const MICROSTUDIO_GAME_URL = "https://microstudio.dev/";
const TYPING_URL = process.env.NEXT_PUBLIC_TYPING_URL || "/typing/index.html";

/** 服务端渲染时没有 window，用 useEffect 兜底，避免 React 报警告。 */
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

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
    // 一打开网站先停在登录界面，登录成功后再进首页
    const [loginGate, setLoginGate] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [isValidating, setIsValidating] = useState(true); // 🔒 Token验证状态
    const { level: userLevel, xp } = useGameStore();
    const { balance: coins, loadBalance } = useCoinStore(); // 使用统一的coinStore
    const { isMuted, toggleMute } = useSoundStore();
    const { language, setLanguage, t } = useI18n();
    const musicInitialized = useRef(false);
    const quickLinksMenuRef = useRef<HTMLDivElement | null>(null);
    // -------------------------------------------- 顶部入口栏：放不下自动收进「展开」
    /** 放不下的入口编号（会进「展开」菜单） */
    const [overflowLinkIds, setOverflowLinkIds] = useState<string[]>([]);
    /** 「展开」菜单是否打开 */
    const [showOverflowMenu, setShowOverflowMenu] = useState(false);
    /** 入口条容器：挂上之后才知道这一栏有多宽 */
    const [linksAreaEl, setLinksAreaEl] = useState<HTMLDivElement | null>(null);
    /** 隐藏的测量行：宽度和真实按钮一致，用来算放得下几个入口 */
    const measureRowRef = useRef<HTMLDivElement | null>(null);
    const handleLinksAreaRef = useCallback((node: HTMLDivElement | null) => {
        quickLinksMenuRef.current = node;
        setLinksAreaEl(node);
    }, []);
    const tokenValidated = useRef(false); // 🔒 防止重复验证

    useEffect(() => {
        setMounted(true);

        // 登录成功（isAuthenticated 变为 true）后关闭登录门，进入首页
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
        if (!showQuickLinksMenu && !showOverflowMenu) return;

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target as Node | null;
            if (quickLinksMenuRef.current && target && !quickLinksMenuRef.current.contains(target)) {
                setShowOverflowMenu(false);
                setShowQuickLinksMenu(false);
            }
        };

        const handleEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setShowOverflowMenu(false);
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
    }, [showQuickLinksMenu, showOverflowMenu]);

    // 量一下横条放得下几个入口：放不下的自动收进「展开」
    useIsomorphicLayoutEffect(() => {
        const area = linksAreaEl;
        const measure = measureRowRef.current;
        if (!area || !measure) return;

        const GAP = 8; // 对应 gap-2
        const compute = () => {
            const available = area.clientWidth;
            if (available <= 0) return;
            const items = Array.from(measure.querySelectorAll<HTMLElement>("[data-link-id]"));
            const widths = items.map((el) => el.getBoundingClientRect().width);
            const toggle = measure.querySelector<HTMLElement>("[data-overflow-toggle]");
            const toggleWidth = toggle?.getBoundingClientRect().width ?? 104;
            const total = widths.reduce((sum, width) => sum + width, 0) + GAP * Math.max(0, widths.length - 1);
            if (total <= available) {
                setOverflowLinkIds((prev) => (prev.length === 0 ? prev : []));
                return;
            }
            // 从前往后摆，剩下那点位置要留给「展开」按钮
            let used = 0;
            let keep = 0;
            for (const width of widths) {
                const next = used + (keep > 0 ? GAP : 0) + width;
                if (next + GAP + toggleWidth > available) break;
                used = next;
                keep += 1;
            }
            const ids = items.slice(keep).map((el) => el.getAttribute("data-link-id") || "");
            setOverflowLinkIds((prev) =>
                prev.length === ids.length && prev.every((id, index) => id === ids[index]) ? prev : ids,
            );
        };

        compute();
        const observer = new ResizeObserver(compute);
        observer.observe(area);
        window.addEventListener("resize", compute);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", compute);
        };
    }, [linksAreaEl]);

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

    // 3D 打字闯关是网页版（three.js），站内直接打开就能玩。
    const handleOpen3DTyping = () => {
        router.push('/typing-3d');
    };

    // 水乐园大乱斗是本地桌面游戏（Ursina），页面里再拉起窗口。
    const handleOpenAquapark = () => {
        router.push('/aquapark');
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
            id: '3d-typing',
            testId: '3d-typing-button',
            label: '3D 打字闯关',
            title: '进入 3D 打字闯关（浏览器直接玩）',
            Icon: Mountain,
            iconClassName: 'text-teal-300',
            buttonClassName: 'top-action-3d border-teal-300/35 bg-teal-500/12 text-teal-100 shadow-teal-500/10',
            onClick: handleOpen3DTyping,
        },
        {
            id: 'aquapark',
            testId: 'aquapark-button',
            label: '水乐园大乱斗',
            title: '玩水乐园大乱斗（Aquapark.io 复刻）',
            Icon: Waves,
            iconClassName: 'text-cyan-300',
            buttonClassName: 'top-action-aquapark border-cyan-300/35 bg-cyan-500/12 text-cyan-100 shadow-cyan-500/10',
            onClick: handleOpenAquapark,
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

    // ------------------------------------------- 顶部入口栏：放不下就自动收进「展开」
    /** 收进「展开」菜单的入口 */
    const overflowLinks = topQuickLinks.filter((link) => overflowLinkIds.includes(link.id));
    /** 还留在横条上的入口 */
    const visibleTopLinks = topQuickLinks.filter((link) => !overflowLinkIds.includes(link.id));

    /** 入口按钮：横条和隐藏测量行共用同一份样式，量出来的宽度才准 */
    const renderTopLinkButton = (
        link: (typeof topQuickLinks)[number],
        options: { measure?: boolean } = {},
    ) => {
        const Icon = link.Icon;
        return (
            <button
                key={link.id}
                type="button"
                data-link-id={link.id}
                data-testid={options.measure ? undefined : link.testId}
                tabIndex={options.measure ? -1 : undefined}
                onClick={options.measure ? undefined : link.onClick}
                className={`top-action-cta group inline-flex min-h-[44px] shrink-0 transform-gpu items-center gap-2 rounded-full border px-3 py-2 shadow-lg transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.02] hover:text-slate-950 hover:shadow-xl hover:ring-2 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 ${link.buttonClassName}`}
                title={link.title}
            >
                <Icon className={`h-4 w-4 transition-all duration-200 group-hover:scale-110 group-hover:text-slate-950 ${link.iconClassName}`} />
                <span className="hidden text-sm font-medium xl:inline">{link.label}</span>
                <ExternalLink className="hidden h-3.5 w-3.5 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-slate-950 xl:block" />
            </button>
        );
    };

    /** 「展开」按钮：放不下的入口都收进它 */
    const renderOverflowToggle = (measure: boolean) => (
        <button
            key="overflow-toggle"
            type="button"
            data-overflow-toggle="true"
            data-testid={measure ? undefined : 'top-quick-links-overflow-toggle'}
            tabIndex={measure ? -1 : undefined}
            onClick={measure ? undefined : () => setShowOverflowMenu((current) => !current)}
            aria-expanded={showOverflowMenu}
            aria-haspopup="menu"
            aria-label="展开更多入口"
            className="top-action-cta inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-cyan-400/30 bg-slate-950/70 px-3 py-2 text-cyan-100 shadow-lg shadow-cyan-950/30 transition-colors hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        >
            <ChevronDown className="h-4 w-4" />
            <span className="text-sm font-medium">展开</span>
            <span className="inline-flex min-w-[1.25rem] justify-center rounded-full bg-cyan-400/20 px-1 text-xs font-semibold text-cyan-100">
                {/* 测量行用两位数占位，量出来的「展开」按钮宽度才不会偏窄 */}
                {measure ? "99" : overflowLinks.length}
            </span>
        </button>
    );


    return (
        <main className="min-h-screen bg-gradient-to-b from-[#0a0e27] via-[#1a1e3e] to-[#0a0e27] text-white">
            {/* 🔒 进度同步状态指示器 */}
            <SyncStatusIndicator />
            
            {/* Top Bar */}
            <div className="relative z-30 flex flex-col sm:flex-row justify-between items-center p-2 sm:p-4 bg-[#0a0e27]/80 backdrop-blur-sm border-b border-blue-900/30 gap-2 sm:gap-0">
                <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center sm:justify-start">
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
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:gap-3 lg:w-auto lg:min-w-0 lg:flex-1 lg:flex-nowrap">
                    <div
                        ref={handleLinksAreaRef}
                        className="relative lg:min-w-0 lg:flex-1"
                    >
                        {/* 隐藏的测量行：宽度和真实按钮一致，用来算这一栏放得下几个入口。
                            外层是个 0×0 的裁剪壳，测量行再宽也不会把页面撑出横向滚动条。 */}
                        <div
                            aria-hidden="true"
                            data-qa-measure="true"
                            className="pointer-events-none absolute left-0 top-0 h-0 w-0 overflow-clip"
                        >
                        <div
                            ref={measureRowRef}
                            className="invisible flex w-max items-center gap-2"
                        >
                            {topQuickLinks.map((link) => renderTopLinkButton(link, { measure: true }))}
                            {renderOverflowToggle(true)}
                        </div>
                        </div>
                        {/* 桌面端横条：放不下的入口自动进「展开」 */}
                        <div data-top-links-row="true" className="hidden items-center gap-2 lg:flex lg:min-w-0 lg:justify-end">
                            {visibleTopLinks.map((link) => renderTopLinkButton(link))}
                            {overflowLinks.length > 0 && renderOverflowToggle(false)}
                        </div>
                        <button
                            type="button"
                            data-testid="quick-links-toggle"
                            onClick={() => setShowQuickLinksMenu((current) => !current)}
                            className="top-action-cta inline-flex min-h-[44px] items-center gap-2 rounded-full border border-cyan-400/25 bg-slate-950/60 px-3 py-2 text-cyan-100 shadow-lg shadow-cyan-950/30 transition-colors hover:bg-slate-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 lg:hidden"
                            aria-expanded={showQuickLinksMenu}
                            aria-haspopup="menu"
                            aria-label={'\u6253\u5f00\u5b66\u4e60\u5165\u53e3\u83dc\u5355'}
                        >
                            {showQuickLinksMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                            <span className="text-sm font-medium">{'\u5b66\u4e60\u5165\u53e3'}</span>
                        </button>
                        {showQuickLinksMenu && (
                            <div className="absolute left-0 top-[calc(100%+0.6rem)] z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-cyan-400/20 bg-[#071427]/95 p-3 shadow-[0_24px_60px_rgba(2,12,27,0.6)] backdrop-blur-xl sm:left-auto sm:right-0 lg:hidden">
                                <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200/70">{'\u5b66\u4e60\u5165\u53e3'}</div>
                                <div className="flex flex-col gap-2">
                                    {topQuickLinks.map((link) => {
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
                        {showOverflowMenu && overflowLinks.length > 0 && (
                            <div className="absolute right-0 top-[calc(100%+0.6rem)] z-50 hidden w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-cyan-400/20 bg-[#061225] p-3 shadow-[0_24px_60px_rgba(2,12,27,0.75)] lg:block">
                                <div className="mb-2 px-1 text-[11px] uppercase tracking-[0.2em] text-cyan-200/70">更多入口</div>
                                <div className="flex flex-col gap-2">
                                    {overflowLinks.map((link) => {
                                        const Icon = link.Icon;
                                        return (
                                            <button
                                                key={`${link.id}-overflow`}
                                                type="button"
                                                data-testid={`${link.testId}-overflow`}
                                                onClick={() => {
                                                    link.onClick();
                                                    setShowOverflowMenu(false);
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

            {/* 底部备案信息 */}
            <Footer />
        </main>
    );
}
