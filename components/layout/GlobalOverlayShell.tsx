'use client';

import { usePathname } from 'next/navigation';
import GlobalChat from '@/components/chat/GlobalChat';
import InteractionEffectToast from '@/components/pet/InteractionEffectToast';
import PetMainPanel from '@/components/pet/PetMainPanel';
import PetStatusToast from '@/components/pet/PetStatusToast';
import CoinRewardToast from '@/components/ui/CoinRewardToast';
import ErrorToast from '@/components/ui/ErrorToast';
import FoodRewardToast from '@/components/ui/FoodRewardToast';
import { useGlobalUiStore } from '@/store/globalUiStore';

export default function GlobalOverlayShell() {
  const pathname = usePathname();
  const battleRoyaleActive = useGlobalUiStore((state) => state.battleRoyaleActive);
  const petHomeActive = useGlobalUiStore((state) => state.petHomeActive);

  const codeResearchActive = pathname?.startsWith('/code-research') ?? false;
  // 3D 打字闯关是全屏游戏，聊天/宠物挂件会压在画面和弹层上
  const typing3DActive = pathname?.startsWith('/typing-3d') ?? false;
  const hideFloatingOverlays =
    battleRoyaleActive || petHomeActive || codeResearchActive || typing3DActive;

  if (codeResearchActive || typing3DActive) {
    return null;
  }

  return (
    <>
      {!battleRoyaleActive && <PetMainPanel />}

      <div className={hideFloatingOverlays ? 'hidden' : ''}>
        <GlobalChat />
        <PetStatusToast />
        <InteractionEffectToast />
        <FoodRewardToast />
        <CoinRewardToast />
        <ErrorToast />
      </div>
    </>
  );
}
